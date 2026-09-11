/**
 * AutoPopulateOptions — the "what else does this upload update?" block shown
 * in every statement upload dialog (owner and accountant).
 *
 * First upload: a notice — everything is drafted, no choices to make.
 * Later uploads: three checkboxes + remember-my-choice.
 */

import { Sparkles } from "lucide-react";
import {
  AUTO_POPULATE_HINT,
  AUTO_POPULATE_LABEL,
  AUTO_POPULATE_TARGETS,
  type AutoPopulatePrefs,
} from "@/lib/auto-populate";

export type AutoPopulateOptionsProps = {
  firstUpload: boolean;
  value: AutoPopulatePrefs;
  onChange: (next: AutoPopulatePrefs) => void;
  /** Who signs off — copy only. */
  role?: "owner" | "accountant";
  className?: string;
};

export const AUTO_POPULATE_FIRST_UPLOAD_COPY =
  "First upload — Milōn drafts your profitability, cash forecast and budget from these statements. Nothing is final until your accountant reviews and signs off.";

export function AutoPopulateOptions({
  firstUpload,
  value,
  onChange,
  role = "owner",
  className = "",
}: AutoPopulateOptionsProps) {
  if (firstUpload) {
    return (
      <div
        data-auto-populate="first"
        className={`flex items-start gap-2 rounded-md border border-[#b8860b]/35 bg-[#b8860b]/8 px-3 py-2.5 text-xs leading-relaxed text-slate-800 dark:text-slate-200 ${className}`}
      >
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#b8860b]" />
        <span>
          {role === "accountant"
            ? "First upload for this client — Milōn drafts profitability, cash forecast and budget from these statements. Each tab then waits for your sign-off."
            : AUTO_POPULATE_FIRST_UPLOAD_COPY}
        </span>
      </div>
    );
  }

  return (
    <fieldset
      data-auto-populate="options"
      className={`rounded-md border border-amber-900/15 bg-amber-50/40 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/60 ${className}`}
    >
      <legend className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b8860b]">
        Also update from this upload
      </legend>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {AUTO_POPULATE_TARGETS.map((t) => (
          <label
            key={t}
            className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-xs hover:bg-amber-100/60 dark:hover:bg-slate-800/60"
          >
            <input
              type="checkbox"
              checked={value[t]}
              onChange={(e) => onChange({ ...value, [t]: e.target.checked })}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#b8860b]"
            />
            <span className="min-w-0">
              <span className="block font-medium text-slate-900 dark:text-slate-100">
                {AUTO_POPULATE_LABEL[t]}
              </span>
              <span className="block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                {AUTO_POPULATE_HINT[t]}
              </span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-amber-900/10 pt-2 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={value.remember}
            onChange={(e) => onChange({ ...value, remember: e.target.checked })}
            className="h-3 w-3 accent-[#b8860b]"
          />
          Remember for next upload
        </label>
        <span>
          Updated deliverables need {role === "accountant" ? "your" : "accountant"} sign-off again.
        </span>
      </div>
    </fieldset>
  );
}
