/**
 * FX translation **stub** for group consolidation preview.
 *
 * Describes reporting currencies and explicit “not applied” reasons only. Does
 * not read rates, post journals, or change combined totals.
 */

import type { CompanyConsolidationInput } from "@/lib/group-consolidation";

export type GroupFxMemberCurrency = {
  clientId: string;
  currency: string | null;
};

export type GroupFxStub = {
  /** Always empty until real translation journals exist. */
  appliedTranslations: readonly [];
  headline: string;
  detail: string;
  notAppliedReasons: readonly string[];
  memberCurrencies: readonly GroupFxMemberCurrency[];
  /** True when more than one distinct non-empty currency appears on members. */
  mixedCurrency: boolean;
  /** True when every member shares one reporting currency. */
  sameCurrencyGroup: boolean;
};

const BASE_NOT_APPLIED = [
  "No FX rates on file",
  "No translation journal postings",
] as const;

function normalizeCurrency(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

export function memberCurrenciesFromConsolidationInputs(
  members: readonly Pick<CompanyConsolidationInput, "clientId" | "currency">[],
): GroupFxMemberCurrency[] {
  return members.map((member) => ({
    clientId: member.clientId,
    currency: normalizeCurrency(member.currency),
  }));
}

/**
 * Surface reporting currencies and explicit “FX not applied” copy. Never mutates figures.
 */
export function buildFxStub(
  members: readonly Pick<CompanyConsolidationInput, "clientId" | "currency">[],
): GroupFxStub {
  const memberCurrencies = memberCurrenciesFromConsolidationInputs(members);
  const distinct = [
    ...new Set(memberCurrencies.map((row) => row.currency).filter((c): c is string => !!c)),
  ];
  const mixedCurrency = distinct.length > 1;
  const sameCurrencyGroup = distinct.length === 1;

  if (sameCurrencyGroup) {
    const code = distinct[0] ?? null;
    return {
      appliedTranslations: [],
      headline: "FX: none applied — same-currency group",
      detail: code
        ? `Every company reports in ${code}. Combined preview stays a simple sum; translation is not required.`
        : "Every company uses the same reporting currency on file. Translation is not required for this preview.",
      notAppliedReasons: [
        ...BASE_NOT_APPLIED,
        "Same reporting currency — FX translation not needed",
      ],
      memberCurrencies,
      mixedCurrency: false,
      sameCurrencyGroup: true,
    };
  }

  if (mixedCurrency) {
    return {
      appliedTranslations: [],
      headline: "FX: none applied",
      detail:
        "Companies report in different currencies. Combined totals stay blocked until FX translation is implemented — no rates are invented in preview.",
      notAppliedReasons: [
        ...BASE_NOT_APPLIED,
        "Mixed currencies block combined totals until FX translation exists",
        "FX translation for group preview is planned — not applied yet",
      ],
      memberCurrencies,
      mixedCurrency: true,
      sameCurrencyGroup: false,
    };
  }

  return {
    appliedTranslations: [],
    headline: "FX: none applied",
    detail:
      "Set each company’s reporting currency on file to preview whether group FX translation will be needed.",
    notAppliedReasons: [...BASE_NOT_APPLIED, "Reporting currency missing on one or more companies"],
    memberCurrencies,
    mixedCurrency: false,
    sameCurrencyGroup: false,
  };
}

export function describeMemberCurrency(
  row: GroupFxMemberCurrency,
  nameById: ReadonlyMap<string, string>,
): string {
  const name = nameById.get(row.clientId) ?? row.clientId;
  const code = row.currency ?? "currency not set";
  return `${name} · ${code}`;
}

/** Locks preview behaviour: FX stub must not alter additive combined totals. */
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
