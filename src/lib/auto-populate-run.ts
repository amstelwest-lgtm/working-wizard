/**
 * Browser-side runner for auto-populate (Supabase client, called from the portals): read the client row, build the
 * deliverable writes, persist, remember the checkbox choice.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  buildAutoPopulateWrites,
  isFirstUpload,
  nextStoredPrefs,
  parseAutoPopulatePrefs,
  resolveAutoPopulatePlan,
  type AutoPopulateContext,
  type AutoPopulatePrefs,
  type AutoPopulateWrites,
} from "@/lib/auto-populate";
import type { ExistingCashflow } from "@/lib/cash-from-banks.publish";
import type { CashFromBanksDraftResult } from "@/lib/cash-from-banks.types";
import { parseOperatingProfile } from "@/lib/client-profile";
import { coerceMarketSelection, resolveMarket } from "@/lib/market";
import { runwayWeeksFromCashflow } from "@/lib/cash-runway";

export type AutoPopulateState = {
  firstUpload: boolean;
  prefs: AutoPopulatePrefs;
};

/** Optional columns that may be missing from PostgREST's schema cache. */
export const OPTIONAL_CLIENT_COLUMN_ERROR =
  /auto_update_prefs|cashflow_bank_draft|42703|schema cache/;

export function isOptionalClientColumnError(message: string | null | undefined): boolean {
  return OPTIONAL_CLIENT_COLUMN_ERROR.test(message ?? "");
}

/** What the upload dialogs need before the user clicks Apply. */
export async function loadAutoPopulateState(clientId: string): Promise<AutoPopulateState> {
  const { data, error } = await supabase
    .from("clients")
    .select("financials_updated_at, last_forecast_at, budget_updated_at, auto_update_prefs")
    .eq("id", clientId)
    .maybeSingle();
  if (error && isOptionalClientColumnError(error.message)) {
    const retry = await supabase
      .from("clients")
      .select("financials_updated_at, last_forecast_at, budget_updated_at")
      .eq("id", clientId)
      .maybeSingle();
    return {
      firstUpload: isFirstUpload(retry.data as never),
      prefs: parseAutoPopulatePrefs(null),
    };
  }
  const row = data as {
    financials_updated_at?: string | null;
    last_forecast_at?: string | null;
    budget_updated_at?: string | null;
    auto_update_prefs?: unknown;
  } | null;
  return {
    firstUpload: isFirstUpload(row),
    prefs: parseAutoPopulatePrefs(row?.auto_update_prefs),
  };
}

export type RunAutoPopulateInput = {
  clientId: string;
  /** Period figures already applied to clients.financials. */
  fields: Record<string, string | number | null | undefined>;
  cashDraft?: CashFromBanksDraftResult | null;
  /** Checkbox state from the dialog (ignored on first upload — everything runs). */
  chosen: AutoPopulatePrefs;
  /** Undefined (dialog state not loaded yet) → decided from the row's freshness stamps. */
  firstUpload?: boolean;
  firstActualsMonth?: string | null;
  /** Workspace market when the client row has none (owner board). */
  fallbackMarket?: unknown;
  surface: "owner_app" | "accountant_portal";
  source: "bank_pack" | "financial_statement";
};

export type RunAutoPopulateResult = AutoPopulateWrites & {
  firstUpload: boolean;
  /** Cash forecast payload that was published, if any (for local state). */
  cashflow: ExistingCashflow | null;
  runwayWeeks: number | null;
};

export async function runAutoPopulate(input: RunAutoPopulateInput): Promise<RunAutoPopulateResult> {
  const { data, error } = await supabase
    .from("clients")
    .select(
      "budget, cashflow, operating_profile, financial_year_start_month, market, auto_update_prefs, financials_updated_at, last_forecast_at, budget_updated_at",
    )
    .eq("id", input.clientId)
    .maybeSingle();
  let row = data as {
    budget?: unknown;
    cashflow?: ExistingCashflow | null;
    operating_profile?: unknown;
    financial_year_start_month?: number | null;
    market?: unknown;
    auto_update_prefs?: unknown;
    financials_updated_at?: string | null;
    last_forecast_at?: string | null;
    budget_updated_at?: string | null;
  } | null;
  let prefsColumn = true;
  if (error) {
    if (!isOptionalClientColumnError(error.message)) throw new Error(error.message);
    prefsColumn = false;
    const retry = await supabase
      .from("clients")
      .select(
        "budget, cashflow, operating_profile, financial_year_start_month, market, financials_updated_at, last_forecast_at, budget_updated_at",
      )
      .eq("id", input.clientId)
      .maybeSingle();
    if (retry.error) throw new Error(retry.error.message);
    row = retry.data as typeof row;
  }

  const firstUpload = input.firstUpload ?? isFirstUpload(row);
  const plan = resolveAutoPopulatePlan({ firstUpload, prefs: input.chosen });
  const marketRaw = row?.market ?? input.fallbackMarket ?? null;
  const ctx: AutoPopulateContext = {
    fields: input.fields,
    cashDraft: input.cashDraft ?? null,
    existingBudget: row?.budget ?? null,
    existingCashflow: row?.cashflow ?? null,
    operatingProfile: parseOperatingProfile(row?.operating_profile),
    fyStartMonth: row?.financial_year_start_month ?? null,
    firstActualsMonth: input.firstActualsMonth ?? null,
    market: resolveMarket(coerceMarketSelection(marketRaw)),
  };
  const writes = buildAutoPopulateWrites(plan, ctx);

  const cashflow = (writes.update.cashflow as ExistingCashflow | undefined) ?? null;
  const runwayWeeks = cashflow ? runwayWeeksFromCashflow(cashflow as never) : null;
  const update: Record<string, unknown> = { ...writes.update };
  if (runwayWeeks != null) update.cash_runway_weeks = runwayWeeks;
  if (prefsColumn) {
    update.auto_update_prefs = nextStoredPrefs(
      parseAutoPopulatePrefs(row?.auto_update_prefs),
      input.chosen,
    );
  }

  if (Object.keys(update).length > 0) {
    const { error: upErr } = await supabase
      .from("clients")
      .update(update as never)
      .eq("id", input.clientId);
    if (upErr) {
      if (!isOptionalClientColumnError(upErr.message)) throw new Error(upErr.message);
      // Optional column not in schema cache — write the deliverables anyway.
      delete update.auto_update_prefs;
      delete update.cashflow_bank_draft;
      const retry = await supabase
        .from("clients")
        .update(update as never)
        .eq("id", input.clientId);
      if (retry.error) throw new Error(retry.error.message);
    }
  }

  return { ...writes, firstUpload, cashflow, runwayWeeks };
}
