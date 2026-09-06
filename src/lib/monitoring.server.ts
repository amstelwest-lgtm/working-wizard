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

/**
 * Report and return. Never throws, never awaits the network on the caller's
 * path beyond the SDK's own buffering — callers should not `await` this in a
 * request-critical place unless they want the flush.
 */
export async function reportServerError(error: unknown, ctx: ServerErrorContext): Promise<void> {
  const Sentry = await load();
  if (!Sentry) return;
  Sentry.withScope((scope) => {
    scope.setTag("source", ctx.source);
    if (ctx.name) scope.setTag("fn", ctx.name);
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    if (ctx.extra) scope.setContext("extra", ctx.extra);
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
  });
}

/** Give buffered events a moment to leave before a serverless invocation ends. */
export async function flushServerErrors(timeoutMs = 2000): Promise<void> {
  const Sentry = await load();
  if (!Sentry) return;
  await Sentry.flush(timeoutMs).catch(() => undefined);
}
