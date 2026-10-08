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
import {
  DISPLAY_TO_CAMEL,
  resolveRatioRecord,
} from "./derive-ratios.ts";
import { buildOverviewBrief, copyPackFromMarket, overviewFyStartMonth } from "./overview-brief.ts";
import { assessClientMetrics, runwayDisplayLabel } from "../../../src/lib/client-metrics.ts";
import { benchmarkBusinessType } from "../../../src/lib/benchmark-sector.ts";
import { peerMedian } from "../../../src/lib/ratios.ts";

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
  let financialsUpdatedAt: string | null = null;
  let clientName: string | null = null;
  let brainSummary: unknown = null;
  let operatingProfile: unknown = null;
  if (tier !== "none") {
    let { data, error } = await supabase
      .from("clients")
      .select(
        "id, name, business_type, financials, operating_profile, market, cashflow, cash_runway_weeks, financials_updated_at, brain_summary",
      )
      .eq("id", clientId)
      .maybeSingle();
    if (error && /column ["']?(market|cash_runway_weeks)["']?/i.test(error.message ?? "")) {
      const retry = await supabase
        .from("clients")
        .select("id, name, business_type, financials, operating_profile, cashflow")
        .eq("id", clientId)
        .maybeSingle();
      // Older databases lack market / cash_runway_weeks. Callers read those
      // fields as optional, so the narrower row is the same value at runtime.
      data = retry.data as typeof data;
      error = retry.error;
    }
    if (error) {
      /* profile stays null; copy pack remains ZA */
    }

    if (data) {
      copyPack = copyPackFromMarket((data as { market?: unknown }).market);
      clientName = typeof (data as { name?: unknown }).name === "string" ? (data as { name: string }).name : null;
      brainSummary = (data as { brain_summary?: unknown }).brain_summary ?? null;
      const fin = (data.financials ?? {}) as Record<string, unknown>;
      financials = fin && typeof fin === "object" && !Array.isArray(fin) ? fin : null;
      cashflow = (data as { cashflow?: SavedCashflow | null }).cashflow ?? null;
      const rawStored = (data as { cash_runway_weeks?: number | null }).cash_runway_weeks;
      storedRunway = rawStored != null && Number.isFinite(Number(rawStored)) ? Number(rawStored) : null;
      const rawUpdated = (data as { financials_updated_at?: string | null }).financials_updated_at;
      financialsUpdatedAt = typeof rawUpdated === "string" ? rawUpdated : null;
      const rawRevenue = fin["annual_revenue"] ?? fin["revenue"];
      const op = (data.operating_profile ?? null) as Record<string, unknown> | null;
      operatingProfile = op;
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
      .select("name, market")
      .eq("id", clientId)
      .maybeSingle();
    copyPack = copyPackFromMarket(data?.market);
    clientName = typeof data?.name === "string" ? data.name : null;
  }

  // ── Scores ────────────────────────────────────────────────────────────────
  // Live Overview health (financials + runway). client_score_history can lag
  // the figures the accountant is looking at, so it is not the score source.
  let scores: ScoreRow | null = null;

  // ── Ratios ────────────────────────────────────────────────────────────────
  // Live `overviewRatios` on `periodMonthsOf`, the same cover as Overview.
  // A snapshot is only used when live financials yield nothing. Display-name
  // keys ("Gross Margin", "Creditor Days") map to camelCase benchmark keys.
  let ratios: RatioRow[] = [];
  let rankingRatios: RatioRow[] = [];
  let snapPeriod: string | null = null;
  let snapDate: string | null = null;
  let fallbackRatios: Record<string, number> | null = null;
  if (tier !== "none") {
    const { data: snap } = await supabase
      .from("client_financial_snapshots")
      .select("ratios, period_label, period_date")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    snapPeriod = (snap?.period_label as string | null) ?? null;
    snapDate = (snap?.period_date as string | null) ?? null;

    const snapRatios =
      snap?.ratios && typeof snap.ratios === "object" && !Array.isArray(snap.ratios)
        ? (snap.ratios as Record<string, unknown>)
        : null;
    const rawRatios = resolveRatioRecord(snapRatios, financials, {
      fyStartMonth: overviewFyStartMonth(copyPack, operatingProfile),
    });
    fallbackRatios = rawRatios;

    if (Object.keys(rawRatios).length > 0) {
      // Focused questions still see one pillar in the ratio list; next-step
      // ranking always uses the full filled set.
      let filterKeys: Set<string> | null = null;
      if (tier === "focused") {
        const matched = pillarsFor(question);
        filterKeys = new Set(matched.flatMap((p) => PILLAR_RATIO_KEYS[p] ?? []));
      }

      const rawBizType = profile?.business_type ?? "";
      // Unknown types still use the generic set. A stored "Retail" resolves to retail.
      const businessType = benchmarkBusinessType(rawBizType) ?? "other";

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
          const sharedMedian = peerMedian(camelKey);
          const row: RatioRow = {
            key: camelKey,
            value,
            format: inferFormat(camelKey),
            p25: b?.p25 ?? null,
            p50: sharedMedian ?? b?.p50 ?? null,
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
  const metrics =
    tier === "none"
      ? null
      : assessClientMetrics({
          financials,
          cashflow,
          financialsUpdatedAt,
          fyStartMonth: overviewFyStartMonth(copyPack, operatingProfile),
        });
  const cashForecast =
    tier === "none"
      ? null
      : summarizeCashForecast(cashflow, metrics?.runway.weeks ?? storedRunway, {
          cashGenerative: metrics?.runway.kind === "cash_generative",
          openingCash: metrics?.cash.amount ?? null,
          financials,
          runway: metrics?.runway ?? null,
          periodEnd: typeof financials?.periodEnd === "string" ? financials.periodEnd : null,
        });

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
  const overview =
    tier === "none"
      ? null
      : buildOverviewBrief({
          financials,
          ratios: fallbackRatios,
          cash: metrics?.cash.amount ?? null,
          runwayWeeks: metrics?.runway.weeks ?? null,
          runwayLabel: metrics ? runwayDisplayLabel(metrics.runway) : null,
          copyPack,
          fyStartMonth: overviewFyStartMonth(copyPack, operatingProfile),
          shortfallWeek: metrics?.outlook.shortfallWeek,
          clientName,
          periodLabel: snapPeriod,
          figuresAsOf: snapDate,
          brainSummary,
        });
  if (overview && (overview.health != null || overview.pillars.some((p) => p.score != null))) {
    scores = {
      overall_score: overview.health,
      pillars: overview.pillars.map((p) => ({ id: p.id, label: p.label, score: p.score })),
    };
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
    clientName,
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
    overview,
  };
}
