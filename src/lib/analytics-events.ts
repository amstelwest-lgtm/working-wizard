/**
 * Validated-learning event spine — client allowlist, dual-run mapping,
 * and bot/scanner heuristics. Commitment signals are NOT listed here;
 * those are emitted by Postgres triggers / service-role emit only.
 */

export const ANALYTICS_MIGRATION =
  "20260902120000_analytics_events_spine.sql then 20260902121000_analytics_events_triggers.sql then 20260902200000_analytics_derived_views.sql then 20260902201000_analytics_commitment_stalls.sql then 20260902300000_analytics_experiments_digest.sql";

export const CLIENT_WRITABLE_EVENT_KEYS = [
  "view.opened",
  "view_mode.toggled",
  "pillar.drilldown.opened",
  "ratio.expanded",
  "playbook.opened",
  "playbook.step.expanded",
  "plan.opened",
  "report.previewed",
  "upload.started",
  "upload.abandoned",
  "ask_ai.query.abandoned",
  "task.link.rendered",
  "task.link.engaged",
  "pricing.viewed",
  "landing.viewed",
  "landing.quiz.completed",
  "friction.dead_click",
] as const;

export type ClientWritableEventKey = (typeof CLIENT_WRITABLE_EVENT_KEYS)[number];

const CLIENT_WRITABLE = new Set<string>(CLIENT_WRITABLE_EVENT_KEYS);

export function isClientWritableEventKey(key: string): boolean {
  return CLIENT_WRITABLE.has(key);
}

/** Dual-run A: old lighthouse_product_usage names → spine keys (intent only). */
export function mapUsageEventToSpine(input: {
  event: string;
  tab?: string | null;
  path?: string | null;
}): Array<{ eventKey: string; extra?: Record<string, unknown> }> {
  const event = input.event;
  const tab = (input.tab ?? "").trim();

  if (event === "page_viewed" || event === "tab_viewed") {
    const out: Array<{ eventKey: string; extra?: Record<string, unknown> }> = [
      { eventKey: "view.opened" },
    ];
    if (tab === "tasks" || tab === "plan") {
      out.push({ eventKey: "plan.opened" });
    }
    return out;
  }
  if (event === "view_mode_toggled") return [{ eventKey: "view_mode.toggled" }];
  if (event === "playbook_opened") return [{ eventKey: "playbook.opened" }];
  if (event === "report_previewed") return [{ eventKey: "report.previewed" }];
  if (event === "friction.dead_click" || event === "friction_dead_click") {
    return [{ eventKey: "friction.dead_click" }];
  }
  if (CLIENT_WRITABLE.has(event)) return [{ eventKey: event }];
  return [];
}

const BOT_UA =
  /googleimageproxy|safelinks|proofpoint|barracuda|mimecast|messagelabs|trendmicro|symantec|postfix|mailscanner|prefetch|headlesschrome|phantomjs|slurp|bingbot|googlebot|applebot|petalbot|yandexbot|ahrefs|semrush|bytespider|facebookexternalhit|linkedinbot|twitterbot|whatsapp|telegrambot|discordbot|preview|crawler|spider|bot\b/i;

export function userAgentLooksLikeBot(ua: string | null | undefined): boolean {
  if (!ua || !ua.trim()) return true;
  return BOT_UA.test(ua);
}

/** Scanner cluster: engagement within this many ms of email dispatch. */
export const ENGAGEMENT_BOT_LATENCY_MS = 8_000;

export const TASK_LINK_GET_MUST_NOT_WRITE = true;
export const ACK_GET_MUST_NOT_WRITE = true;
