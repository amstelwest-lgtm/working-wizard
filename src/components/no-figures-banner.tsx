import { Upload } from "lucide-react";

/**
 * Owner board, no real figures yet: one calm line at the top of a tab that
 * would otherwise show zeros or generic content, plus the single next action.
 */
export function NoFiguresBanner({
  tabLabel,
  detail,
  onAddFigures,
}: {
  tabLabel: string;
  detail: string;
  onAddFigures: () => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-[#d4a550]/35 bg-[#d4a550]/[0.07] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b8860b] dark:text-[#d4a550]">
          Step 2 of 2 · Bring in your numbers
        </p>
        <p className="mt-0.5 text-slate-700 dark:text-slate-200">
          <span className="font-semibold">{tabLabel} fills in from your figures.</span> {detail}
        </p>
      </div>
      <button
        type="button"
        onClick={onAddFigures}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#b7872a] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#d4a550]"
      >
        <Upload className="h-3.5 w-3.5" />
        Add figures
      </button>
    </div>
  );
}
