/**
 * Browser-side error reporting (Sentry).
 *
 * Does nothing unless VITE_SENTRY_DSN is set. The SDK is loaded with a dynamic
 * import so the main bundle is unchanged when monitoring is off. Safe to import
 * from code that also runs during SSR — every entry point checks for `window`.
 */

type SentryReact = typeof import("@sentry/react");

let sdk: Promise<SentryReact | null> | undefined;
let currentUserId: string | null = null;

function dsn(): string | undefined {
  return (import.meta.env.VITE_SENTRY_DSN as string | undefined) || undefined;
}

export function monitoringEnabled(): boolean {
  return typeof window !== "undefined" && Boolean(dsn());
}

/** Idempotent. Call once, early, in the browser. */
export function initMonitoring(): Promise<SentryReact | null> {
  if (sdk) return sdk;
  if (!monitoringEnabled()) {
    sdk = Promise.resolve(null);
    return sdk;
  }
  sdk = import("@sentry/react")
    .then((Sentry) => {
      Sentry.init({
        dsn: dsn(),
        environment: import.meta.env.MODE,
        release: (import.meta.env.VITE_RELEASE as string | undefined) || undefined,
        integrations: [
          // Root ErrorComponent and TabErrorBoundary already console.error what
          // they catch; this turns those into events without touching each site.
          Sentry.captureConsoleIntegration({ levels: ["error"] }),
        ],
        tracesSampleRate: 0,
        sendDefaultPii: false,
        ignoreErrors: [
          // Browser noise that is not ours to fix.
          /ResizeObserver loop/i,
          /Loading chunk \d+ failed/i,
          /Failed to fetch dynamically imported module/i,
        ],
      });
      if (currentUserId) Sentry.setUser({ id: currentUserId });
      return Sentry;
    })
    .catch((e) => {
      console.warn("[monitoring] Sentry (browser) failed to initialise", e);
      return null;
    });
  return sdk;
}

/** Attach or clear the signed-in user so events can be grouped per account. */
export function setMonitoringUser(userId: string | null): void {
  currentUserId = userId;
  if (!sdk) return;
  void sdk.then((Sentry) => Sentry?.setUser(userId ? { id: userId } : null));
}

export type ClientErrorContext = {
  /** Where it happened, e.g. "root-boundary", "tab:Profit", "upload". */
  source: string;
  extra?: Record<string, unknown>;
};

/** Report and return; never throws. */
export function reportClientError(error: unknown, ctx: ClientErrorContext): void {
  if (!monitoringEnabled()) return;
  void initMonitoring().then((Sentry) => {
    if (!Sentry) return;
    Sentry.withScope((scope) => {
      scope.setTag("source", ctx.source);
      if (ctx.extra) scope.setContext("extra", ctx.extra);
      Sentry.captureException(error instanceof Error ? error : new Error(String(error)));
    });
  });
}
