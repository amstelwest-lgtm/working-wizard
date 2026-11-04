import { useEffect, useMemo, useState } from "react";
import { useMarketFormat } from "@/contexts/market";
import type { GroupCompany } from "@/lib/client-group-client";
import {
  GROUP_ADDITIVE_SCALAR_KEYS,
  GROUP_CONSOLIDATION_LIMITS,
  buildGroupConsolidation,
  type CompanyConsolidationInput,
} from "@/lib/group-consolidation";
import {
  GROUP_COMBINED_FIGURE_LABELS,
  describeGroupConsolidationBlocker,
  loadGroupConsolidationMembers,
} from "@/lib/group-consolidation-load";

function parseAmount(raw: string | undefined): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function GroupCombinedFiguresPreview({
  companies,
  onOpenCompany,
}: {
  companies: readonly GroupCompany[];
  onOpenCompany?: (clientId: string) => void;
}) {
  const { money } = useMarketFormat();
  const [members, setMembers] = useState<CompanyConsolidationInput[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setMembers(null);
    setLoadError(null);
    void loadGroupConsolidationMembers(companies)
      .then((next) => {
        if (!cancel) setMembers(next);
      })
      .catch(() => {
        if (!cancel) setLoadError("Combined figures could not be loaded.");
      });
    return () => {
      cancel = true;
    };
  }, [companies]);

  const nameById = useMemo(
    () => new Map(companies.map((company) => [company.id, company.name])),
    [companies],
  );

  const result = useMemo(
    () => (members ? buildGroupConsolidation(members) : null),
    [members],
  );

  const previewKeys = useMemo(() => {
    if (!result?.ok) return GROUP_ADDITIVE_SCALAR_KEYS.slice();
    return GROUP_ADDITIVE_SCALAR_KEYS.filter((key) => result.combined[key] != null);
  }, [result]);

  return (
    <section
      className="space-y-3 rounded-xl border border-[#DBEAFE] bg-[#F8FBFF] p-4 dark:border-white/10 dark:bg-slate-900/40"
      data-group-combined-preview=""
    >
      <div>
        <h3 className="text-sm font-bold text-[#102A43] dark:text-slate-50">
          Combined figures (preview)
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-[#486581] dark:text-slate-400">
          Simple sum of each company&apos;s on-file statement. Preview only — no intercompany
          eliminations.
        </p>
      </div>

      <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[#486581] dark:text-slate-500">
        {GROUP_CONSOLIDATION_LIMITS.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {loadError ? (
        <p className="text-sm text-rose-700 dark:text-rose-300" role="status">
          {loadError}
        </p>
      ) : null}

      {!members && !loadError ? (
        <p className="text-sm text-[#486581] dark:text-slate-400">Loading figures…</p>
      ) : null}

      {result && !result.ok ? (
        <div
          className="rounded-lg border border-amber-300/80 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
          role="status"
        >
          <p className="font-semibold">Cannot show combined totals yet</p>
          <ul className="mt-1 list-disc pl-4">
            {result.blockers.map((blocker) => (
              <li key={`${blocker.kind}-${JSON.stringify(blocker)}`}>
                {describeGroupConsolidationBlocker(blocker, nameById)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result?.ok ? (
        <>
          <p className="text-xs text-[#486581] dark:text-slate-400">
            {result.periodLabel ? `${result.periodLabel} · ` : ""}
            Period end {result.periodDate}
            {result.currency ? ` · ${result.currency}` : ""}
          </p>
          <div className="overflow-x-auto rounded-lg border border-[#DBEAFE] bg-white dark:border-white/10 dark:bg-slate-950/40">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="bg-[#F4F8FF] text-[11px] uppercase tracking-[0.12em] text-[#486581] dark:bg-slate-900 dark:text-slate-400">
                  <th className="px-3 py-2 font-bold">Line</th>
                  {members?.map((member) => (
                    <th key={member.clientId} className="px-3 py-2 font-bold">
                      <button
                        type="button"
                        className="text-left font-bold text-[#0B5FFF] underline-offset-2 hover:underline"
                        onClick={() => onOpenCompany?.(member.clientId)}
                      >
                        {member.name}
                      </button>
                    </th>
                  ))}
                  <th className="px-3 py-2 font-bold">Combined</th>
                </tr>
              </thead>
              <tbody>
                {previewKeys.map((key) => {
                  const label = GROUP_COMBINED_FIGURE_LABELS[key] ?? key;
                  const combined = parseAmount(result.combined[key]);
                  return (
                    <tr
                      key={key}
                      className="border-t border-[#EEF4FF] dark:border-white/10"
                    >
                      <td className="px-3 py-2 text-[#486581] dark:text-slate-300">{label}</td>
                      {members?.map((member) => {
                        const n = parseAmount(member.financials[key]);
                        return (
                          <td
                            key={member.clientId}
                            className="px-3 py-2 tabular-nums text-[#102A43] dark:text-slate-100"
                          >
                            {n == null ? "—" : money(n)}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 font-semibold tabular-nums text-[#102A43] dark:text-slate-50">
                        {combined == null ? "—" : money(combined)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
