import type { OverviewBrief } from "./overview-brief.ts";

export type DisclosureTier = "none" | "summary" | "focused" | "full";

export interface RatioRow {
  key: string;
  value: number | null;
  format: string;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  higher_is_better: boolean | null;
}

export interface OperatingProfileSummary {
  industry: string;
  volumeUnit: string;
  debtorDaysDefault: number;
  costShape: string;
  seasonality: string;
  inventoryIntensity: string;
  customerConcentration: string;
  debtPosition: string;
  ownerGoal: string;
  payMotion?: string;
  secondaryVolumeUnits?: string[];
  fyStartMonth?: number;
}

export interface ProfileRow {
  client_id: string;
  entity_type: string | null;
  business_type: string | null;
  annual_revenue: number | null;
  operating: OperatingProfileSummary | null;
}

export interface ProfileQuestionRow {
  label: string;
  value: string;
}

export interface ScorePillarRow {
  id: string;
  label: string;
  score: number | null;
}

export interface ScoreRow {
  overall_score: number | null;
  /** Category scores that feed the overall number (liquidity, profit, etc.). */
  pillars?: ScorePillarRow[];
}

export interface PlaybookRow {
  action: string;
  completed_at: string | null;
}

export interface WaterfallStep {
  label: string;
  pctOfRevenue: number | null;
}

export interface WaterfallSummary {
  source: "weekly" | "period";
  hasData: boolean;
  steps: WaterfallStep[];
}

export interface CashForecastSummary {
  hasData: boolean;
  runwayWeeks: number | null;
  /** Set when the shared runway is cash-generative, so copy must not say 0 weeks. */
  cashGenerative?: boolean;
  horizonWeeks: number;
  shortfall: boolean;
  lowestWeek: number | null;
  negativeWeeks: number;
  /** Why a shortfall is a timing dip rather than a structural burn. */
  timingNote?: string | null;
  trajectory: "up" | "down" | "flat" | null;
  closingVsOpening: "higher" | "lower" | "flat" | null;
}

export interface ProductLineSummary {
  name: string;
  marginPct: number | null;
  revenueSharePct: number | null;
  gpSharePct: number | null;
  isBest: boolean;
  isWorst: boolean;
}

export interface NextStepSummary {
  rank: number;
  title: string;
  ratioName: string;
}

export interface ActionTaskSummary {
  title: string;
  status: string;
  dueDate: string | null;
  progressPct: number;
}

export interface ActionPlanSummary {
  outcomeGoal: string | null;
  open: ActionTaskSummary[];
  doneCount: number;
}

export interface DeliverableFill {
  scope: string;
  label: string;
  filled: boolean;
  signedOff: boolean;
}

export interface AskAiContext {
  clientName?: string | null;
  profile: ProfileRow | null;
  profileQuestions: ProfileQuestionRow[];
  scores: ScoreRow | null;
  ratios: RatioRow[];
  playbook: PlaybookRow[];
  copyPack: "za" | "us";
  waterfall: WaterfallSummary | null;
  cashForecast: CashForecastSummary | null;
  productLines: ProductLineSummary[];
  nextSteps: NextStepSummary[];
  actionPlan: ActionPlanSummary | null;
  deliverables: DeliverableFill[];
  /** Live Overview health, cash, revenue, runway, and days. Not score history. */
  overview?: OverviewBrief | null;
}

export interface AskAiRequest {
  clientId: string;
  question: string;
}
