/**
 * Named re-exports only. A namespace `import("@sentry/react")` keeps Replay
 * and BrowserTracing in the chunk even when `Sentry.init` never turns them on.
 */
export {
  init,
  captureConsoleIntegration,
  setUser,
  withScope,
  captureException,
} from "@sentry/react";
