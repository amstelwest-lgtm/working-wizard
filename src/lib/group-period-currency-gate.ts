/**
 * L1 year-end / currency **gate stub** for group consolidation preview.
 *
 * Surfaces planned hard-stop reasons from company metadata and existing
 * consolidation blockers. Does not apply gates or change combined totals.
 */

import type { GroupCompany } from "@/lib/client-group-client";
import { yearEndLabel } from "@/lib/client-groups";
import {
  groupConsolidationBlockers,
  type CompanyConsolidationInput,
  type GroupConsolidationBlocker,
} from "@/lib/group-consolidation";

export type PeriodCurrencyGateMemberYearEnd = {
  clientId: string;
  yearEndMonth: number | null;
};

export type PeriodCurrencyGateMemberCurrency = {
  clientId: string;
  currency: string | null;
};

export type GroupPeriodCurrencyGateStub = {
  /** Always empty until the real L1 gate exists. */
  appliedGates: readonly [];
  headline: string;
  detail: string;
  notAppliedReasons: readonly string[];
  /** True when year-end and/or currency metadata implies a planned gate. */
  gateNeeded: boolean;
  mixedYearEnd: boolean;
  mixedCurrency: boolean;
  memberYearEnds: readonly PeriodCurrencyGateMemberYearEnd[];
  memberCurrencies: readonly PeriodCurrencyGateMemberCurrency[];
  /** Human-readable planned block lines derived from blockers + metadata. */
  plannedBlockReasons: readonly string[];
};

const PLANNED_NOT_APPLIED = [
  "L1 year-end / currency gate not enforced in preview yet",
  "No group reporting period picker",
  "Combined preview still uses today’s blocker rules only",
] as const;

function normalizeCurrency(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function normalizeYearEndMonth(value: number | null | undefined): number | null {
  if (value == null || value < 1 || value > 12) return null;
  return value;
}

export function memberYearEndsFromCompanies(
  companies: readonly Pick<GroupCompany, "id" | "yearEndMonth">[],
): PeriodCurrencyGateMemberYearEnd[] {
  return companies.map((company) => ({
    clientId: company.id,
    yearEndMonth: normalizeYearEndMonth(company.yearEndMonth),
  }));
}

export function memberCurrenciesFromGateInputs(
  members: readonly Pick<CompanyConsolidationInput, "clientId" | "currency">[],
): PeriodCurrencyGateMemberCurrency[] {
  return members.map((member) => ({
    clientId: member.clientId,
    currency: normalizeCurrency(member.currency),
  }));
}

function distinctYearEndMonths(
  rows: readonly PeriodCurrencyGateMemberYearEnd[],
): number[] {
  return [
    ...new Set(rows.map((row) => row.yearEndMonth).filter((m): m is number => m != null)),
  ];
}

function distinctCurrencies(
  rows: readonly PeriodCurrencyGateMemberCurrency[],
): string[] {
  return [
    ...new Set(rows.map((row) => row.currency).filter((c): c is string => !!c)),
  ];
}

function plannedBlockReasonsFromBlockers(
  blockers: readonly GroupConsolidationBlocker[],
): string[] {
  const lines: string[] = [];
  for (const blocker of blockers) {
    if (blocker.kind === "currency_mismatch") {
      lines.push(
        `Planned gate: mixed reporting currencies (${blocker.currencies.join(", ")}) — combined totals stay blocked until FX exists`,
      );
    }
    if (blocker.kind === "period_mismatch") {
      lines.push(
        `Planned gate: different statement period ends on file (${blocker.periodDates.join(", ")}) — align period or upload matching dates`,
      );
    }
    if (blocker.kind === "missing_period") {
      lines.push("Planned gate: missing period end on one or more companies");
    }
  }
  return lines;
}

export type BuildPeriodCurrencyGateStubInput = {
  companies: readonly Pick<GroupCompany, "id" | "yearEndMonth">[];
  members: readonly CompanyConsolidationInput[];
};

/**
 * Surface planned year-end / currency gate copy from metadata and blockers.
 * Never mutates figures.
 */
export function buildPeriodCurrencyGateStub(
  input: BuildPeriodCurrencyGateStubInput,
): GroupPeriodCurrencyGateStub {
  const memberYearEnds = memberYearEndsFromCompanies(input.companies);
  const memberCurrencies = memberCurrenciesFromGateInputs(input.members);
  const yearEndValues = distinctYearEndMonths(memberYearEnds);
  const currencyValues = distinctCurrencies(memberCurrencies);
  const mixedYearEnd = yearEndValues.length > 1;
  const mixedCurrency = currencyValues.length > 1;

  const blockers =
    input.members.length >= 2 ? groupConsolidationBlockers(input.members) : [];
  const plannedBlockReasons = [
    ...(mixedYearEnd
      ? [
          `Planned gate: different financial year-ends on file (${yearEndValues.map((m) => yearEndLabel(m)).join(", ")})`,
        ]
      : []),
    ...(mixedCurrency
      ? [
          `Planned gate: different reporting currencies (${currencyValues.join(", ")})`,
        ]
      : []),
    ...plannedBlockReasonsFromBlockers(blockers),
  ];

  const gateNeeded = mixedYearEnd || mixedCurrency;

  if (!gateNeeded) {
    return {
      appliedGates: [],
      headline: "Year-end / currency gate: not needed",
      detail:
        "Every company shares the same financial year-end and reporting currency on file. No L1 gate card is shown.",
      notAppliedReasons: [...PLANNED_NOT_APPLIED],
      gateNeeded: false,
      mixedYearEnd: false,
      mixedCurrency: false,
      memberYearEnds,
      memberCurrencies,
      plannedBlockReasons: [],
    };
  }

  const headline = "Year-end / currency gate: planned block";
  const detail = mixedYearEnd
    ? mixedCurrency
      ? "Companies differ on financial year-end and reporting currency. A future L1 gate will block group consolidation until both align (or FX applies)."
      : "Companies differ on financial year-end month. Combined preview may still sum when statement period ends match — the L1 gate is planned for mismatched year-ends."
    : "Companies report in different currencies. Combined totals stay blocked until FX translation exists — the L1 gate will enforce this.";

  return {
    appliedGates: [],
    headline,
    detail,
    notAppliedReasons: [...PLANNED_NOT_APPLIED],
    gateNeeded: true,
    mixedYearEnd,
    mixedCurrency,
    memberYearEnds,
    memberCurrencies,
    plannedBlockReasons,
  };
}

export function describeGateMemberYearEnd(
  row: PeriodCurrencyGateMemberYearEnd,
  nameById: ReadonlyMap<string, string>,
): string {
  const name = nameById.get(row.clientId) ?? row.clientId;
  return `${name} · FY end ${yearEndLabel(row.yearEndMonth)}`;
}

export function describeGateMemberCurrency(
  row: PeriodCurrencyGateMemberCurrency,
  nameById: ReadonlyMap<string, string>,
): string {
  const name = nameById.get(row.clientId) ?? row.clientId;
  const code = row.currency ?? "currency not set";
  return `${name} · ${code}`;
}

/** Locks preview behaviour: gate stub must not alter additive combined totals. */
export function combinedFiguresUnchanged(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if ((before[key] ?? "") !== (after[key] ?? "")) return false;
  }
  return true;
}
