/**
 * The line a statement upload shows after apply. Success names what changed.
 * Failure stays on the panel with Retry. The panel does not close on failure.
 */
export function ImportApplyNotice({
  message,
  tone,
  onRetry,
}: {
  message: string | null;
  tone: "success" | "error" | null;
  onRetry?: () => void;
}) {
  if (!message || !tone) return null;
  if (tone === "error") {
    return (
      <div
        role="alert"
        data-import-apply="error"
        className="rounded-md border border-red-800/50 bg-red-950/40 px-3 py-2 text-sm text-red-200"
      >
        <p>{message}</p>
        {onRetry ? (
          <button
            type="button"
            data-import-retry
            onClick={onRetry}
            className="mt-2 rounded-md border border-red-300/40 px-3 py-1 text-xs font-semibold text-red-100"
          >
            Retry
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <p
      role="status"
      data-import-apply="success"
      className="rounded-md border border-emerald-700/50 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-200"
    >
      {message}
    </p>
  );
}
