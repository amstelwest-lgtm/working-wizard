/**
 * The Implementation Manager month-end step asks the Advisor for an unsent
 * client update. That reply is a PDF, not a chat wall.
 */
import type { AdvisoryPack, AdvisoryPackContent } from "./advisory-pack.ts";

export const MONTH_END_HELD_LINE =
  "The month-end update is ready as a PDF and held for your approval.";

export function isMonthEndUpdateAsk(question: string): boolean {
  const q = (typeof question === "string" ? question : "")
    .toLowerCase()
    .replace(/[’']/g, "'");
  if (!q) return false;
  if (!/(month-end|month end|this month's update)/.test(q)) return false;
  if (!/(draft|unsent)/.test(q)) return false;
  return /(update|client)/.test(q);
}

/** In-memory draft. Nothing is stored, sent, or posted. */
export function unsavedDraftPack(clientId: string, content: AdvisoryPackContent): AdvisoryPack {
  const now = content.generatedAt || new Date().toISOString();
  return {
    id: "00000000-0000-4000-8000-000000000001",
    client_id: clientId,
    cycle_id: null,
    version: 0,
    status: "draft",
    requires_review: true,
    period_label: content.periodLabel,
    figures_as_of: content.figuresAsOf,
    snapshot_id: null,
    generator: "rules",
    ai_draft: content,
    content,
    edit_stats: null,
    generated_by: null,
    generated_at: now,
    reviewed_by: null,
    reviewed_by_kind: null,
    reviewed_at: null,
    review_note: null,
    delivered_at: null,
    delivered_to: null,
    meta: {},
    created_at: now,
    updated_at: now,
  };
}
