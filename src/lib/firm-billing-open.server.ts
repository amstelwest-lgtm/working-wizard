/**
 * Open-path billing answer from firms.billing_plan_known.
 * Stripe is not called while the in-process stamp is inside the window.
 * There is no stored timestamp column. Do not add one for this.
 */

import { emptyFirmUpgradeSnapshot } from "@/lib/firm-band-upgrade";
import { resolveFirmPriceCurrency } from "@/lib/pricing/market-resolution";
import type { StoredFirmPlan } from "@/lib/billing-check-failure";
import { collapseDuplicateClientShells } from "@/lib/client-display-name";
import {
  decideFirmClientCreate,
  formatFirmPlanStatus,
  idleStarterTrialBanner,
  type FirmClientCreateAllowance,
  type FirmPlanDisplay,
} from "@/lib/firm-client-cap";
import { noPlanTrialClock } from "@/lib/firm-starter-trial";
import type { FirmBillingEntitlement } from "@/lib/stripe-entitlement";

/** Inside 10–15 minutes. One Stripe refresh per firm per process, at most. */
export const FIRM_BILLING_STRIPE_REFRESH_MS = 12 * 60 * 1000;

const refreshedAt = new Map<string, number>();

export type FirmBillingOpenResult = FirmBillingEntitlement & {
  plan?: FirmPlanDisplay;
  allowance?: FirmClientCreateAllowance;
};

export function firmBillingStripeRefreshDue(firmId: string | null | undefined, now = Date.now()): boolean {
  const id = firmId?.trim() ?? "";
  if (!id) return false;
  const at = refreshedAt.get(id);
  if (at == null) return false;
  return now - at >= FIRM_BILLING_STRIPE_REFRESH_MS;
}

export function noteFirmBillingStripeRefresh(firmId: string | null | undefined, now = Date.now()): void {
  const id = firmId?.trim() ?? "";
  if (!id) return;
  refreshedAt.set(id, now);
}

export function resetFirmBillingStripeRefreshForTests(): void {
  refreshedAt.clear();
}

export function setFirmBillingStripeRefreshForTests(firmId: string, at: number): void {
  const id = firmId.trim();
  if (!id) return;
  refreshedAt.set(id, at);
}

/** Firm row fields the open can read without Stripe. */
export type StoredFirmOpenFacts = {
  starterTrialEnforced: boolean;
  createdAt: string | null;
  trialClockStartOverride: string | null;
  clientCount: number;
  /** Stored firms.market. Absent on older callers, which stay not-ZA. */
  market?: unknown;
};

type FactsRead = (firmId: string) => Promise<StoredFirmOpenFacts | null> | StoredFirmOpenFacts | null;

let factsForTests: FactsRead | null = null;

export function setStoredFirmOpenFactsForTests(read: FactsRead | null): void {
  factsForTests = read;
}

type FirmFactsClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string | boolean,
      ) => {
        eq?: (
          column: string,
          value: string | boolean,
        ) => Promise<{
          data: Array<{
            id?: string;
            name?: string | null;
            created_at?: string | null;
            financials?: unknown;
            cashflow?: unknown;
          }> | null;
          error: { message?: string } | null;
        }>;
        maybeSingle?: () => Promise<{
          data: {
            starter_trial_enforced?: boolean | null;
            created_at?: string | null;
            trial_clock_start_override?: string | null;
            market?: unknown;
          } | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

async function countStoredClients(supabase: FirmFactsClient, firmId: string): Promise<number> {
  const selected = supabase.from("clients").select("id, name, created_at, financials, cashflow").eq("firm_id", firmId);
  if (typeof selected.eq !== "function") return 0;
  const { data, error } = await selected.eq("is_demo", false);
  if (error) return 0;
  const rows = (data ?? []).flatMap((row) => {
    const id = row?.id ? String(row.id) : "";
    if (!id) return [];
    return [
      {
        id,
        name: String(row?.name ?? ""),
        created_at: row?.created_at ?? null,
        financials: row?.financials,
        cashflow: row?.cashflow,
      },
    ];
  });
  return collapseDuplicateClientShells(rows).length;
}

/** Trial clock, enforcement, and client count. Null when the row cannot be read. */
export async function readStoredFirmOpenFacts(
  supabase: unknown,
  firmId: string | null | undefined,
): Promise<StoredFirmOpenFacts | null> {
  const id = firmId?.trim() ?? "";
  if (factsForTests) return factsForTests(id);
  if (!id || !supabase) return null;
  try {
    const client = supabase as FirmFactsClient;
    const firms = client
      .from("firms")
      .select("starter_trial_enforced, created_at, trial_clock_start_override, market")
      .eq("id", id);
    if (typeof firms.maybeSingle !== "function") return null;
    const { data, error } = await firms.maybeSingle();
    if (error || !data) return null;
    return {
      starterTrialEnforced: data.starter_trial_enforced === true,
      createdAt: typeof data.created_at === "string" ? data.created_at : null,
      trialClockStartOverride:
        typeof data.trial_clock_start_override === "string" && data.trial_clock_start_override.trim()
          ? data.trial_clock_start_override
          : null,
      clientCount: await countStoredClients(client, id),
      market: data.market ?? null,
    };
  } catch {
    return null;
  }
}

/** Entitlement, plan line, and add-client allowance from the stored plan only. */
export function entitlementFromStoredPlan(
  plan: StoredFirmPlan,
  facts?: StoredFirmOpenFacts | null,
): FirmBillingOpenResult {
  const phase = plan === "entitled" ? "active" : "none";
  const trial =
    facts && plan === "none"
      ? noPlanTrialClock({
          enforced: facts.starterTrialEnforced,
          noPlan: true,
          startedAt: facts.createdAt,
          startOverride: facts.trialClockStartOverride,
        })
      : idleStarterTrialBanner();
  const clientCount = facts?.clientCount ?? 0;
  const decision =
    facts && plan === "none"
      ? decideFirmClientCreate({
          stripeConfigured: true,
          phase: "none",
          band: null,
          clientCount,
          starterTrialExpired: trial.expired,
          noPlanTrialEnforced: facts.starterTrialEnforced,
        })
      : ({ allowed: true } as const);
  const upgrade = {
    ...emptyFirmUpgradeSnapshot(),
    phase,
    band: null as null,
    canUpgrade: false,
    clientCount,
  };
  const allowance: FirmClientCreateAllowance = {
    ...decision,
    canEndTrial: false,
    starterTrial: trial,
    upgrade,
  };
  return {
    entitled: plan === "entitled",
    reason: plan === "entitled" ? "active_subscription" : "no_active_subscription",
    plan: {
      configured: true,
      ...formatFirmPlanStatus({ phase, band: null }),
      clientCount: null,
      clientLimit: null,
      usageLabel: null,
      canUpgrade: false,
      priceCurrency: resolveFirmPriceCurrency(facts?.market),
      interval: "month",
      zarByBand: {},
      starterTrial: trial,
      introTrialEligible: false,
      zaLabels: null,
      zaPriceLabel: null,
    },
    allowance,
  };
}
