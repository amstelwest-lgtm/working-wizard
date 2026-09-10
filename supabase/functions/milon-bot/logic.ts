/**
 * Pure helpers for the in-app Milōn bot.
 * No Deno imports — imported by the edge function and by source tests.
 * Missing brain / financials / invite rows stay empty. Never invent blanks.
 */

export const BOT_RATE_LIMIT = 30;
export const BOT_MAX_TOOL_ROUNDS = 4;
export const BOT_MAX_HISTORY = 8;

export const BOT_TOOLS = [
  "get_invite_status",
  "list_blockers",
  "propose_next_steps",
  "draft_deliverable",
  "answer_from_brain",
] as const;

export type BotToolName = (typeof BOT_TOOLS)[number];
export type BotToolStatus = "ok" | "empty" | "error";

export type InviteRow = {
  purpose: string;
  created_at: string;
  expires_at: string;
  redeemed_at: string | null;
};

export type BlockerRow = {
  question_key: string;
  prompt_text: string | null;
  audience: string;
  last_asked_at: string | null;
};

export type FinancialsSummary = {
  period_label: string | null;
  ratios: Record<string, number>;
  cash_runway_weeks: number | null;
};

export function isBotToolName(value: string): value is BotToolName {
  return (BOT_TOOLS as readonly string[]).includes(value);
}

export function summarizeToolArgs(tool: string, args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return tool;
  const rec = args as Record<string, unknown>;
  const topic = typeof rec.topic === "string" ? rec.topic.trim().slice(0, 80) : "";
  return topic ? `${tool}:${topic}` : tool;
}

export async function hashToolArgs(args: unknown): Promise<string> {
  const canonical = JSON.stringify(args ?? {});
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function toolResultStatus(payload: unknown): BotToolStatus {
  if (payload && typeof payload === "object" && "error" in payload) {
    const err = (payload as { error?: unknown }).error;
    if (typeof err === "string" && err.trim()) return "error";
  }
  if (payload && typeof payload === "object" && (payload as { empty?: boolean }).empty === true) {
    return "empty";
  }
  return "ok";
}

export function compactJson(value: unknown, max = 800): string {
  if (value == null) return "";
  const text = typeof value === "string" ? value.trim() : JSON.stringify(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function numericRatios(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val === "number" && Number.isFinite(val)) out[key] = val;
    if (Object.keys(out).length >= 16) break;
  }
  return out;
}

export function compactBrainSummary(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const body = raw.trim();
    return body ? { body } : null;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["headline", "body", "summary", "bullets", "gap_report", "competitors", "business_map"]) {
    const val = src[key];
    if (val == null) continue;
    if (typeof val === "string" && !val.trim()) continue;
    if (Array.isArray(val) && val.length === 0) continue;
    out[key] = val;
  }
  return Object.keys(out).length ? out : null;
}

export function buildInviteStatus(input: {
  ownerUserId: string | null | undefined;
  invites: InviteRow[];
  now?: Date;
}): {
  empty: boolean;
  owner_linked: boolean;
  invites: Array<{
    purpose: string;
    created_at: string;
    expires_at: string;
    redeemed: boolean;
    expired: boolean;
    status: "redeemed" | "expired" | "pending";
  }>;
} {
  const now = input.now ?? new Date();
  const invites = input.invites.map((row) => {
    const redeemed = Boolean(row.redeemed_at);
    const expired = !redeemed && Boolean(row.expires_at) && new Date(row.expires_at) < now;
    const status = redeemed ? "redeemed" : expired ? "expired" : "pending";
    return {
      purpose: row.purpose,
      created_at: row.created_at,
      expires_at: row.expires_at,
      redeemed,
      expired,
      status: status as "redeemed" | "expired" | "pending",
    };
  });
  return {
    empty: invites.length === 0,
    owner_linked: Boolean(input.ownerUserId),
    invites,
  };
}

export function buildBlockers(rows: BlockerRow[]): {
  empty: boolean;
  blockers: Array<{
    key: string;
    prompt: string;
    audience: string;
    last_asked_at: string | null;
  }>;
} {
  const blockers = rows.map((row) => ({
    key: row.question_key,
    prompt: (row.prompt_text ?? "").trim() || row.question_key,
    audience: row.audience,
    last_asked_at: row.last_asked_at,
  }));
  return { empty: blockers.length === 0, blockers };
}

export function buildBrainAnswer(input: {
  facts: Array<{ fact_text: string; category: string | null }>;
  brainSummary: unknown;
  financials: FinancialsSummary | null;
}): {
  empty: boolean;
  missing: string[];
  facts: Array<{ text: string; category: string | null }>;
  brain_summary: Record<string, unknown> | null;
  financials: FinancialsSummary | null;
} {
  const facts = input.facts
    .map((f) => ({ text: f.fact_text.trim(), category: f.category }))
    .filter((f) => f.text);
  const brain = compactBrainSummary(input.brainSummary);
  const ratios = input.financials?.ratios ?? {};
  const hasFinancials = Boolean(
    input.financials &&
      (input.financials.period_label ||
        input.financials.cash_runway_weeks != null ||
        Object.keys(ratios).length > 0),
  );
  const missing: string[] = [];
  if (facts.length === 0) missing.push("context_facts");
  if (!brain) missing.push("brain_summary");
  if (!hasFinancials) missing.push("financials");
  return {
    empty: missing.length === 3,
    missing,
    facts,
    brain_summary: brain,
    financials: hasFinancials ? input.financials : null,
  };
}

export const BOT_SYSTEM = `You are Milōn Bot — the in-app copilot for this client's numbers and Client Brain.
You help the accountant or owner act on what is already on file for THIS client only.
You are not Lighthouse (founder outreach). Do not pretend to send email or run founder outreach.

Tools:
- get_invite_status: owner-handoff / staff invite status. Never invent a token or a link.
- list_blockers: outstanding client_brain_questions only.
- propose_next_steps: calls the existing brain-propose function (drafts only).
- draft_deliverable: calls the existing brain-deliverable-draft function (draft only, never sent).
- answer_from_brain: reads context_facts + brain_summary + financial snapshot summaries.

Rules:
- Use tools before answering about blockers, invites, next steps, drafts, or what's on file.
- If a tool returns empty / missing, say so plainly. Never invent figures, names, GAP items, competitors, or invite links.
- Do not fill blanks. Do not mint invites. Do not send email. Do not mark anything signed off, ready, or sent.
- Keep answers short (3–8 sentences). Ground every claim in tool results.
- If the question is about board numbers (health, ratios, cash outlook, margins) and these tools cannot ground it, say what's missing. Do not send the user to a separate product.`;
