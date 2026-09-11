/**
 * UploadVisibilityChoice — the "who can see this file?" block shown on every
 * owner-side upload before the files are read. Two explicit options, default
 * private; nothing is shared unless the owner picks it.
 */

import { Lock, Users } from "lucide-react";
import {
  UPLOAD_VISIBILITIES,
  UPLOAD_VISIBILITY_COPY,
  UPLOAD_VISIBILITY_INTRO,
  type UploadVisibility,
} from "@/lib/client-documents";

export type UploadVisibilityChoiceProps = {
  value: UploadVisibility;
  onChange: (next: UploadVisibility) => void;
  /** Distinguishes several groups on one page. */
  name?: string;
  disabled?: boolean;
  className?: string;
};

export function UploadVisibilityChoice({
  value,
  onChange,
  name = "upload-visibility",
  disabled = false,
  className = "",
}: UploadVisibilityChoiceProps) {
  return (
    <fieldset
      data-upload-visibility={value}
      disabled={disabled}
      className={`rounded-md border border-amber-900/15 bg-amber-50/40 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/60 ${className}`}
    >
      <legend className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b8860b]">
        Who can see these files
      </legend>
      <p className="mb-2 text-[11px] leading-snug text-slate-600 dark:text-slate-400">
        {UPLOAD_VISIBILITY_INTRO}
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {UPLOAD_VISIBILITIES.map((v) => {
          const copy = UPLOAD_VISIBILITY_COPY[v];
          const Icon = v === "shared" ? Users : Lock;
          const selected = value === v;
          return (
            <label
              key={v}
              className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-xs transition-colors ${
                selected
                  ? "border-[#b8860b]/60 bg-white dark:border-[#b7872a]/70 dark:bg-slate-950"
                  : "border-transparent hover:bg-amber-100/60 dark:hover:bg-slate-800/60"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={v}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(v)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#b8860b]"
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-slate-100">
                  <Icon className="h-3.5 w-3.5 text-[#b8860b]" />
                  {copy.label}
                </span>
                <span className="block text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  {copy.help}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 border-t border-amber-900/10 pt-2 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        You can change this for any file later under Financial Data → Your uploads.
      </p>
    </fieldset>
  );
}
