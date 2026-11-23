/**
 * One-page integration plan. Each row is a catalogue play. Opus 5.5 ranks
 * play ids from the interview. It does not invent a solution sentence.
 * The server drops any id that is not on the catalogue.
 */
import { CLAUDE_OPUS_55, claudeRequestFields } from "./claude-request.ts";
import { buildCapabilityManifest } from "./im-capability-manifest.ts";
import {
  DEFAULT_LEAD_PLAY_IDS,
  IM_PLAN_APPROVE,
  playMarketCopy,
  solutionPlays,
  type SolutionPlay,
} from "./im-solution-plays.ts";
import { cleanFlowLine } from "./setup-partner-plan.ts";
import type { SetupPartnerCountry } from "./setup-partner.ts";

/** UK is accepted here so HMRC is confined to UK rows. Firm markets in the product stay US and ZA. */
export type IntegrationPlanCountry = SetupPartnerCountry | "UK";

export type IntegrationPlanStatus = "Waiting" | "Draft queued" | "Running";

export type IntegrationPlanSection = "lead" | "already_covered";

export type IntegrationPlanRow = {
  playId: string;
  problem: string;
  milon: string;
  routine: string;
  clientSees: string;
  approve: string;
  bot: string;
  section: IntegrationPlanSection;
  status: IntegrationPlanStatus;
};

const PLAN_BOTS = new Set(["Financial Manager", "Analyst", "Advisor", "Tax Specialist"]);

const JARGON =
  /\b(client_setup|product_gap|fit_note|step_type|dedupe_key|classifier|Practice:)\b|\[\|[a-z_]+\]/i;

const BUCKET_LABELS = /\b(Product gap|Client setup|Already covered|Bespoke)\b/;

const STATUSES = new Set<IntegrationPlanStatus>(["Waiting", "Draft queued", "Running"]);

const FIT_NOTE =
  /(?:Firm setting for the practice|Fits the universal finance function|Outside the universal finance function|Already in Milōn:).*/i;

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
  text = text.replace(
    /\b(client_setup|product_gap|fit_note|step_type|dedupe_key|classifier)\b/gi,
    "",
  );
  text = text.replace(/\b(Product gap|Client setup|Already covered|Bespoke)\b/g, "");
  text = text.replace(/[{}`]/g, "");
  text = text.replace(/\bWhatsApp\b/gi, "a message");
  text = text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
  return text.slice(0, 280);
}

function splitDash(text: string): [string, string] {
  const parts = text.split(/\s+[—–-]\s+/);
  const head = (parts[0] ?? "").trim();
  const rest = parts.slice(1).join(" — ").trim();
  return [head, rest];
}

function cadencePhrase(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (key === "monthly") return "every month";
  if (key === "weekly") return "every week";
  if (key === "quarterly") return "each quarter";
  if (key === "annual" || key === "yearly") return "once a year";
  if (key === "daily") return "each day";
  if (key === "ad hoc" || key === "adhoc") return "when it comes up";
  return null;
}

function isStoredFieldList(detail: string): boolean {
  if (!detail.includes(";")) return false;
  const parts = detail
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length >= 2 && parts.every((part) => part.length < 64);
}

/** Turn "Firm; Monthly" into a sentence an accountant would say. */
export function accountantToday(workflow: string, detail: string): string {
  const rest = detail.trim();
  if (!rest || rest === workflow) return workflow;
  if (!isStoredFieldList(rest)) return rest;
  const parts = rest
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  let cadence = "as part of the close";
  let channel: string | null = null;
  const who: string[] = [];
  for (const part of parts) {
    const cadenceLabel = cadencePhrase(part);
    if (cadenceLabel) {
      cadence = cadenceLabel;
      continue;
    }
    if (/\b(email|pdf|xero|quickbooks|sage|spreadsheet)\b/i.test(part)) {
      channel = part;
      continue;
    }
    who.push(part);
  }
  const whoText = who.join(" and ");
  const work = workflow.toLowerCase();
  if (/\binvoices?\b/.test(work) && /\bbank statements?\b/.test(work)) {
    return cadence === "every month"
      ? "Clients email PDF invoices and bank statements each month."
      : `Clients email PDF invoices and bank statements ${cadence}.`;
  }
  if (channel && /email|pdf/i.test(channel)) {
    return `Clients email the documents ${cadence}.`;
  }
  if (who.length === 1 && /^firm$/i.test(who[0] ?? "") && !channel) {
    return cadence === "every month" ? "Done in-house every month." : `Done in-house ${cadence}.`;
  }
  if (/\bmanager\b/i.test(whoText) && /\bpartner\b/i.test(whoText)) {
    return `The manager reviews the work and the partner signs off ${cadence}.`;
  }
  if (channel && /xero/i.test(channel)) {
    const people = whoText ? `${whoText} ` : "The team ";
    return `${people}do this in Xero ${cadence}.`;
  }
  if (whoText) return `${whoText} do this ${cadence}.`;
  return `The practice does this ${cadence}.`;
}

function scrubMarket(text: string, country?: IntegrationPlanCountry | null): string {
  let next = text;
  if (country === "US") {
    next = next
      .replace(/\bZA tax prep\b/gi, "Sales-tax prep")
      .replace(/\bHMRC\b/gi, "IRS")
      .replace(/\bSARS\b/g, "IRS")
      .replace(/\bZA\b/g, "US");
  } else if (country === "ZA") {
    next = next.replace(/\bHMRC\b/gi, "SARS").replace(/\bIRS\b/g, "SARS");
  } else if (country === "UK") {
    next = next.replace(/\bSARS\b/g, "HMRC").replace(/\bIRS\b/g, "HMRC");
  }
  return next
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
}

function marketLeak(blob: string, country?: IntegrationPlanCountry | null): boolean {
  if (country === "US") return /\bSARS\b|\bHMRC\b|\bZA\b/i.test(blob);
  if (country === "ZA") return /\bHMRC\b|\bIRS\b/i.test(blob);
  if (country === "UK") return /\bSARS\b|\bIRS\b/i.test(blob);
  return false;
}

function manifestCountry(country?: IntegrationPlanCountry | null): SetupPartnerCountry | null {
  if (country === "US" || country === "ZA") return country;
  return null;
}

export function playsForPlan(country?: IntegrationPlanCountry | null): SolutionPlay[] {
  return solutionPlays(buildCapabilityManifest(manifestCountry(country)));
}

function finishRow(
  row: IntegrationPlanRow,
  country?: IntegrationPlanCountry | null,
): IntegrationPlanRow | null {
  const next: IntegrationPlanRow = {
    playId: row.playId.trim(),
    problem: scrubMarket(plainWorkflowText(row.problem), country),
    milon: scrubMarket(plainWorkflowText(row.milon), country),
    routine: scrubMarket(plainWorkflowText(row.routine), country),
    clientSees: scrubMarket(plainWorkflowText(row.clientSees), country),
    approve: scrubMarket(plainWorkflowText(row.approve), country),
    bot: scrubMarket(plainWorkflowText(row.bot), country),
    section: row.section === "already_covered" ? "already_covered" : "lead",
    status: STATUSES.has(row.status) ? row.status : "Waiting",
  };
  if (!next.playId || !next.problem || !next.milon || !next.bot || !next.routine || !next.clientSees) {
    return null;
  }
  if (!PLAN_BOTS.has(next.bot)) return null;
  const blob = `${next.problem} ${next.milon} ${next.routine} ${next.clientSees} ${next.approve} ${next.bot}`;
  if (JARGON.test(blob) || BUCKET_LABELS.test(blob)) return null;
  if (marketLeak(blob, country)) return null;
  return next;
}

function userAnswerLines(interview: string | undefined): string[] {
  const text = interview?.trim() ?? "";
  if (!text) return [];
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const answers = lines
    .filter((line) => /^A:/i.test(line))
    .map((line) => line.replace(/^A:\s*/i, "").trim())
    .filter(Boolean);
  return answers.length ? answers : [text];
}

function shownKind(bucket?: string): "pain" | "covered" | null {
  if (bucket === "covered") return "covered";
  if (!bucket || bucket === "client_setup") return "pain";
  return null;
}

function evidenceSentence(text: string): string {
  const plain = plainWorkflowText(text.replace(/^(?:Q|A):\s*/i, ""));
  if (!plain) return "";
  const [head, rest] = splitDash(plain);
  const workflow = head || plain;
  const today = accountantToday(workflow, rest);
  if (!today || today === workflow || today.includes(";")) return workflow;
  return `${workflow}. ${today}`;
}

function specificProblem(question: string, detail: string): string {
  const line = detail.trim();
  if (!line) return question;
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (norm(line).includes(norm(question.replace(/\?$/, "")))) return question;
  const clipped = line.length > 180 ? `${line.slice(0, 179).trim()}…` : line;
  const sentence = /[.!?]$/.test(clipped) ? clipped : `${clipped}.`;
  return `${question} You said: ${sentence}`;
}

type ScoredPlay = {
  play: SolutionPlay;
  pain: number;
  covered: number;
  evidence: string | null;
  evidencePain: boolean;
};

function noteEvidence(hit: ScoredPlay, text: string, kind: "pain" | "covered") {
  if (kind === "pain") {
    if (!hit.evidencePain) {
      hit.evidence = text;
      hit.evidencePain = true;
    }
    return;
  }
  if (!hit.evidence) hit.evidence = text;
}

function scorePlays(
  plays: readonly SolutionPlay[],
  input: {
    steps?: readonly { step: string; bucket?: string }[];
    coverage?: readonly { agent: string; owns: string }[];
    interview?: string;
  },
): ScoredPlay[] {
  const scored: ScoredPlay[] = plays.map((play) => ({
    play,
    pain: 0,
    covered: 0,
    evidence: null,
    evidencePain: false,
  }));
  for (const step of input.steps ?? []) {
    const kind = shownKind(step.bucket);
    if (!kind || !plainWorkflowText(step.step)) continue;
    for (const hit of scored) {
      if (!hit.play.signals.test(step.step)) continue;
      if (kind === "pain") hit.pain += 3;
      else hit.covered += 2;
      noteEvidence(hit, step.step, kind);
    }
  }
  for (const answer of userAnswerLines(input.interview)) {
    for (const hit of scored) {
      if (!hit.play.signals.test(answer)) continue;
      hit.pain += 5;
      noteEvidence(hit, answer, "pain");
    }
  }
  for (const row of input.coverage ?? []) {
    const blob = `${row.agent} ${row.owns}`.trim();
    if (!blob) continue;
    for (const hit of scored) {
      if (!hit.play.signals.test(blob)) continue;
      hit.covered += 2;
      noteEvidence(hit, blob, "covered");
    }
  }
  return scored;
}

function hasPlanSource(input: {
  steps?: readonly { step: string; bucket?: string }[];
  coverage?: readonly { agent: string; owns: string }[];
  interview?: string;
}): boolean {
  if ((input.coverage?.length ?? 0) > 0) return true;
  if (userAnswerLines(input.interview).length > 0) return true;
  return (input.steps ?? []).some((step) => shownKind(step.bucket) !== null && Boolean(plainWorkflowText(step.step)));
}

export function materializePlayRow(input: {
  play: SolutionPlay;
  section: IntegrationPlanSection;
  evidence?: string | null;
  country?: IntegrationPlanCountry | null;
  status: IntegrationPlanStatus;
}): IntegrationPlanRow | null {
  const copy = playMarketCopy(input.play, input.country);
  const detail = input.evidence ? evidenceSentence(input.evidence) : "";
  return finishRow(
    {
      playId: input.play.id,
      problem: specificProblem(input.play.question, detail),
      milon: copy.output,
      routine: input.play.routine,
      clientSees: copy.clientSees,
      approve: IM_PLAN_APPROVE,
      bot: input.play.bot,
      section: input.section,
      status: input.status,
    },
    input.country,
  );
}

export function buildIntegrationPlanTable(input: {
  steps?: readonly { step: string; bucket?: string }[];
  coverage?: readonly { agent: string; owns: string }[];
  interview?: string;
  country?: IntegrationPlanCountry | null;
  started?: boolean;
  running?: boolean;
}): IntegrationPlanRow[] {
  if (!hasPlanSource(input)) return [];
  const plays = playsForPlan(input.country);
  const status: IntegrationPlanStatus = input.running
    ? "Running"
    : input.started
      ? "Draft queued"
      : "Waiting";
  const scored = scorePlays(plays, input);
  const byId = new Map(scored.map((row) => [row.play.id, row]));
  const pain = scored
    .filter((row) => row.pain > 0)
    .sort((a, b) => b.pain - a.pain || a.play.order - b.play.order);
  const coveredOnly = new Set(
    scored.filter((row) => row.pain === 0 && row.covered > 0).map((row) => row.play.id),
  );
  const lead: string[] = [];
  for (const row of pain) {
    if (lead.length >= 5) break;
    lead.push(row.play.id);
  }
  for (const id of DEFAULT_LEAD_PLAY_IDS) {
    if (lead.length >= 3) break;
    if (lead.includes(id) || coveredOnly.has(id) || !byId.has(id)) continue;
    lead.push(id);
  }
  if (lead.length < 3) {
    for (const id of DEFAULT_LEAD_PLAY_IDS) {
      if (lead.length >= 3) break;
      if (lead.includes(id) || !byId.has(id)) continue;
      lead.push(id);
    }
  }
  const leadSet = new Set(lead);
  const already = scored
    .filter((row) => row.covered > 0 && !leadSet.has(row.play.id))
    .sort((a, b) => a.play.order - b.play.order)
    .map((row) => row.play.id);
  const rows: IntegrationPlanRow[] = [];
  for (const id of lead) {
    const hit = byId.get(id);
    if (!hit) continue;
    const row = materializePlayRow({
      play: hit.play,
      section: "lead",
      evidence: hit.evidence,
      country: input.country,
      status,
    });
    if (row) rows.push(row);
  }
  for (const id of already) {
    const hit = byId.get(id);
    if (!hit) continue;
    const row = materializePlayRow({
      play: hit.play,
      section: "already_covered",
      evidence: hit.evidence,
      country: input.country,
      status,
    });
    if (row) rows.push(row);
  }
  return rows;
}

function catalogueForPrompt(plays: readonly SolutionPlay[], country?: IntegrationPlanCountry | null) {
  return plays.map((play) => {
    const copy = playMarketCopy(play, country);
    return {
      id: play.id,
      question: play.question,
      output: copy.output,
      routine: play.routine,
      clientSees: copy.clientSees,
      bot: play.bot,
    };
  });
}

export function integrationPlanPrompt(input: {
  plays: readonly SolutionPlay[];
  interview: string;
  steps?: readonly string[];
  country?: IntegrationPlanCountry | null;
}): string {
  const steps = (input.steps ?? []).map((step) => plainWorkflowText(step)).filter(Boolean).slice(0, 12);
  const interview = input.interview.trim().slice(0, 6000);
  const prompt = [
    "Choose plays for this accountant's integration plan.",
    'Return JSON only: {"ranked":["play-id"],"alreadyCovered":["play-id"]}',
    "ranked is 3 to 5 ids. Put the strongest pain in the interview first.",
    "alreadyCovered is other catalogue ids for work the interview shows is already handled.",
    "Use play ids from the catalogue only. Any other id is rejected.",
    "Do not invent a play. Do not rewrite the catalogue sentences.",
    "Milōn drafts only. Nothing is posted to Xero, QuickBooks, or Sage. Nothing is filed with the tax authority.",
    "The tax-deadline play is a reminder and a document list. Auto-send is not on.",
    "Catalogue:",
    JSON.stringify(catalogueForPrompt(input.plays, input.country)),
    "Interview answers:",
    interview || "(none)",
    steps.length ? `What the firm described:\n${steps.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return scrubMarket(prompt, input.country);
}

/** Request body for in-app Opus. No thinking budget and no temperature. */
export function integrationPlanOpusBody(input: {
  plays: readonly SolutionPlay[];
  interview: string;
  steps?: readonly string[];
  country?: IntegrationPlanCountry | null;
}): {
  model: typeof CLAUDE_OPUS_55;
  max_tokens: number;
  messages: { role: "user"; content: string }[];
} {
  const model = CLAUDE_OPUS_55;
  return {
    model,
    max_tokens: 700,
    messages: [{ role: "user", content: integrationPlanPrompt(input) }],
    ...claudeRequestFields({ model }),
  };
}

function idsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === "string") ids.push(item.trim());
    else if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
      ids.push((item as { id: string }).id.trim());
    }
  }
  return ids.filter(Boolean);
}

export function readOpusPlayIds(raw: string): {
  ranked: string[];
  alreadyCovered: string[];
  mentionedCovered: boolean;
} {
  const jsonText = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    const match = jsonText.match(/[\[{][\s\S]*[\]}]/);
    if (!match) return { ranked: [], alreadyCovered: [], mentionedCovered: false };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return { ranked: [], alreadyCovered: [], mentionedCovered: false };
    }
  }
  if (Array.isArray(parsed)) {
    return { ranked: idsFrom(parsed), alreadyCovered: [], mentionedCovered: false };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ranked: [], alreadyCovered: [], mentionedCovered: false };
  }
  const record = parsed as Record<string, unknown>;
  return {
    ranked: idsFrom(record.ranked ?? record.plays ?? record.ids),
    alreadyCovered: idsFrom(record.alreadyCovered ?? record.already_covered),
    mentionedCovered: "alreadyCovered" in record || "already_covered" in record,
  };
}

function unique(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function interviewEvidence(play: SolutionPlay, interview: string | undefined): string | null {
  for (const answer of userAnswerLines(interview)) {
    if (play.signals.test(answer)) return answer;
  }
  return null;
}

export function applyOpusIntegrationPlan(
  raw: string,
  fallback: readonly IntegrationPlanRow[],
  input: {
    country?: IntegrationPlanCountry | null;
    interview?: string;
    plays: readonly SolutionPlay[];
  },
): { rows: IntegrationPlanRow[]; rejected: string[] } {
  const allowed = new Set(input.plays.map((play) => play.id));
  const parsed = readOpusPlayIds(raw);
  const rejected = unique([...parsed.ranked, ...parsed.alreadyCovered].filter((id) => !allowed.has(id)));
  const ranked = unique(parsed.ranked.filter((id) => allowed.has(id))).slice(0, 5);
  if (ranked.length === 0) return { rows: [...fallback], rejected };
  const lead = [...ranked];
  for (const row of fallback) {
    if (lead.length >= 3) break;
    if (row.section !== "lead" || lead.includes(row.playId)) continue;
    lead.push(row.playId);
  }
  const leadSet = new Set(lead);
  const coveredFromOpus = unique(parsed.alreadyCovered.filter((id) => allowed.has(id) && !leadSet.has(id)));
  const covered = parsed.mentionedCovered
    ? coveredFromOpus
    : unique([
        ...coveredFromOpus,
        ...fallback.filter((row) => row.section === "already_covered").map((row) => row.playId),
      ]).filter((id) => !leadSet.has(id));
  const status = fallback[0]?.status ?? "Waiting";
  const byPlay = new Map(input.plays.map((play) => [play.id, play]));
  const rows: IntegrationPlanRow[] = [];
  const push = (id: string, section: IntegrationPlanSection) => {
    const existing = fallback.find((row) => row.playId === id);
    if (existing) {
      const next = finishRow({ ...existing, section, status: existing.status }, input.country);
      if (next) rows.push(next);
      return;
    }
    const play = byPlay.get(id);
    if (!play) return;
    const next = materializePlayRow({
      play,
      section,
      evidence: interviewEvidence(play, input.interview),
      country: input.country,
      status,
    });
    if (next) rows.push(next);
  };
  for (const id of lead) push(id, "lead");
  for (const id of covered) push(id, "already_covered");
  if (!rows.some((row) => row.section === "lead")) return { rows: [...fallback], rejected };
  return { rows, rejected };
}
