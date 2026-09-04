import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type {
  AskAiContext,
  ProfileQuestionRow,
  ProfileRow,
  RatioRow,
  ScoreRow,
} from "./types.ts";
import type { DisclosureTier } from "./types.ts";
import { pillarsFor } from "./classifier.ts";
import {
  buildDeliverableFills,
  extractWaterfallFigures,
  profileQuestionsFromOperating,
  rankNextSteps,
  summarizeActionPlan,
  summarizeCashForecast,
  summarizeProductLines,
  summarizeWaterfall,
  type SavedCashflow,
} from "./deliverable-summaries.ts";

/**
 * Maps the application's stored business_type values to the benchmark category keys
 * used in industry_benchmarks.business_type.
 * Mirrors BUSINESS_TYPE_TO_BENCHMARK in src/lib/ratios.ts (kept in sync manually).
 */
const BUSINESS_TYPE_TO_BENCHMARK: Record<string, string> = {
  service: "services",
  agency: "services",
  product: "other",
  saas: "saas",
  marketplace: "other",
  asset_heavy: "other",
  distribution: "other",
  retail: "retail",
  manufacturing: "manufacturing",
  project: "professional",
  franchise: "retail",
  subscription: "saas",
  logistics: "other",
  hospitality: "hospitality",
  healthcare: "professional",
  construction: "construction",
  hybrid: "other",
};

/**
 * Maps the display-name keys stored by computeRatios() in client_financial_snapshots.ratios
 * to the camelCase keys used in industry_benchmarks.metric_key.
 *
 * computeRatios() returns keys like "Gross Margin"; benchmarks use "grossMargin".
 * This mapping is the single source of truth for that translation inside the edge function.
 */
const DISPLAY_TO_CAMEL: Record<string, string> = {
  "Net Margin": "netMargin",
  "Operating Margin": "operatingMargin",
  "Gross Margin": "grossMargin",
  "Return on Equity": "roe",
  "Return on Assets": "roa",
  "Asset Turnover": "assetTurnover",
  "Equity Multiplier": "equityMultiplier",
  "Interest Burden": "interestBurden",
  "Tax Burden": "taxBurden",
  "Debtor Days": "debtorDays",
  "Inventory Days": "inventoryDays",
  "Creditor Days": "creditorDays",
  "Working Capital Days": "workingCapitalDays",
  "Fixed Cost Ratio": "fixedCostRatio",
  "Degree of Operating Leverage": "dol",
  "Top-5 Customer Share": "customerConcentration",
  "Gross Profit / Labor": "gpToLabor",
  "Sales-per-Employee Ratio": "salesPerEmployee",
  "OCF / EBITDA": "ocfToEbitda",
};

/** Infer display format from the canonical camelCase key. */
function inferFormat(camelKey: string): string {
  if (camelKey.endsWith("Days")) return "days";
  if (
    camelKey.endsWith("Margin") ||
    camelKey.endsWith("Ratio") ||
    camelKey.endsWith("Burden") ||
    camelKey.endsWith("Rate") ||
    camelKey.endsWith("Structure") ||
    camelKey.endsWith("Utilization") ||
    camelKey.endsWith("Intensity") ||
    camelKey === "roa" ||
    camelKey === "roe" ||
    camelKey === "ocfToEbitda" ||
    camelKey === "gpToLabor" ||
    camelKey === "customerConcentration" ||
    camelKey === "fundingStructure" ||
    camelKey === "revenueGrowth" ||
    camelKey === "capexIntensity" ||
    camelKey === "assetReinvestmentRatio"
  )
    return "pct";
  return "x"; // multiplier / dimensionless ratio
}

/**
 * camelCase ratio keys belonging to each analytical pillar.
 * Used to filter ratios sent to the model for focused questions.
 */
/**
 * Ratio keys that expose exact currency amounts (revenue/employee, GP/labor).
 * These are excluded from model context regardless of tier — they reveal derived
 * monetary figures that violate the privacy contract (no raw amounts to the model).
 */
const MONETARY_DERIVED_KEYS = new Set(["salesPerEmployee", "gpToLabor"]);

function copyPackFromMarket(raw: unknown): "za" | "us" {
  if (raw && typeof raw === "object" && "country" in raw) {
    const country = (raw as { country?: unknown }).country;
    if (country === "US") return "us";
  }
  return "za";
}

const PILLAR_RATIO_KEYS: Record<string, string[]> = {
  cash: ["debtorDays", "creditorDays", "inventoryDays", "workingCapitalDays", "ocfToEbitda"],
  profit: ["grossMargin", "operatingMargin", "netMargin", "fixedCostRatio", "dol"],
  leverage: ["equityMultiplier", "interestBurden", "taxBurden"],
  efficiency: [
    "assetTurnover",
    "roa",
    "roe",
    // salesPerEmployee and gpToLabor excluded — they expose currency amounts
  ],
  risk: ["customerConcentration", "fixedCostRatio", "dol"],
};

export async function buildContext(
  supabase: SupabaseClient,
  clientId: string,
  tier: DisclosureTier,
  question: string,
): Promise<AskAiContext> {
  // ── Profile + filled deliverable blobs (never dump raw statements) ────────
  let copyPack: "za" | "us" = "za";
  let profile: ProfileRow | null = null;
  let profileQuestions: ProfileQuestionRow[] = [];
  let financials: Record<string, unknown> | null = null;
  let cashflow: SavedCashflow | null = null;
  let storedRunway: number | null = null;
  if (tier !== "none") {
    let { data, error } = await supabase
      .from("clients")
      .select(
        "id, business_type, financials, operating_profile, market, cashflow, cash_runway_weeks",
      )
      .eq("id", clientId)
      .maybeSingle();
    if (error && /column ["']?(market|cash_runway_weeks)["']?/i.test(error.message ?? "")) {
      const retry = await supabase
        .from("clients")
        .select("id, business_type, financials, operating_profile, cashflow")
        .eq("id", clientId)
        .maybeSingle();
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      /* profile stays null; copy pack remains ZA */
    }

    if (data) {
      copyPack = copyPackFromMarket((data as { market?: unknown }).market);
      const fin = (data.financials ?? {}) as Record<string, unknown>;
      financials = fin && typeof fin === "object" && !Array.isArray(fin) ? fin : null;
      cashflow = (data as { cashflow?: SavedCashflow | null }).cashflow ?? null;
      const rawStored = (data as { cash_runway_weeks?: number | null }).cash_runway_weeks;
      storedRunway = rawStored != null && Number.isFinite(Number(rawStored)) ? Number(rawStored) : null;
      const rawRevenue = fin["annual_revenue"] ?? fin["revenue"];
      const op = (data.operating_profile ?? null) as Record<string, unknown> | null;
      profileQuestions = profileQuestionsFromOperating(op);
      profile = {
        client_id: data.id,
        entity_type: null,
        business_type: data.business_type ?? null,
        annual_revenue: rawRevenue !== undefined ? Number(rawRevenue) : null,
        operating:
          op && typeof op === "object" && op.version === 1
            ? {
                industry: String(op.templateId ?? ""),
                volumeUnit: String(op.volumeUnit ?? ""),
                debtorDaysDefault: Number(op.debtorDaysDefault ?? 0),
                costShape: String(op.costShape ?? ""),
                seasonality: String(op.seasonality ?? ""),
                inventoryIntensity: String(op.inventoryIntensity ?? ""),
                customerConcentration: String(op.customerConcentration ?? ""),
                debtPosition: String(op.debtPosition ?? ""),
                ownerGoal: String(op.ownerGoal ?? ""),
                payMotion: String(op.payMotion ?? ""),
                secondaryVolumeUnits: Array.isArray(op.secondaryVolumeUnits)
                  ? op.secondaryVolumeUnits.map((u) => String(u))
                  : [],
                fyStartMonth: Number(op.fyStartMonth ?? 0) || undefined,
              }
            : null,
      };
    }
  } else {
    const { data } = await supabase
      .from("clients")
      .select("market")
      .eq("id", clientId)
      .maybeSingle();
    copyPack = copyPackFromMarket(data?.market);
  }

  // ── Scores ────────────────────────────────────────────────────────────────
  let scores: ScoreRow | null = null;
  if (tier !== "none") {
    const { data } = await supabase
      .from("client_score_history")
      .select("score")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) scores = { overall_score: data.score };
  }

  // ── Ratios ────────────────────────────────────────────────────────────────
  // client_financial_snapshots.ratios stores a flat Record<string, number>
  // with *display-name* keys as returned by computeRatios()
  // (e.g. "Gross Margin", "Debtor Days", "Sales-per-Employee Ratio").
  // industry_benchmarks.metric_key uses camelCase (e.g. "grossMargin").
  // We translate via DISPLAY_TO_CAMEL before the benchmark join.
  let ratios: RatioRow[] = [];
  let rankingRatios: RatioRow[] = [];
  if (tier !== "none") {
    const { data: snap } = await supabase
      .from("client_financial_snapshots")
      .select("ratios")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snap?.ratios && typeof snap.ratios === "object" && !Array.isArray(snap.ratios)) {
      const rawRatios = snap.ratios as Record<string, unknown>;

      // Focused questions still see one pillar in the ratio list; next-step
      // ranking always uses the full filled set.
      let filterKeys: Set<string> | null = null;
      if (tier === "focused") {
        const matched = pillarsFor(question);
        filterKeys = new Set(matched.flatMap((p) => PILLAR_RATIO_KEYS[p] ?? []));
      }

      const rawBizType = profile?.business_type ?? "";
      const businessType = BUSINESS_TYPE_TO_BENCHMARK[rawBizType] ?? "other";

      type Entry = { displayKey: string; camelKey: string; value: number };
      const entries: Entry[] = [];

      for (const [displayKey, rawVal] of Object.entries(rawRatios)) {
        const camelKey = DISPLAY_TO_CAMEL[displayKey];
        if (!camelKey) continue;
        if (MONETARY_DERIVED_KEYS.has(camelKey)) continue;
        if (!isFinite(Number(rawVal))) continue;
        entries.push({ displayKey, camelKey, value: Number(rawVal) });
      }

      if (entries.length > 0) {
        const camelKeys = entries.map((e) => e.camelKey);
        const { data: benchmarks } = await supabase
          .from("industry_benchmarks")
          .select("metric_key, p25, p50, p75, higher_is_better")
          .eq("business_type", businessType)
          .in("metric_key", camelKeys);

        const benchMap = new Map<
          string,
          { p25: number; p50: number; p75: number; higher_is_better: boolean }
        >((benchmarks ?? []).map((b) => [b.metric_key, b]));

        for (const { camelKey, value } of entries) {
          const b = benchMap.get(camelKey);
          const row: RatioRow = {
            key: camelKey,
            value,
            format: inferFormat(camelKey),
            p25: b?.p25 ?? null,
            p50: b?.p50 ?? null,
            p75: b?.p75 ?? null,
            higher_is_better: b?.higher_is_better ?? null,
          };
          rankingRatios.push(row);
          if (!filterKeys || filterKeys.has(camelKey)) ratios.push(row);
        }
      }
    }
  }

  // ── Waterfall / product mix / cash (outputs only — no statement dump) ─────
  const waterfall =
    tier === "none" || !financials
      ? null
      : summarizeWaterfall(extractWaterfallFigures(financials));
  const productLines =
    tier === "none" || !financials ? [] : summarizeProductLines(financials.productMix);
  const cashForecast =
    tier === "none" ? null : summarizeCashForecast(cashflow, storedRunway);

  // Rank next moves from the full ratio set (not the focused subset).
  const nextSteps = tier === "none" ? [] : rankNextSteps(rankingRatios, 5);

  // ── Action plan (planned + outstanding) ───────────────────────────────────
  let actionPlan = null;
  if (tier !== "none") {
    const [planRes, itemRes] = await Promise.all([
      supabase
        .from("action_plans")
        .select("id, outcome_goal")
        .eq("client_id", clientId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("action_items")
        .select("title, status, due_date, progress_pct, seq")
        .eq("client_id", clientId)
        .order("seq", { ascending: true })
        .limit(40),
    ]);
    actionPlan = summarizeActionPlan(planRes.data ?? null, itemRes.data ?? []);
  }

  // ── Filled / signed-off deliverables ──────────────────────────────────────
  const signedScopes = new Set<string>();
  if (tier !== "none") {
    const { data: signoffs } = await supabase
      .from("client_review_signoffs")
      .select("scope")
      .eq("client_id", clientId);
    for (const row of signoffs ?? []) {
      if (row?.scope) signedScopes.add(String(row.scope));
    }
  }
  const deliverables =
    tier === "none"
      ? []
      : buildDeliverableFills({
          hasRatios: ratios.length > 0,
          hasScore: scores?.overall_score != null,
          hasWaterfall: waterfall?.hasData === true,
          hasCash: cashForecast?.hasData === true,
          hasProductLines: productLines.length > 0,
          hasNextSteps: nextSteps.length > 0,
          hasActionPlan: actionPlan != null && (actionPlan.open.length > 0 || actionPlan.doneCount > 0),
          signedScopes,
        });

  return {
    profile,
    profileQuestions,
    scores,
    ratios,
    playbook: [],
    copyPack,
    waterfall,
    cashForecast,
    productLines,
    nextSteps,
    actionPlan,
    deliverables,
  };
}
