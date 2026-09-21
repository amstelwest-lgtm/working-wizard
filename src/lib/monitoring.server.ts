/**
 * Server-side error reporting (Sentry). Server-only.
 *
 * Does nothing unless SENTRY_DSN is set, so local dev and preview builds stay
 * silent. The SDK is imported lazily so a missing DSN costs nothing at boot.
 */

type SentryNode = typeof import("@sentry/node");

let sdk: Promise<SentryNode | null> | undefined;

function dsn(): string | undefined {
  return process.env.SENTRY_DSN || undefined;
}

function load(): Promise<SentryNode | null> {
  if (!sdk) {
    const key = dsn();
    sdk = key
      ? import("@sentry/node")
          .then((Sentry) => {
            Sentry.init({
              dsn: key,
              environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
              release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
              // Errors only. Tracing would double the Vercel invocation cost for
              // very little insight at this stage.
              tracesSampleRate: 0,
              sendDefaultPii: false,
            });
            return Sentry;
          })
          .catch((e) => {
            console.error("[monitoring] Sentry (server) failed to initialise", e);
            return null;
          })
      : Promise.resolve(null);
  }
  return sdk;
}

export type ServerErrorContext = {
  /** Where it happened, e.g. "server-fn", "ssr", "request". */
  source: string;
  /** Server function or route name when known. */
  name?: string;
  userId?: string | null;
  extra?: Record<string, unknown>;
};

const INTUIT_TID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/** QBO HTTP errors carry `intuitTid` (and `cause` when a server fn wraps them). */
function qboErrorFields(error: unknown): {
  intuitTid?: string;
  status?: number;
  path?: string;
  realmId?: string;
} {
  const seen = new Set<unknown>();
  const out: { intuitTid?: string; status?: number; path?: string; realmId?: string } = {};
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const row = current as {
      name?: unknown;
      intuitTid?: unknown;
      status?: unknown;
      path?: unknown;
      realmId?: unknown;
      cause?: unknown;
    };
    if (!out.intuitTid && typeof row.intuitTid === "string" && INTUIT_TID_RE.test(row.intuitTid)) {
      out.intuitTid = row.intuitTid;
    }
    if (row.name === "QboHttpError") {
      if (out.status == null && typeof row.status === "number" && Number.isFinite(row.status)) {
        out.status = row.status;
      }
      if (
        !out.path &&
        typeof row.path === "string" &&
        row.path.startsWith("/") &&
        !row.path.includes("?") &&
        row.path.length <= 300
      ) {
        out.path = row.path;
      }
      if (
        !out.realmId &&
        typeof row.realmId === "string" &&
        /^[0-9A-Za-z_-]{1,64}$/.test(row.realmId)
      ) {
        out.realmId = row.realmId;
      }
    }
    current = row.cause;
  }
  return out;
}

/**
 * Report and return. Never throws, never awaits the network on the caller's
 * path beyond the SDK's own buffering — callers should not `await` this in a
 * request-critical place unless they want the flush.
 */
export async function reportServerError(error: unknown, ctx: ServerErrorContext): Promise<void> {
  const Sentry = await load();
  if (!Sentry) return;
  const qbo = qboErrorFields(error);
  Sentry.withScope((scope) => {
    scope.setTag("source", ctx.source);
    if (ctx.name) scope.setTag("fn", ctx.name);
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    if (ctx.extra) scope.setContext("extra", ctx.extra);
    if (qbo.intuitTid) {
      scope.setTag("intuit_tid", qbo.intuitTid);
      scope.setExtra("intuit_tid", qbo.intuitTid);
      if (qbo.status != null) scope.setExtra("qbo_status", qbo.status);
      if (qbo.path) scope.setExtra("qbo_path", qbo.path);
      if (qbo.realmId) scope.setExtra("realm_id", qbo.realmId);
    }
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
}

/** Give buffered events a moment to leave before a serverless invocation ends. */
export async function flushServerErrors(timeoutMs = 2000): Promise<void> {
  const Sentry = await load();
  if (!Sentry) return;
  await Sentry.flush(timeoutMs).catch(() => undefined);
}
