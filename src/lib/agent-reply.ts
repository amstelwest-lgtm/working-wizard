/**
 * Shared reply card for the Financial Manager, Analyst, Advisor, and Tax Specialist.
 * The model text is the existing headline / figure lines / Next actions shape.
 * Chips and the how-line come only from tool and figure data already on the reply.
 * Opening "How I got this" reads a stored trail. It does not call the model again.
 */

import { stripUnsafeMarkup } from "./owner-reply-format.ts";
import { figureDeltaLines, FIGURE_SURFACES, type FigureSurface } from "./figure-proposal.ts";

export const AGENT_REPLY_AGENTS = ["financial_manager", "analyst", "advisor", "tax_specialist"] as const;
export type AgentReplyAgent = (typeof AGENT_REPLY_AGENTS)[number];

export type AgentReplyKpi = { label: string; value: string };

export type AgentReplyFigureChip = { label: string; value: string; source: string };

export type AgentReplyDecision = {
  kind: "confirm_reject" | "approve_dismiss";
  id: string;
  prompt: string;
};

export type AgentReplyHow = {
  summary: string;
  /** Set only when a trail is already stored for this reply. The trail is not on the card. */
  detailId: string | null;
};

export type AgentReply = {
  agent: AgentReplyAgent | null;
  headline: string;
  kpis: AgentReplyKpi[];
  bullets: string[];
  decision: AgentReplyDecision | null;
  how: AgentReplyHow | null;
  figures: AgentReplyFigureChip[];
};

export type AgentReplyHowDetail = { lines: string[] };

export type AgentReplyProposal = {
  id: string;
  surface: string;
  note?: string | null;
  patch: Record<string, string | number>;
  beforeValues?: Record<string, string | number | null> | null;
  canDecide?: boolean;
  status?: string | null;
};

export type AgentReplySources = {
  agent?: AgentReplyAgent | null;
  tools?: Array<{ name?: string | null; status?: string | null }> | null;
  proposal?: AgentReplyProposal | null;
  /** Skip proposal chips when another card already shows the patch. */
  proposalChips?: boolean;
  /** Figures the caller already holds. Not parsed out of the reply text. */
  figures?: Array<{ label?: string | null; value?: string | null; source?: string | null }> | null;
  created?: unknown;
  draft?: { id?: string | null; prompt?: string | null } | null;
  run?: { outcomeLabel?: string | null } | null;
  howDetailId?: string | null;
};

const KPI_CAP = 3;
const BULLET_CAP = 4;
const CHIP_CAP = 6;

/**
 * Labels already used by the agent allow-lists and the bot tools.
 * `toolLabel` is checked against those maps in the reply test.
 */
const TOOL_LABELS: Record<string, string> = {
  get_financial_snapshot: "Statements",
  get_ratios: "Ratios",
  get_books_quality: "Books quality",
  get_cash_13_week: "13-week cash",
  get_budget_status: "Budget",
  get_inbox: "Inbox",
  get_team_findings: "Findings",
  get_own_memory: "Memory",
  record_draft: "Draft",
  send_agent_message: "Message",
  propose_figure_adjustment: "Figure proposal",
  prepare_client_report: "Client report",
  get_health: "Health",
  get_variance: "Variance",
  get_statement_history: "History",
  get_data_freshness: "Freshness",
  get_score_history: "Score history",
  record_finding: "Finding",
  list_client_library: "Library",
  get_client_library_doc: "Library file",
  list_tax_drafts: "Tax drafts",
  get_tax_draft: "Tax draft",
  list_tax_packs: "Tax packs",
  get_tax_pack: "Tax pack",
  get_management_report: "Management report",
  list_figure_proposals: "Figure proposals",
  list_client_sends: "Client sends",
  get_invite_status: "Invite status",
  list_blockers: "Blockers",
  propose_next_steps: "Next steps",
  draft_deliverable: "Draft",
  answer_from_brain: "What's on file",
  advisory_pack: "Advisory pack",
  create_action_plan: "Action plan",
};

const OVERVIEW_FIELDS: Array<[string, string]> = [
  ["health", "Health"],
  ["cash", "Cash"],
  ["revenue", "Revenue"],
  ["runwayWeeks", "Runway"],
  ["debtorDays", "Debtor days"],
  ["creditorDays", "Creditor days"],
  ["grossMargin", "Gross margin"],
];

export function parseAgentReplyAgent(raw: unknown): AgentReplyAgent | null {
  return AGENT_REPLY_AGENTS.includes(raw as AgentReplyAgent) ? (raw as AgentReplyAgent) : null;
}

export function toolLabel(name: string): string {
  const known = TOOL_LABELS[name];
  if (known) return known;
  const words = name.replace(/_/g, " ").trim();
  return words || name;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max).trim() : clean;
}

function cleanLine(line: string): string {
  return clip(
    stripUnsafeMarkup(line)
      .replace(/^#{1,6}\s+/, "")
      .replace(/\*\*/g, "")
      .replace(/__/g, ""),
    400,
  );
}

function headlineFrom(line: string): string {
  const sentences = line
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'(*$€£R])/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length <= 1) return clip(line, 280);
  const firstWords = sentences[0].split(/\s+/).filter(Boolean).length;
  return clip((firstWords >= 8 ? sentences.slice(0, 1) : sentences.slice(0, 2)).join(" "), 280);
}

function isNextHeading(line: string): boolean {
  return /^next (?:actions|steps)$/i.test(line.replace(/:$/, "").trim());
}

function statLine(line: string): AgentReplyKpi | null {
  const match = line.match(/^-\s+([^:\n]{1,48}):\s+(\S.*)$/);
  if (!match) return null;
  const label = clip(match[1], 48);
  const value = clip(match[2], 80);
  if (!label || !value) return null;
  return { label, value };
}

function actionLine(line: string): string | null {
  const match = line.match(/^(?:\d{1,2}[.)]|-)\s+(.+)$/);
  return match ? clip(match[1], 240) : null;
}

function cardText(raw: string): { headline: string; kpis: AgentReplyKpi[]; bullets: string[] } {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n").map(cleanLine);
  const headingAt = lines.findIndex((line) => isNextHeading(line));
  const before = headingAt >= 0 ? lines.slice(0, headingAt) : lines;
  const after = headingAt >= 0 ? lines.slice(headingAt + 1) : [];
  const figures: AgentReplyKpi[] = [];
  const prose: string[] = [];
  for (const line of before) {
    if (!line) continue;
    const stat = statLine(line);
    if (stat) figures.push(stat);
    else prose.push(line);
  }
  const headline = headlineFrom(prose[0] || cleanLine(raw));
  const kpis = figures.slice(0, KPI_CAP);
  const actions: string[] = [];
  for (const line of after) {
    if (!line) continue;
    const item = actionLine(line);
    if (item) actions.push(item);
    else if (actions.length) break;
  }
  const bullets = actions.slice(0, BULLET_CAP);
  if (bullets.length < 2) {
    for (const extra of figures.slice(KPI_CAP)) {
      if (bullets.length >= BULLET_CAP) break;
      const line = `${extra.label}: ${extra.value}`;
      if (!bullets.includes(line)) bullets.push(line);
    }
  }
  return { headline, kpis, bullets };
}

function chipValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 40 || text.split(/\s+/).length > 6) return null;
  return text;
}

function chipsFromFacts(facts: unknown): AgentReplyFigureChip[] {
  if (!Array.isArray(facts)) return [];
  const chips: AgentReplyFigureChip[] = [];
  for (const fact of facts) {
    if (typeof fact !== "string") continue;
    const match = fact.trim().match(/^([^:]{1,48}):\s+(\S.{0,80})$/);
    if (!match) continue;
    chips.push({ label: clip(match[1], 48), value: clip(match[2], 80), source: "overview" });
    if (chips.length >= 4) break;
  }
  return chips;
}

function chipsFromCreated(created: unknown): AgentReplyFigureChip[] {
  const overview = asRecord(asRecord(created)?.overview);
  if (!overview) return [];
  const fromFacts = chipsFromFacts(overview.facts);
  if (fromFacts.length) return fromFacts;
  const chips: AgentReplyFigureChip[] = [];
  for (const [key, label] of OVERVIEW_FIELDS) {
    const value = chipValue(overview[key]);
    if (!value) continue;
    chips.push({ label, value, source: "overview" });
  }
  return chips;
}

function chipsFromProposal(proposal: AgentReplyProposal | null | undefined): AgentReplyFigureChip[] {
  if (!proposal) return [];
  if (!(FIGURE_SURFACES as readonly string[]).includes(proposal.surface)) return [];
  const patch = proposal.patch;
  if (!patch || typeof patch !== "object") return [];
  try {
    return figureDeltaLines({
      surface: proposal.surface as FigureSurface,
      patch: patch as never,
      beforeValues: proposal.beforeValues ?? {},
    })
      .slice(0, 4)
      .map((line) => ({ label: clip(line.text, 80), value: "", source: `proposal:${proposal.surface}` }));
  } catch {
    return [];
  }
}

function figureChips(sources: AgentReplySources): AgentReplyFigureChip[] {
  const out: AgentReplyFigureChip[] = [];
  const push = (chip: AgentReplyFigureChip) => {
    if (out.length >= CHIP_CAP || !chip.label) return;
    out.push(chip);
  };
  for (const chip of sources.figures ?? []) {
    const label = typeof chip?.label === "string" ? clip(chip.label, 80) : "";
    const value = typeof chip?.value === "string" ? clip(chip.value, 80) : "";
    const source = typeof chip?.source === "string" ? clip(chip.source, 40) : "";
    if (!label || !source) continue;
    push({ label, value, source });
  }
  if (sources.proposalChips !== false) {
    for (const chip of chipsFromProposal(sources.proposal)) push(chip);
  }
  for (const chip of chipsFromCreated(sources.created)) push(chip);
  return out;
}

function decisionOf(sources: AgentReplySources): AgentReplyDecision | null {
  const proposal = sources.proposal;
  const pending =
    proposal &&
    proposal.id.trim() &&
    proposal.status !== "decided" &&
    proposal.status !== "rejected" &&
    proposal.status !== "applied" &&
    proposal.status !== "approved";
  if (pending && proposal) {
    if (proposal.canDecide === false) return null;
    return {
      kind: "confirm_reject",
      id: proposal.id.trim(),
      prompt: clip(proposal.note?.trim() || "A figure change is waiting for you.", 180),
    };
  }
  const draftId = sources.draft?.id?.trim() ?? "";
  if (!draftId) return null;
  return {
    kind: "approve_dismiss",
    id: draftId,
    prompt: clip(sources.draft?.prompt?.trim() || "This draft is waiting for you.", 180),
  };
}

function howOf(sources: AgentReplySources): AgentReplyHow | null {
  const labels: string[] = [];
  for (const tool of sources.tools ?? []) {
    const name = tool?.name?.trim() ?? "";
    if (!name) continue;
    const label = toolLabel(name);
    if (tool.status === "empty") labels.push(`${label} (nothing on file)`);
    else if (tool.status === "error") labels.push(`${label} (failed)`);
    else labels.push(label);
  }
  const unique = [...new Set(labels)].slice(0, 4);
  let summary = unique.length ? `Checked ${unique.join(", ")}.` : "";
  const outcome = sources.run?.outcomeLabel?.trim() ?? "";
  if (outcome && outcome.length <= 80 && !summary.includes(outcome)) {
    summary = summary ? `${summary} ${outcome}` : outcome;
  }
  summary = clip(summary, 160);
  const detailId = sources.howDetailId?.trim() || null;
  if (!summary && detailId) summary = "Checked the books on file.";
  if (!summary) return null;
  return { summary, detailId };
}

/** Turn one model reply plus the payload already on it into the card. */
export function structureAgentReply(raw: string, sources: AgentReplySources = {}): AgentReply {
  const text = typeof raw === "string" ? raw : "";
  const card = cardText(text);
  return {
    agent: parseAgentReplyAgent(sources.agent),
    headline: card.headline,
    kpis: card.kpis,
    bullets: card.bullets,
    decision: decisionOf(sources),
    how: howOf(sources),
    figures: figureChips(sources),
  };
}

/** Spoken form of the card. The how-trail is not included. */
export function agentReplyPlainText(reply: AgentReply): string {
  return [
    reply.headline,
    ...reply.kpis.map((kpi) => `${kpi.label}: ${kpi.value}`),
    ...reply.bullets,
    reply.decision?.prompt ?? "",
    reply.how?.summary ?? "",
    ...reply.figures.map((chip) => (chip.value ? `${chip.label}: ${chip.value}` : chip.label)),
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

/** Drop the expand id before the card is written to storage. The trail is not stored. */
export function agentReplyForStorage(reply: AgentReply): AgentReply {
  if (!reply.how?.detailId) return reply;
  return { ...reply, how: { summary: reply.how.summary, detailId: null } };
}

function storedKpis(value: unknown): AgentReplyKpi[] {
  if (!Array.isArray(value)) return [];
  const kpis: AgentReplyKpi[] = [];
  for (const row of value) {
    const record = asRecord(row);
    const label = typeof record?.label === "string" ? clip(record.label, 48) : "";
    const figure = typeof record?.value === "string" ? clip(record.value, 80) : "";
    if (!label || !figure) continue;
    kpis.push({ label, value: figure });
    if (kpis.length >= KPI_CAP) break;
  }
  return kpis;
}

function storedBullets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const bullets: string[] = [];
  for (const row of value) {
    if (typeof row !== "string" || !row.trim()) continue;
    bullets.push(clip(row, 240));
    if (bullets.length >= BULLET_CAP) break;
  }
  return bullets;
}

function storedFigures(value: unknown): AgentReplyFigureChip[] {
  if (!Array.isArray(value)) return [];
  const chips: AgentReplyFigureChip[] = [];
  for (const row of value) {
    const record = asRecord(row);
    const label = typeof record?.label === "string" ? clip(record.label, 80) : "";
    const figure = typeof record?.value === "string" ? clip(record.value, 80) : "";
    const source = typeof record?.source === "string" ? clip(record.source, 40) : "";
    if (!label || !source) continue;
    chips.push({ label, value: figure, source });
    if (chips.length >= CHIP_CAP) break;
  }
  return chips;
}

function storedDecision(value: unknown): AgentReplyDecision | null {
  const record = asRecord(value);
  if (!record) return null;
  const kind = record.kind === "confirm_reject" || record.kind === "approve_dismiss" ? record.kind : null;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const prompt = typeof record.prompt === "string" ? clip(record.prompt, 180) : "";
  if (!kind || !id || !prompt) return null;
  return { kind, id, prompt };
}

function storedHow(value: unknown): AgentReplyHow | null {
  const record = asRecord(value);
  const summary = typeof record?.summary === "string" ? clip(record.summary, 160) : "";
  if (!summary) return null;
  const detailId = typeof record?.detailId === "string" && record.detailId.trim() ? record.detailId.trim() : null;
  return { summary, detailId };
}

export function parseStoredAgentReply(raw: unknown): AgentReply | null {
  const record = asRecord(raw);
  const headline = typeof record?.headline === "string" ? clip(record.headline, 280) : "";
  if (!headline) return null;
  return {
    agent: parseAgentReplyAgent(record?.agent),
    headline,
    kpis: storedKpis(record?.kpis),
    bullets: storedBullets(record?.bullets),
    decision: storedDecision(record?.decision),
    how: storedHow(record?.how),
    figures: storedFigures(record?.figures),
  };
}

/**
 * Lines already on a run. Callers keep them beside the card and pass them
 * to the shell only after the person opens How I got this.
 */
export function howDetailLines(run: {
  objective?: unknown;
  outcomeLabel?: unknown;
  status?: unknown;
  escalationReason?: unknown;
  trace?: unknown;
} | null | undefined): string[] {
  if (!run) return [];
  const lines: string[] = [];
  const objective = typeof run.objective === "string" ? run.objective.trim() : "";
  if (objective) lines.push(`Objective — ${objective}`);
  const steps = Array.isArray(run.trace) ? run.trace : [];
  for (const step of steps) {
    const record = asRecord(step);
    if (!record) continue;
    const label =
      typeof record.label === "string" && record.label.trim()
        ? record.label.trim()
        : typeof record.tool === "string" && record.tool.trim()
          ? record.tool.trim()
          : "Step";
    const verified = record.verified === true ? "verified" : record.verified === false ? "not verified" : "";
    const status = typeof record.status === "string" ? record.status.trim() : "";
    const head = [label, verified || status].filter(Boolean).join(" — ");
    const detail = typeof record.detail === "string" ? record.detail.trim() : "";
    lines.push(detail ? `${head}. ${detail}` : head);
  }
  const outcome =
    typeof run.outcomeLabel === "string" && run.outcomeLabel.trim()
      ? run.outcomeLabel.trim()
      : typeof run.status === "string"
        ? run.status.trim()
        : "";
  if (outcome) lines.push(`Outcome — ${outcome}`);
  const extra = typeof run.escalationReason === "string" ? run.escalationReason.trim() : "";
  if (extra) lines.push(extra);
  return lines.slice(0, 12);
}
