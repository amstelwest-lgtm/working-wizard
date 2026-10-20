/**
 * The line a statement upload shows after apply. Success names what changed.
 * Failure stays on the panel with Retry. A period mismatch stays open with
 * the two ways to file the statement. The panel does not close on failure.
 */
import type { PeriodChoice } from "@/lib/statement-import-plan";

export function ImportApplyNotice({
  message,
  tone,
  onRetry,
  replaceLabel,
  addLabel,
  onChoose,
}: {
  message: string | null;
  tone: "success" | "error" | "choice" | null;
  onRetry?: () => void;
  replaceLabel?: string | null;
  addLabel?: string | null;
  onChoose?: (choice: PeriodChoice) => void;
}) {
  if (!message || !tone) return null;
  if (tone === "choice") {
    return (
      <div
        role="status"
        data-import-apply="choice"
        className="rounded-md border border-amber-700/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-100"
      >
        <p>{message}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            data-import-choice="replace_ytd"
            onClick={() => onChoose?.("replace_ytd")}
            className="rounded-md border border-amber-300/50 px-3 py-1 text-xs font-semibold text-amber-50"
          >
            {replaceLabel || "Replace year-to-date"}
          </button>
          <button
            type="button"
            data-import-choice="add_period"
            onClick={() => onChoose?.("add_period")}
            className="rounded-md border border-amber-300/50 px-3 py-1 text-xs font-semibold text-amber-50"
          >
            {addLabel || "Add as its own period"}
          </button>
        </div>
      </div>
    );
  }
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
