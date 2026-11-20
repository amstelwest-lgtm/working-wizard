/**
 * One-page integration plan table. Opus 5.5 rewrites the rows in accountant
 * English. Classifications stay in the caller; this module only prints the table.
 */
import { CLAUDE_OPUS_55, claudeRequestFields } from "./claude-request.ts";
import { cleanFlowLine } from "./setup-partner-plan.ts";
import type { SetupPartnerCountry } from "./setup-partner.ts";

export type IntegrationPlanStatus = "Waiting" | "Draft queued" | "Running";

export type IntegrationPlanRow = {
  workflow: string;
  today: string;
  milon: string;
  bot: string;
  grant: string;
  status: IntegrationPlanStatus;
};

const SHOWN_BUCKETS = new Set(["client_setup", "covered"]);

const JARGON =
  /\b(client_setup|product_gap|fit_note|step_type|dedupe_key|classifier|Practice:)\b|\[\|[a-z_]+\]/i;

const BUCKET_LABELS = /\b(Product gap|Client setup|Already covered|Bespoke)\b/;

const STATUSES = new Set<IntegrationPlanStatus>(["Waiting", "Draft queued", "Running"]);

const FIT_NOTE = /(?:Firm setting for the practice|Fits the universal finance function|Outside the universal finance function|Already in Milōn:).*/i;

/** Drop stored prefixes, fit notes, and classifier words before a row is shown. */
export function plainWorkflowText(step: string): string {
  let text = cleanFlowLine(step);
  text = text.replace(/^Practice:\s*/i, "");
  text = text.replace(/\s*\[\|[a-z_]+\]\s*/gi, " ");
  const kept: string[] = [];
  for (const part of text.split(/\s+[—–-]\s+/)) {
    const piece = part.trim();
    if (!piece || FIT_NOTE.test(piece)) continue;
    kept.push(piece);
  }
  text = kept.join(" — ");
  text = text.replace(/\b(client_setup|product_gap|fit_note|step_type|dedupe_key|classifier)\b/gi, "");
  text = text.replace(/\b(Product gap|Client setup|Already covered|Bespoke)\b/g, "");
  text = text.replace(/[{}`]/g, "");
  text = text.replace(/\bWhatsApp\b/gi, "a message");
  text = text.replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").trim();
  return text.slice(0, 280);
}

function splitDash(text: string): [string, string] {
  const parts = text.split(/\s+[—–-]\s+/);
  const head = (parts[0] ?? "").trim();
  const rest = parts.slice(1).join(" — ").trim();
  return [head, rest];
}

function botForWorkflow(text: string): string {
  if (/\btax\b/i.test(text)) return "Tax Specialist";
  if (/\b(report|ratio|variance|management pack|month-?end pack)\b/i.test(text)) return "Analyst";
  if (/\b(deadline|narrative|advice|owner question)\b/i.test(text)) return "Advisor";
  if (/\b(sign|review|approve)\b/i.test(text)) return "Accountant";
  return "Financial Manager";
}

function grantForWorkflow(text: string): string {
  if (/\b(ledger|books|xero|quickbooks|sage|qbo)\b/i.test(text)) {
    return "You approve before anything is posted to the books.";
  }
  return "You approve the draft before anything is sent.";
}

function scrubMarket(text: string, country?: SetupPartnerCountry | null): string {
  if (country !== "US") return text;
  return text
    .replace(/\bZA tax prep\b/gi, "Sales-tax prep")
    .replace(/\bSARS\b/g, "")
    .replace(/\bZA\b/g, "US")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
}

function finishRow(row: IntegrationPlanRow, country?: SetupPartnerCountry | null): IntegrationPlanRow | null {
  const next: IntegrationPlanRow = {
    workflow: scrubMarket(plainWorkflowText(row.workflow), country),
    today: scrubMarket(plainWorkflowText(row.today), country),
    milon: scrubMarket(plainWorkflowText(row.milon), country),
    bot: scrubMarket(plainWorkflowText(row.bot), country),
    grant: scrubMarket(plainWorkflowText(row.grant), country),
    status: STATUSES.has(row.status) ? row.status : "Waiting",
  };
  if (!next.workflow || !next.milon || !next.bot) return null;
  const blob = `${next.workflow} ${next.today} ${next.milon} ${next.bot} ${next.grant}`;
  if (JARGON.test(blob) || BUCKET_LABELS.test(blob)) return null;
  if (country === "US" && /\bSARS\b|\bZA\b/.test(blob)) return null;
  return next;
}

export function buildIntegrationPlanTable(input: {
  steps: readonly { step: string; bucket?: string }[];
  coverage?: readonly { agent: string; owns: string }[];
  country?: SetupPartnerCountry | null;
  started?: boolean;
  running?: boolean;
}): IntegrationPlanRow[] {
  const status: IntegrationPlanStatus = input.running ? "Running" : input.started ? "Draft queued" : "Waiting";
  const rows: IntegrationPlanRow[] = [];
  for (const step of input.steps) {
    if (step.bucket && !SHOWN_BUCKETS.has(step.bucket)) continue;
    const plain = plainWorkflowText(step.step);
    if (!plain) continue;
    const [head, rest] = splitDash(plain);
    const workflow = head || plain;
    const row = finishRow(
      {
        workflow,
        today: rest || plain,
        milon: "Milōn prepares a draft for your review. Nothing is sent.",
        bot: botForWorkflow(plain),
        grant: grantForWorkflow(plain),
        status,
      },
      input.country,
    );
    if (row) rows.push(row);
  }
  for (const coverage of input.coverage ?? []) {
    const owns = plainWorkflowText(coverage.owns);
    const agent = plainWorkflowText(coverage.agent);
    if (!owns || !agent) continue;
    const [head] = splitDash(owns);
    const row = finishRow(
      {
        workflow: head || owns,
        today: "The practice handles this before Milōn drafts it.",
        milon: owns,
        bot: agent,
        grant: "You approve the draft before anything is sent.",
        status,
      },
      input.country,
    );
    if (row && !rows.some((existing) => existing.workflow === row.workflow && existing.milon === row.milon)) {
      rows.push(row);
    }
  }
  return rows;
}

export function integrationPlanPrompt(rows: readonly IntegrationPlanRow[]): string {
  return [
    "Rewrite this integration plan for an accountant.",
    "Return a JSON array only, one object per input row, same order, no extra rows.",
    "Keys: workflow, today, milon, bot, grant, status.",
    "Keep each status value exactly as given.",
    "Plain English. Short sentences.",
    "Do not use stored prefixes, fit notes, or internal classification names.",
    "Milōn prepares drafts only. Nothing is sent, filed, or posted to a ledger.",
    JSON.stringify(rows),
  ].join("\n");
}

/** Request body for in-app Opus. No thinking budget and no temperature. */
export function integrationPlanOpusBody(rows: readonly IntegrationPlanRow[]): {
  model: typeof CLAUDE_OPUS_55;
  max_tokens: number;
  messages: { role: "user"; content: string }[];
} {
  const model = CLAUDE_OPUS_55;
  return {
    model,
    max_tokens: 1800,
    messages: [{ role: "user", content: integrationPlanPrompt(rows) }],
    ...claudeRequestFields({ model }),
  };
}

export function applyOpusIntegrationPlan(
  raw: string,
  fallback: readonly IntegrationPlanRow[],
  country?: SetupPartnerCountry | null,
): IntegrationPlanRow[] {
  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const match = jsonText.match(/\[[\s\S]*\]/);
    if (!match) return [...fallback];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [...fallback];
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return [...fallback];
  const rows: IntegrationPlanRow[] = [];
  for (let index = 0; index < fallback.length; index += 1) {
    const base = fallback[index]!;
    const item = parsed[index];
    if (!item || typeof item !== "object") {
      rows.push(base);
      continue;
    }
    const record = item as Record<string, unknown>;
    const status = STATUSES.has(record.status as IntegrationPlanStatus)
      ? (record.status as IntegrationPlanStatus)
      : base.status;
    const next = finishRow(
      {
        workflow: typeof record.workflow === "string" ? record.workflow : base.workflow,
        today: typeof record.today === "string" ? record.today : base.today,
        milon: typeof record.milon === "string" ? record.milon : base.milon,
        bot: typeof record.bot === "string" ? record.bot : base.bot,
        grant: typeof record.grant === "string" ? record.grant : base.grant,
        status,
      },
      country,
    );
    rows.push(next ?? base);
  }
  return rows;
}
