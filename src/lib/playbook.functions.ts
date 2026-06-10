import { createServerFn } from "@tanstack/react-start";

export interface PlaybookStep {
  id?: number;
  ratio_key: string;
  ratio_name: string;
  health_tier: string;
  health_score_min: number;
  health_score_max: number;
  step_number: number;
  step_title: string;
  step_description: string;
  timeframe: string;
  effort: string;
  impact: string;
  category: string;
}

export const getPlaybookSteps = createServerFn({ method: "GET" })
  .inputValidator((input: { ratioKey: string; tier: string }) => input)
  .handler(async ({ data }) => {
    const raw = await import("@/lib/playbook-data.json");
    const all = (raw.default ?? raw) as PlaybookStep[];
    return all
      .filter((r) => r.ratio_key === data.ratioKey && r.health_tier === data.tier)
      .sort((a, b) => a.step_number - b.step_number);
  });
