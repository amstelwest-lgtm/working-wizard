import { TRIAL_BALANCE_REFRESH_COPY } from "@/lib/trial-balance-refresh";

export function TrialBalanceRefreshPrompt({ onImport }: { onImport: () => void }) {
  return (
    <div
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#0B5FFF]/50 bg-[#0B5FFF]/10 px-4 py-3"
      role="status"
    >
      <p className="text-sm font-medium text-slate-900 dark:text-amber-50">
        {TRIAL_BALANCE_REFRESH_COPY}
      </p>
      <button
        type="button"
        onClick={onImport}
        className="rounded-lg bg-[#0B5FFF] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2563EB]"
      >
        Re-import trial balance
      </button>
    </div>
  );
}
