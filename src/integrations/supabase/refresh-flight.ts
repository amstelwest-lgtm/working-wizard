/**
 * One network refresh per refresh token across tabs.
 * auth-js processLock does not cross tabs. A second refresh at or after the
 * 10s reuse window revokes the session. Tabs that still hold the old token
 * reuse the successor instead of posting it again.
 */

export type RefreshGrant = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type?: string;
  user?: { id?: string };
};

export type RefreshMsg =
  | { kind: "claim"; tokenKey: string; tabId: string; at: number }
  | { kind: "result"; tokenKey: string; body: RefreshGrant }
  | { kind: "failed"; tokenKey: string; status: number; body: string };

export type RefreshBus = {
  post: (msg: RefreshMsg) => void;
  subscribe: (fn: (msg: RefreshMsg) => void) => () => void;
};

type Entry = { tokenKey: string; body: RefreshGrant; at: number };

const STORAGE_KEY = "milon-refresh-successor";
const TTL_MS = 60 * 60 * 1000;

export function refreshTokenFromRequest(input: RequestInfo | URL, init?: RequestInit): string | null {
  const url = requestUrl(input);
  if (!url.includes("grant_type=refresh_token")) return null;
  const raw = typeof init?.body === "string" ? init.body : null;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { refresh_token?: unknown };
    return typeof parsed.refresh_token === "string" && parsed.refresh_token ? parsed.refresh_token : null;
  } catch {
    return null;
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export async function hashRefreshToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createRefreshCoordinator(options: {
  tabId: string;
  bus: RefreshBus;
  storage: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
  claimWindowMs?: number;
  followWaitMs?: number;
  lock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
}) {
  const now = options.now ?? (() => Date.now());
  const claimWindowMs = options.claimWindowMs ?? 40;
  const followWaitMs = options.followWaitMs ?? 8_000;
  const lock =
    options.lock ??
    (<T,>(_name: string, fn: () => Promise<T>) => fn());

  return {
    refresh(token: string, doFetch: () => Promise<Response>): Promise<Response> {
      return hashRefreshToken(token).then((tokenKey) =>
        lock(`milon-refresh:${tokenKey}`, () => run(tokenKey, doFetch)),
      );
    },
  };

  async function run(tokenKey: string, doFetch: () => Promise<Response>): Promise<Response> {
    const cached = read(tokenKey);
    if (cached) return jsonResponse(cached);

    const claims: { tabId: string; at: number }[] = [];
    let pending: RefreshGrant | null = null;
    let failed: { status: number; body: string } | null = null;
    const unsub = options.bus.subscribe((msg) => {
      if (msg.tokenKey !== tokenKey) return;
      if (msg.kind === "result" && isGrant(msg.body)) {
        pending = msg.body;
        void remember(tokenKey, msg.body);
      } else if (msg.kind === "failed" && msg.status >= 400 && msg.status < 500) {
        failed = { status: msg.status, body: msg.body };
      } else if (msg.kind === "claim" && !claims.some((claim) => claim.tabId === msg.tabId)) {
        claims.push({ tabId: msg.tabId, at: msg.at });
      }
    });

    try {
      const again = read(tokenKey);
      if (again) return jsonResponse(again);
      const at = now();
      claims.push({ tabId: options.tabId, at });
      options.bus.post({ kind: "claim", tokenKey, tabId: options.tabId, at });
      await delay(claimWindowMs);
      if (pending) return jsonResponse(pending);
      if (failed) return errorResponse(failed);
      const mid = read(tokenKey);
      if (mid) return jsonResponse(mid);

      const winner = [...claims].sort(
        (a, b) => a.at - b.at || (a.tabId < b.tabId ? -1 : a.tabId > b.tabId ? 1 : 0),
      )[0];
      if (winner && winner.tabId !== options.tabId) {
        const waited = await waitFor(() => pending ?? read(tokenKey), followWaitMs);
        if (waited) return jsonResponse(waited);
        if (failed) return errorResponse(failed);
      }

      const res = await doFetch();
      const text = await res.clone().text();
      if (res.ok) {
        const body = parseGrant(text);
        if (body) {
          await remember(tokenKey, body);
          options.bus.post({ kind: "result", tokenKey, body });
        }
      } else if (res.status >= 400 && res.status < 500) {
        options.bus.post({ kind: "failed", tokenKey, status: res.status, body: text });
      }
      return new Response(text, {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    } finally {
      unsub();
    }
  }

  function read(tokenKey: string): RefreshGrant | null {
    const hit = load().find((entry) => entry.tokenKey === tokenKey && now() - entry.at < TTL_MS);
    return hit && isGrant(hit.body) ? hit.body : null;
  }

  async function remember(tokenKey: string, body: RefreshGrant): Promise<void> {
    const at = now();
    const entries = load().filter((entry) => at - entry.at < TTL_MS);
    let seen = false;
    const next: Entry[] = [];
    for (const entry of entries) {
      const pointsAt = await hashRefreshToken(entry.body.refresh_token);
      if (entry.tokenKey === tokenKey || pointsAt === tokenKey) {
        next.push({ tokenKey: entry.tokenKey, body, at });
        if (entry.tokenKey === tokenKey) seen = true;
      } else {
        next.push(entry);
      }
    }
    if (!seen) next.push({ tokenKey, body, at });
    while (next.length > 12) next.shift();
    options.storage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function load(): Entry[] {
    try {
      const raw = options.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Entry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

function isGrant(value: unknown): value is RefreshGrant {
  if (!value || typeof value !== "object") return false;
  const row = value as RefreshGrant;
  return Boolean(row.access_token && row.refresh_token && row.expires_in);
}

function parseGrant(text: string): RefreshGrant | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return isGrant(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function jsonResponse(body: RefreshGrant): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(failed: { status: number; body: string }): Response {
  return new Response(failed.body, {
    status: failed.status,
    headers: { "Content-Type": "application/json" },
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitFor(readBody: () => RefreshGrant | null, ms: number): Promise<RefreshGrant | null> {
  const existing = readBody();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const finish = (value: RefreshGrant | null) => {
      clearInterval(early);
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(readBody()), ms);
    const early = setInterval(() => {
      const hit = readBody();
      if (hit) finish(hit);
    }, 15);
  });
}
