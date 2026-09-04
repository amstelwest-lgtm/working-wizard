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
}

export interface ProfileRow {
  client_id: string;
  entity_type: string | null;
  business_type: string | null;
  annual_revenue: number | null;
  operating: OperatingProfileSummary | null;
}

export interface ScoreRow {
  overall_score: number | null;
}

export interface PlaybookRow {
  action: string;
  completed_at: string | null;
}

export interface AskAiContext {
  profile: ProfileRow | null;
  scores: ScoreRow | null;
  ratios: RatioRow[];
  playbook: PlaybookRow[];
  copyPack: "za" | "us";
}

export interface AskAiRequest {
  clientId: string;
  question: string;
}
