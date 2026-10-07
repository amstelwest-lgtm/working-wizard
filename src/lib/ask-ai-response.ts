/**
 * Turn an ask-ai / milon-bot HTTP result into either a reply or a visible error.
 * Empty, non-JSON, and edge failures must not look like a successful send.
 */

export const ASK_EMPTY_REPLY = "Milōn Bot didn't return an answer. Try again.";
export const ASK_UNREADABLE_REPLY = "Couldn't read Milōn's reply. Try again.";

export type AskAiTool = { name: string; status: string };

export type AskAiSuccess = {
  ok: true;
  answer: string;
  chips: string[];
  tools: AskAiTool[];
  run: Record<string, unknown> | null;
  created: unknown;
};

export type AskAiFailure = { ok: false; error: string };

export type AskAiTurn = AskAiSuccess | AskAiFailure;

function asRecord(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function errorText(body: unknown, status: number): string {
  const rec = asRecord(body);
  if (rec) {
    if (typeof rec.error === "string" && rec.error.trim()) return rec.error.trim();
    if (typeof rec.message === "string" && rec.message.trim()) return rec.message.trim();
  }
  if (status === 429) return "Rate limit reached — try again in a moment.";
  if (status > 0) return `Error ${status}`;
  return ASK_UNREADABLE_REPLY;
}

function chipsOf(body: Record<string, unknown> | null): string[] {
  if (!body || !Array.isArray(body.chips)) return [];
  return body.chips.filter((chip): chip is string => typeof chip === "string" && chip.trim() !== "");
}

function toolsOf(body: Record<string, unknown> | null): AskAiTool[] {
  if (!body || !Array.isArray(body.tools)) return [];
  const tools: AskAiTool[] = [];
  for (const tool of body.tools) {
    if (!tool || typeof tool !== "object") continue;
    const name = (tool as { name?: unknown }).name;
    const status = (tool as { status?: unknown }).status;
    if (typeof name !== "string" || !name.trim()) continue;
    tools.push({ name, status: typeof status === "string" && status ? status : "ok" });
  }
  return tools;
}

/** Interpret an already-parsed body. `ok` is the HTTP success flag. */
export function parseAskAiBody(status: number, body: unknown, ok = status >= 200 && status < 300): AskAiTurn {
  if (!ok || status < 200 || status >= 300) {
    return { ok: false, error: errorText(body, status) };
  }
  const rec = asRecord(body);
  const answer = rec && typeof rec.answer === "string" ? rec.answer.trim() : "";
  if (!answer) {
    const err = rec && typeof rec.error === "string" ? rec.error.trim() : "";
    return { ok: false, error: err || ASK_EMPTY_REPLY };
  }
  const run =
    rec?.run && typeof rec.run === "object" && !Array.isArray(rec.run)
      ? (rec.run as Record<string, unknown>)
      : null;
  return {
    ok: true,
    answer,
    chips: chipsOf(rec),
    tools: toolsOf(rec),
    run,
    created: rec?.created ?? null,
  };
}

/** Parse a raw response body. Non-JSON never throws. */
export function parseAskAiPayload(status: number, raw: string, ok = status >= 200 && status < 300): AskAiTurn {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) {
    return { ok: false, error: ok ? ASK_EMPTY_REPLY : errorText(null, status) };
  }
  try {
    return parseAskAiBody(status, JSON.parse(text) as unknown, ok);
  } catch {
    if (!ok && status > 0) return { ok: false, error: `Couldn't read Milōn's reply (error ${status}). Try again.` };
    return { ok: false, error: ASK_UNREADABLE_REPLY };
  }
}
