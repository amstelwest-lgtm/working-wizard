import { useEffect, useMemo, useState } from "react";
import { useMarketFormat } from "@/contexts/market";
import { formatCalendarDay } from "@/lib/market/format";
import type { GroupCompany, OwnershipEdgeRow } from "@/lib/client-group-client";
import {
  GROUP_ADDITIVE_SCALAR_KEYS,
  GROUP_CONSOLIDATION_LIMITS,
  buildGroupConsolidation,
  type CompanyConsolidationInput,
  type GroupConsolidationBlocker,
} from "@/lib/group-consolidation";
import {
  GROUP_COMBINED_FIGURE_LABELS,
  describeGroupConsolidationBlocker,
  loadGroupConsolidationBundle,
  membersAtAlignedPeriod,
  type GroupConsolidationFigureBundle,
} from "@/lib/group-consolidation-load";
import {
  buildEliminationsStub,
  describeIntercompanyCandidatePair,
} from "@/lib/group-eliminations";
import { buildFxStub, describeMemberCurrency } from "@/lib/group-fx";
import { buildControlStub, describeControlOwnershipCandidate } from "@/lib/group-control";
import { buildGroupHealthStub } from "@/lib/group-health";
import {
  buildIntercompanyFlagsStub,
  describeIntercompanyFlagCandidate,
} from "@/lib/group-intercompany-flags";
import {
  buildPeriodCurrencyGateStub,
  describeGateMemberCurrency,
  describeGateMemberYearEnd,
} from "@/lib/group-period-currency-gate";
import { buildNciStub, describeNciOwnershipCandidate } from "@/lib/group-nci";

function parseAmount(raw: string | undefined): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function hasPeriodMismatch(blockers: readonly GroupConsolidationBlocker[]): boolean {
  return blockers.some((blocker) => blocker.kind === "period_mismatch");
}

export function GroupCombinedFiguresPreview({
  companies,
  ownershipEdges = [],
  onOpenCompany,
}: {
  companies: readonly GroupCompany[];
  ownershipEdges?: readonly OwnershipEdgeRow[];
  onOpenCompany?: (clientId: string) => void;
}) {
  const { money, market } = useMarketFormat();
  const [bundle, setBundle] = useState<GroupConsolidationFigureBundle | null>(null);
  const [alignedPeriod, setAlignedPeriod] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setBundle(null);
    setAlignedPeriod(null);
    setLoadError(null);
    void loadGroupConsolidationBundle(companies)
      .then((next) => {
        if (!cancel) setBundle(next);
      })
      .catch(() => {
        if (!cancel) setLoadError("Combined figures could not be loaded.");
      });
    return () => {
      cancel = true;
    };
  }, [companies]);

  const defaultResult = useMemo(
    () => (bundle ? buildGroupConsolidation(bundle.members) : null),
    [bundle],
  );

  useEffect(() => {
    if (!bundle || alignedPeriod) return;
    if (defaultResult?.ok) return;
    if (!defaultResult || !hasPeriodMismatch(defaultResult.blockers)) return;
    if (bundle.overlappingPeriodDates.length === 1) {
      setAlignedPeriod(bundle.overlappingPeriodDates[0] ?? null);
    }
  }, [alignedPeriod, bundle, defaultResult]);

  const activeMembers = useMemo((): CompanyConsolidationInput[] | null => {
    if (!bundle) return null;
    if (!alignedPeriod) return bundle.members;
    return membersAtAlignedPeriod(
      companies,
      bundle.snapshotsByClient,
      bundle.liveByClient,
      alignedPeriod,
    );
  }, [alignedPeriod, bundle, companies]);

  const nameById = useMemo(
    () => new Map(companies.map((company) => [company.id, company.name])),
    [companies],
  );

  const result = useMemo(
    () => (activeMembers ? buildGroupConsolidation(activeMembers) : null),
    [activeMembers],
  );

  const previewKeys = useMemo(() => {
    if (!result?.ok) return GROUP_ADDITIVE_SCALAR_KEYS.slice();
    return GROUP_ADDITIVE_SCALAR_KEYS.filter((key) => result.combined[key] != null);
  }, [result]);

  const eliminationsStub = useMemo(
    () => buildEliminationsStub(ownershipEdges),
    [ownershipEdges],
  );

  const fxStub = useMemo(
    () => (activeMembers ? buildFxStub(activeMembers) : null),
    [activeMembers],
  );

  const nciStub = useMemo(() => buildNciStub(ownershipEdges), [ownershipEdges]);

  const healthStub = useMemo(
    () =>
      buildGroupHealthStub({
        memberCount: activeMembers?.length ?? 0,
        consolidationOk: result?.ok ?? false,
        combined: result?.ok ? result.combined : null,
      }),
    [activeMembers, result],
  );

  const controlStub = useMemo(() => buildControlStub(ownershipEdges), [ownershipEdges]);

  const memberClientIds = useMemo(
    () =>
      activeMembers
        ? activeMembers.map((member) => member.clientId)
        : companies.map((company) => company.id),
    [activeMembers, companies],
  );

  const intercompanyFlagsStub = useMemo(
    () =>
      buildIntercompanyFlagsStub({
        edges: ownershipEdges,
        memberClientIds,
      }),
    [memberClientIds, ownershipEdges],
  );

  const periodCurrencyGateStub = useMemo(
    () =>
      buildPeriodCurrencyGateStub({
        companies,
        members: activeMembers ?? [],
      }),
    [activeMembers, companies],
  );

  const showConsolidationStubs =
    activeMembers &&
    activeMembers.length >= 2 &&
    (result?.ok ||
      (result &&
        !result.ok &&
        result.blockers.some((blocker) => blocker.kind === "currency_mismatch")));

  const showFxStub = showConsolidationStubs && fxStub;
  const showNciStub = showConsolidationStubs && nciStub;
  const showHealthStub = showConsolidationStubs && healthStub;
  const showControlStub = showConsolidationStubs && controlStub;
  const showIntercompanyFlagsStub =
    showConsolidationStubs && intercompanyFlagsStub.flagsPlanned;
  const showPeriodCurrencyGateStub =
    showConsolidationStubs && periodCurrencyGateStub.gateNeeded;

  const showPeriodAlign =
    bundle &&
    defaultResult &&
    !defaultResult.ok &&
    hasPeriodMismatch(defaultResult.blockers) &&
    !defaultResult.blockers.some((blocker) => blocker.kind === "currency_mismatch");

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

      {!bundle && !loadError ? (
        <p className="text-sm text-[#486581] dark:text-slate-400">Loading figures…</p>
      ) : null}

      {showPeriodAlign ? (
        <div
          className="space-y-2 rounded-lg border border-[#DBEAFE] bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-slate-950/40"
          data-group-period-align=""
        >
          <p className="font-semibold text-[#102A43] dark:text-slate-50">Align period end</p>
          <p className="text-xs leading-relaxed text-[#486581] dark:text-slate-400">
            Each company can keep its own current statement. Choose a period end that exists on
            file for every company to preview combined totals without changing books.
          </p>
          <ul className="text-xs text-[#486581] dark:text-slate-400">
            {bundle.coverages.map((row) => (
              <li key={row.clientId}>
                <span className="font-medium text-[#102A43] dark:text-slate-200">{row.name}</span>
                {" · current "}
                {row.currentPeriodDate
                  ? formatCalendarDay(row.currentPeriodDate, market)
                  : "period not set"}
              </li>
            ))}
          </ul>
          {bundle.overlappingPeriodDates.length > 0 ? (
            <label className="mt-1 block text-xs text-[#486581] dark:text-slate-400">
              Shared period end on file
              <select
                className="mt-1 w-full max-w-md rounded border border-[#DBEAFE] bg-white px-2 py-1.5 text-sm text-[#102A43] dark:border-white/15 dark:bg-slate-900 dark:text-slate-100"
                value={alignedPeriod ?? ""}
                onChange={(event) => {
                  const next = event.target.value.trim();
                  setAlignedPeriod(next || null);
                }}
              >
                <option value="">Select period end…</option>
                {bundle.overlappingPeriodDates.map((day) => (
                  <option key={day} value={day}>
                    {formatCalendarDay(day, market)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-xs text-amber-900 dark:text-amber-100">
              No shared period end on file across these companies. Upload or sync statements to
              the same period end, then return here.
            </p>
          )}
        </div>
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
            Period end {formatCalendarDay(result.periodDate, market)}
            {alignedPeriod ? " · aligned preview" : ""}
            {result.currency ? ` · ${result.currency}` : ""}
          </p>
          <div className="overflow-x-auto rounded-lg border border-[#DBEAFE] bg-white dark:border-white/10 dark:bg-slate-950/40">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="bg-[#F4F8FF] text-[11px] uppercase tracking-[0.12em] text-[#486581] dark:bg-slate-900 dark:text-slate-400">
                  <th className="px-3 py-2 font-bold">Line</th>
                  {activeMembers?.map((member) => (
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
                      {activeMembers?.map((member) => {
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

          <div
            className="space-y-2 rounded-lg border border-dashed border-[#C9D8F0] bg-[#F4F8FF]/80 px-3 py-2 dark:border-white/15 dark:bg-slate-900/30"
            data-group-eliminations-stub=""
          >
            <p className="text-xs font-semibold text-[#102A43] dark:text-slate-100">
              Intercompany eliminations (planned)
            </p>
            <p className="text-xs leading-relaxed text-[#486581] dark:text-slate-400">
              {eliminationsStub.headline}. {eliminationsStub.detail}
            </p>
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[#486581] dark:text-slate-500">
              {eliminationsStub.notAppliedReasons.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {eliminationsStub.candidatePairs.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-xs text-[#486581] dark:text-slate-300">
                {eliminationsStub.candidatePairs.map((pair) => (
                  <li key={pair.edgeId}>
                    {describeIntercompanyCandidatePair(pair, nameById)}
                    <span className="text-[#829AB1] dark:text-slate-500"> · metadata only</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}

      {showFxStub && fxStub ? (
        <div
          className="space-y-2 rounded-lg border border-dashed border-[#C9D8F0] bg-[#F4F8FF]/80 px-3 py-2 dark:border-white/15 dark:bg-slate-900/30"
          data-group-fx-stub=""
        >
          <p className="text-xs font-semibold text-[#102A43] dark:text-slate-100">
            FX translation (planned)
          </p>
          <p className="text-xs leading-relaxed text-[#486581] dark:text-slate-400">
            {fxStub.headline}. {fxStub.detail}
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[#486581] dark:text-slate-500">
            {fxStub.notAppliedReasons.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {fxStub.mixedCurrency ? (
            <ul className="mt-1 space-y-0.5 text-xs text-[#486581] dark:text-slate-300">
              {fxStub.memberCurrencies.map((row) => (
                <li key={row.clientId}>{describeMemberCurrency(row, nameById)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {showNciStub ? (
        <div
          className="space-y-2 rounded-lg border border-dashed border-[#C9D8F0] bg-[#F4F8FF]/80 px-3 py-2 dark:border-white/15 dark:bg-slate-900/30"
          data-group-nci-stub=""
        >
          <p className="text-xs font-semibold text-[#102A43] dark:text-slate-100">
            NCI / ownership (planned)
          </p>
          <p className="text-xs leading-relaxed text-[#486581] dark:text-slate-400">
            {nciStub.headline}. {nciStub.detail}
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[#486581] dark:text-slate-500">
            {nciStub.notAppliedReasons.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {nciStub.candidateHoldings.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-xs text-[#486581] dark:text-slate-300">
              {nciStub.candidateHoldings.map((candidate) => (
                <li key={candidate.edgeId}>
                  {describeNciOwnershipCandidate(candidate, nameById)}
                  <span className="text-[#829AB1] dark:text-slate-500"> · metadata only</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {showHealthStub ? (
        <div
          className="space-y-2 rounded-lg border border-dashed border-[#C9D8F0] bg-[#F4F8FF]/80 px-3 py-2 dark:border-white/15 dark:bg-slate-900/30"
          data-group-health-stub=""
        >
          <p className="text-xs font-semibold text-[#102A43] dark:text-slate-100">
            Group Health (planned)
          </p>
          <p className="text-xs leading-relaxed text-[#486581] dark:text-slate-400">
            {healthStub.headline}. {healthStub.detail}
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[#486581] dark:text-slate-500">
            {healthStub.notAppliedReasons.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {healthStub.combinedInputLabels.length > 0 ? (
            <p className="text-[11px] text-[#486581] dark:text-slate-400">
              Combined inputs on file: {healthStub.combinedInputLabels.join(" · ")}
            </p>
          ) : null}
          {healthStub.plannedRatioLabels.length > 0 ? (
            <p className="text-[11px] text-[#486581] dark:text-slate-400">
              Planned group ratios ({healthStub.plannedRatioLabels.length}):{" "}
              {healthStub.plannedRatioLabels.slice(0, 6).join(" · ")}
              {healthStub.plannedRatioLabels.length > 6 ? " · …" : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {showControlStub ? (
        <div
          className="space-y-2 rounded-lg border border-dashed border-[#C9D8F0] bg-[#F4F8FF]/80 px-3 py-2 dark:border-white/15 dark:bg-slate-900/30"
          data-group-control-stub=""
        >
          <p className="text-xs font-semibold text-[#102A43] dark:text-slate-100">
            Ownership / control (planned)
          </p>
          <p className="text-xs leading-relaxed text-[#486581] dark:text-slate-400">
            {controlStub.headline}. {controlStub.detail}
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[#486581] dark:text-slate-500">
            {controlStub.notAppliedReasons.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {controlStub.candidateEdges.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-xs text-[#486581] dark:text-slate-300">
              {controlStub.candidateEdges.map((candidate) => (
                <li key={candidate.edgeId}>
                  {describeControlOwnershipCandidate(candidate, nameById)}
                  <span className="text-[#829AB1] dark:text-slate-500"> · metadata only</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {showIntercompanyFlagsStub ? (
        <div
          className="space-y-2 rounded-lg border border-dashed border-[#C9D8F0] bg-[#F4F8FF]/80 px-3 py-2 dark:border-white/15 dark:bg-slate-900/30"
          data-group-intercompany-flags-stub=""
        >
          <p className="text-xs font-semibold text-[#102A43] dark:text-slate-100">
            Intercompany flags (planned)
          </p>
          <p className="text-xs leading-relaxed text-[#486581] dark:text-slate-400">
            {intercompanyFlagsStub.headline}. {intercompanyFlagsStub.detail}
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[#486581] dark:text-slate-500">
            {intercompanyFlagsStub.notAppliedReasons.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {intercompanyFlagsStub.candidateFlags.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-xs text-[#486581] dark:text-slate-300">
              {intercompanyFlagsStub.candidateFlags.map((candidate) => (
                <li key={candidate.edgeId}>
                  {describeIntercompanyFlagCandidate(candidate, nameById)}
                  <span className="text-[#829AB1] dark:text-slate-500"> · metadata only</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {showPeriodCurrencyGateStub ? (
        <div
          className="space-y-2 rounded-lg border border-dashed border-[#C9D8F0] bg-[#F4F8FF]/80 px-3 py-2 dark:border-white/15 dark:bg-slate-900/30"
          data-group-period-currency-gate-stub=""
        >
          <p className="text-xs font-semibold text-[#102A43] dark:text-slate-100">
            Year-end / currency (planned)
          </p>
          <p className="text-xs leading-relaxed text-[#486581] dark:text-slate-400">
            {periodCurrencyGateStub.headline}. {periodCurrencyGateStub.detail}
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-[#486581] dark:text-slate-500">
            {periodCurrencyGateStub.notAppliedReasons.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {periodCurrencyGateStub.plannedBlockReasons.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-amber-950 dark:text-amber-100">
              {periodCurrencyGateStub.plannedBlockReasons.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {periodCurrencyGateStub.mixedYearEnd ? (
            <ul className="mt-1 space-y-0.5 text-xs text-[#486581] dark:text-slate-300">
              {periodCurrencyGateStub.memberYearEnds.map((row) => (
                <li key={row.clientId}>{describeGateMemberYearEnd(row, nameById)}</li>
              ))}
            </ul>
          ) : null}
          {periodCurrencyGateStub.mixedCurrency ? (
            <ul className="mt-1 space-y-0.5 text-xs text-[#486581] dark:text-slate-300">
              {periodCurrencyGateStub.memberCurrencies.map((row) => (
                <li key={row.clientId}>{describeGateMemberCurrency(row, nameById)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
