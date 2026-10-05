import { TRIAL_BALANCE_REFRESH_COPY } from "@/lib/trial-balance-refresh";

export function TrialBalanceRefreshPrompt({ onImport }: { onImport: () => void }) {
  return (
    <div
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#c9962b]/50 bg-[#c9962b]/10 px-4 py-3"
      role="status"
    >
      <p className="text-sm font-medium text-slate-900 dark:text-amber-50">
        {TRIAL_BALANCE_REFRESH_COPY}
      </p>
      <button
        type="button"
        onClick={onImport}
        className="rounded-lg bg-[#b8860b] px-3 py-1.5 text-xs font-semibold text-[#0a0e1a] hover:bg-[#d4a550]"
      >
        Re-import trial balance
      </button>
    </div>
  );
}
