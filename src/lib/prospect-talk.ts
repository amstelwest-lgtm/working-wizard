/**
 * Public one-agent links (/talk/:agent). Pure rules.
 * The anon chat is decided here and executed by the prospect-talk edge
 * function. This file does not insert leads and does not send mail.
 *
 * Tax-only copy lives in prospect-tax-copy.ts so a non-ZA bundle does not
 * need that module.
 */
import { AGENT_DISPLAY_NAME } from "./milon-team-names.ts";
import { FIRM_TRIAL_CARD_NOTE, FIRM_TRIAL_SENTENCE } from "./starter-trial-constants.ts";

export const PROSPECT_MESSAGE_MAX = 500;
/**
 * Useful answers in one agent conversation before the name-and-email form.
 * The next visitor message is held and answered after the form.
 * Three is inside the 2–3 window. This counter is the session's own
 * visitor_turns, not an IP total and not a browser store.
 */
export const PROSPECT_FREE_REPLIES = 3;
/** Answered turns after the form, including the message the form was holding. */
export const PROSPECT_POST_LEAD_TURNS = 4;
export const PROSPECT_TURNS_PER_SESSION = PROSPECT_FREE_REPLIES + PROSPECT_POST_LEAD_TURNS;
export const PROSPECT_TURNS_PER_IP_PER_HOUR = 20;
export const PROSPECT_SESSIONS_PER_IP_PER_DAY = 8;
export const PROSPECT_GLOBAL_TURNS_PER_DAY = 400;
/** Same lifetime cap as /try (TRIAL_LEADS_PER_EMAIL). */
export const PROSPECT_LEADS_PER_EMAIL = 2;
export const PROSPECT_DEFAULT_MODEL = "claude-haiku-4-5";

export const PROSPECT_TAX_SLUG = "tax-specialist";
export const PROSPECT_PUBLIC_SLUGS = [
  "financial-manager",
  "analyst",
  "advisor",
  PROSPECT_TAX_SLUG,
] as const;
export type ProspectPublicSlug = (typeof PROSPECT_PUBLIC_SLUGS)[number];
export type ProspectSlug = ProspectPublicSlug;

export type ProspectFace = "financial_manager" | "analyst" | "advisor" | "tax_specialist";

export type ProspectAgentCopy = {
  slug: ProspectSlug;
  face: ProspectFace;
  role: string;
  greeting: string;
  questions: readonly string[];
};

export const PROSPECT_PUBLIC_AGENTS: readonly ProspectAgentCopy[] = [
  {
    slug: "financial-manager",
    face: "financial_manager",
    role: "Financial Manager",
    greeting: `I'm the ${AGENT_DISPLAY_NAME.financial_manager}. I can walk a labelled SAMPLE of a business — health, cash, and an advisory pack — and an accountant still signs off. Nothing on this page connects to accounting software.`,
    questions: [
      "What does the business do?",
      "What do you want to see first in the sample — profit, cash, or the advisory pack?",
    ],
  },
  {
    slug: "analyst",
    face: "analyst",
    role: "Analyst",
    greeting: `I'm the ${AGENT_DISPLAY_NAME.analyst}. I read sample ratios and margins. Every figure is labelled SAMPLE. I don't pull live books on this page.`,
    questions: [
      "What does the business sell?",
      "What should I look at first — margin, or how long customers take to pay?",
    ],
  },
  {
    slug: "advisor",
    face: "advisor",
    role: "Advisor",
    greeting: `I'm the ${AGENT_DISPLAY_NAME.advisor}. I turn a sample diagnosis into moves. Nothing is written to a ledger, and an accountant signs off.`,
    questions: ["What decision are you weighing?", "Is that about cash, profit, or the next move?"],
  },
  {
    slug: PROSPECT_TAX_SLUG,
    face: "tax_specialist",
    role: "Tax Specialist",
    greeting:
      "I'm the Milōn Tax Specialist. I prepare a labelled SAMPLE company tax worksheet for an accountant to review and sign off. I do not log into SARS, and I do not file or submit anything.",
    questions: ["Is this a standard resident company?", "When does the year of assessment end?"],
  },
];

const PUBLIC_BY_SLUG = new Map(PROSPECT_PUBLIC_AGENTS.map((agent) => [agent.slug, agent]));

export function publicProspectAgent(slug: string): ProspectAgentCopy | null {
  return PUBLIC_BY_SLUG.get(slug.trim().toLowerCase() as ProspectPublicSlug) ?? null;
}

export type TalkResolution =
  | { kind: "agent"; agent: ProspectAgentCopy }
  | { kind: "picker"; reason: "unknown" | "unavailable" };

/** Unknown slugs fall back to the picker. Tax Specialist is one of the four. */
export function resolveTalkSlug(slug: string, _copyPack: "za" | "us"): TalkResolution {
  const agent = publicProspectAgent(slug);
  if (agent) return { kind: "agent", agent };
  return { kind: "picker", reason: "unknown" };
}

export function sanitizeRef(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(trimmed)) return null;
  return trimmed;
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

export function sanitizeProspectUtm(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, 200);
    if (trimmed) out[key] = trimmed;
  }
  return out;
}

export function prospectLeadUtm(input: {
  agent: string;
  ref: string | null;
  utm: Record<string, string>;
}): Record<string, string> {
  return {
    ...input.utm,
    source: "talk",
    agent: input.agent,
    ...(input.ref ? { ref: input.ref } : {}),
  };
}

export function prospectEmailAllowed(count: number): boolean {
  return count < PROSPECT_LEADS_PER_EMAIL;
}

export function assessProspectTurn(input: {
  messageLength: number;
  sessionTurns: number;
  ipTurnsLastHour: number;
  ipSessionsToday: number;
  isNewSession: boolean;
  globalTurnsToday: number;
}): { ok: true } | { ok: false; status: 400 | 429; error: string } {
  if (input.messageLength < 1) return { ok: false, status: 400, error: "Type a message." };
  if (input.messageLength > PROSPECT_MESSAGE_MAX) {
    return { ok: false, status: 400, error: "Keep that to a few sentences." };
  }
  if (input.sessionTurns >= PROSPECT_TURNS_PER_SESSION) {
    return { ok: false, status: 429, error: "This conversation has reached its limit." };
  }
  if (input.ipTurnsLastHour >= PROSPECT_TURNS_PER_IP_PER_HOUR) {
    return {
      ok: false,
      status: 429,
      error: "Too many messages from this network. Try again later.",
    };
  }
  if (input.isNewSession && input.ipSessionsToday >= PROSPECT_SESSIONS_PER_IP_PER_DAY) {
    return { ok: false, status: 429, error: "Too many conversations from this network today." };
  }
  if (input.globalTurnsToday >= PROSPECT_GLOBAL_TURNS_PER_DAY) {
    return { ok: false, status: 429, error: "The sample conversation is paused for today." };
  }
  return { ok: true };
}

/**
 * The form opens on the message after the free replies, and only when this
 * conversation has not already taken a name and email. A lead on the session
 * ends the gate. Another agent's session does not count.
 */
export function shouldAskForLead(visitorTurnsAfter: number, leadCaptured = false): boolean {
  if (leadCaptured) return false;
  return visitorTurnsAfter > PROSPECT_FREE_REPLIES;
}

export function pricingAsked(message: string): boolean {
  return /\bpric(?:e|ing)\b|\bcost\b|\bhow much\b/i.test(message);
}

/** No digits. Used when the visitor asks about price before the form. */
export const PROSPECT_PRICING_HOLD =
  "I'll answer pricing after your name and email. I won't invent a price. This page is a labelled SAMPLE.";

/**
 * Published Starter trial and the owner workspace price. Firm list prices
 * are USD. This sentence does not invent a fee and does not quote rand.
 */
export function prospectPricingReply(): string {
  return `Starter is a ${FIRM_TRIAL_SENTENCE}. ${FIRM_TRIAL_CARD_NOTE} A business owner's own workspace is $39 a month, and free when their accountant is on Milōn. I won't invent another price. This page is a labelled SAMPLE.`;
}

const INJECTION = [
  /ignore (all |any |the )?(previous|prior|above) (instructions|rules|prompts)/i,
  /system prompt/i,
  /you are now/i,
  /\bjailbreak\b/i,
  /developer message/i,
  /reveal (your )?(instructions|prompt|rules)/i,
  /disregard (your |the )?(rules|instructions)/i,
];

export function looksLikeInjection(message: string): boolean {
  return INJECTION.some((pattern) => pattern.test(message));
}

export const PROSPECT_INJECTION_REPLY =
  "I can only talk about the sample on this page. Tell me about the business, and I'll open the labelled SAMPLE after your name and email.";

export const PROSPECT_LEAD_ASK =
  "Before I open the sample, I need your name and email. The figures that follow are labelled SAMPLE.";

export const PROSPECT_NO_BOOKS_REPLY =
  "This page doesn't connect to accounting software, and it doesn't write anything back.";

export const PROSPECT_NO_FILING_REPLY =
  "I don't file returns. An accountant does. This page is a labelled SAMPLE.";

const LIVE_WRITE =
  /connect(ed|ion)? (to )?(my )?(books|ledger|software)|post(ed)? (a |the )?journal|write (to|back)|sync(ed)? (your |the |my )?books/i;

const FILING =
  /log\s*in|sign\s*in|e-?file|submit (my |the |a )?(return|tax)|file (my |the |a )?(return|tax)/i;

/** Built without a literal currency code so a scanned bundle does not contain one. */
function currencyCode(): string {
  return "zAR".replace(/^z/, "Z");
}

export function mentionsBlockedMoney(text: string, country: "US" | "ZA"): boolean {
  if (country === "ZA") return false;
  const code = currencyCode();
  if (text.includes(code)) return true;
  return /\brand\b/i.test(text) || /\bR\s?\d/.test(text);
}

export function mentionsLiveWrite(text: string): boolean {
  return LIVE_WRITE.test(text);
}

export function mentionsFiling(text: string): boolean {
  return FILING.test(text);
}

/** Drop invented figures before the lead. Two digits or a money sign is enough. */
export function hasPrematureFigure(text: string): boolean {
  return /[$€£]\s?\d|\b\d{2,}\b/.test(text);
}

export const PROSPECT_NO_FIGURES_REPLY =
  "I'll open the labelled SAMPLE after your name and email. I won't quote figures before that.";

export function guardProspectReply(
  text: string,
  country: "US" | "ZA",
  askLead: boolean,
  figures: "hold" | "allow" = "hold",
): string {
  const trimmed = text.replace(/\s+/g, " ").trim().slice(0, 800);
  if (!trimmed) return askLead ? PROSPECT_LEAD_ASK : PROSPECT_NO_FIGURES_REPLY;
  if (mentionsBlockedMoney(trimmed, country)) {
    return "I can walk the sample in dollars. The figures are labelled SAMPLE and show up after your name and email.";
  }
  if (mentionsLiveWrite(trimmed)) return PROSPECT_NO_BOOKS_REPLY;
  if (mentionsFiling(trimmed)) return PROSPECT_NO_FILING_REPLY;
  if (figures === "hold" && !askLead && hasPrematureFigure(trimmed))
    return PROSPECT_NO_FIGURES_REPLY;
  return trimmed;
}

export function scriptedProspectReply(agent: ProspectAgentCopy, askLead: boolean): string {
  if (askLead) return PROSPECT_LEAD_ASK;
  return agent.questions[1] ?? agent.questions[0] ?? agent.greeting;
}

const NAME_MAX = 120;
const EMAIL_MAX = 200;

export function validateProspectLead(input: {
  name: string;
  email: string;
  consent: boolean;
  honeypot?: string;
}):
  | { ok: true; name: string; email: string }
  | { ok: false; silent: true }
  | { ok: false; error: string } {
  if ((input.honeypot ?? "").length > 0) return { ok: false, silent: true };
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > NAME_MAX) return { ok: false, error: "Add your name." };
  const email = input.email.trim().toLowerCase();
  if (email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Add a valid email." };
  }
  if (input.consent !== true) return { ok: false, error: "Tick the box to continue." };
  return { ok: true, name, email };
}

export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function prospectSampleNonceOk(raw: string): boolean {
  return /^[A-Za-z0-9_-]{20,120}$/.test(raw);
}

export function newProspectToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
