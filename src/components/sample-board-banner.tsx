import { FlaskConical, Upload, X } from "lucide-react";

/**
 * Pinned above the tabs while the board is showing the sample business.
 * Nothing in sample mode is saved; this is the one place that says so and
 * offers the two exits — bring in real figures, or go back to the empty board.
 */
export function SampleBoardBanner({
  blurb,
  onUseMyFigures,
  onExit,
}: {
  blurb: string;
  onUseMyFigures: () => void;
  onExit: () => void;
}) {
  return (
    <div className="mb-3 flex flex-col gap-2.5 rounded-xl border border-sky-500/40 bg-sky-500/10 px-3.5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2.5">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-700 dark:text-sky-300">
            Sample business · nothing here is saved
          </p>
          <p className="mt-0.5 text-slate-700 dark:text-slate-200">{blurb}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onUseMyFigures}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#b7872a] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#d4a550]"
        >
          <Upload className="h-3.5 w-3.5" />
          Use my own figures
        </button>
        <button
          type="button"
          onClick={onExit}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-white/60 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <X className="h-3.5 w-3.5" />
          Exit sample
        </button>
      </div>
    </div>
  );
}
