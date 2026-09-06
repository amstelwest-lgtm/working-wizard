import { ChevronRight, Sparkles } from "lucide-react";
import { PROFILE_CORE_QUESTION_COUNT, PROFILE_QUESTION_COUNT } from "@/lib/client-profile";

/**
 * Sits beside the orb after a four-question first run. One line, one action:
 * finish the six deferred profile questions so the score, budget and advice
 * stop leaning on inferred defaults.
 */
export function ProfileCompletionNote({ onFinish }: { onFinish: () => void }) {
  const remaining = PROFILE_QUESTION_COUNT - PROFILE_CORE_QUESTION_COUNT;
  return (
    <div
      id="wizard-profile-note"
      className="flex flex-col gap-2 rounded-xl border border-[#d4a550]/30 bg-[#d4a550]/[0.06] px-3.5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#b8860b] dark:text-[#d4a550]" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b8860b] dark:text-[#d4a550]">
            Profile {PROFILE_CORE_QUESTION_COUNT} of {PROFILE_QUESTION_COUNT} answered
          </p>
          <p className="mt-0.5 text-slate-700 dark:text-slate-200">
            {remaining} quick taps sharpen your score, budget, benchmarks and advice. Until then
            they lean on sensible defaults for a business like yours.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onFinish}
        className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-[#b7872a]/50 bg-white px-3 py-1.5 text-xs font-semibold text-[#8a6508] transition-colors hover:bg-[#d4a550]/10 dark:bg-transparent dark:text-[#e1b85e]"
      >
        Finish profile
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
