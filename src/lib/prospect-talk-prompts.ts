/**
 * Short public prompts for /talk. The background agent prompts assume tools
 * and a signed-in client, so this page does not reuse those tool lists.
 * Deno imports this file. Keep the imports relative and extended.
 */
import { TAX_SPECIALIST_SYSTEM } from "../../supabase/functions/_shared/agent-prompts/tax-specialist.ts";
import { OWNER_MONTHLY_USD_LABEL } from "./owner-plan.ts";
import { AGENT_DISPLAY_NAME } from "./milon-team-names.ts";
import { FIRM_TRIAL_CARD_NOTE, FIRM_TRIAL_SENTENCE } from "./starter-trial-constants.ts";
import type { ProspectSlug } from "./prospect-talk.ts";

export { TAX_SPECIALIST_SYSTEM };

const SHARED = `You are one Milōn agent on a public sample page. No account is required.
The figures are a labelled SAMPLE. Do not invent amounts, ratios, or dates.
Do not say you connected to accounting software. Do not write to a ledger.
Do not file a return and do not log into a tax authority.
Do not name the model or the company that provides it.
If the visitor is not in South Africa, do not mention rand amounts.
Keep the reply under 80 words. Ask one question.
A person still signs off. You only prepare the sample.`;

const ROLE: Record<ProspectSlug, string> = {
  "financial-manager": `You are the ${AGENT_DISPLAY_NAME.financial_manager}. You coordinate a sample health check, a cash line, and an advisory pack. You give no tax figures.`,
  analyst: `You are the ${AGENT_DISPLAY_NAME.analyst}. You talk about sample ratios and margins. You do not restate a health score as the finding.`,
  advisor: `You are the ${AGENT_DISPLAY_NAME.advisor}. You turn a sample diagnosis into moves an accountant can sign off. You do not send anything.`,
  "tax-specialist": TAX_SPECIALIST_SYSTEM,
};

/**
 * Same words Eng2 publishes once the shared note stops claiming a card is
 * collected at signup. Used only while that shared note still says so.
 */
export const PROSPECT_CARD_AFTER_RESULT = "You add a card once you have seen your first result.";

function sharedNoteClaimsCardAtSignup(note: string): boolean {
  return /card/i.test(note) && /required at signup/i.test(note);
}

/** The landing trial note, unless that note still claims a card at signup. */
export function prospectCardTiming(): string {
  if (sharedNoteClaimsCardAtSignup(FIRM_TRIAL_CARD_NOTE)) return PROSPECT_CARD_AFTER_RESULT;
  return FIRM_TRIAL_CARD_NOTE;
}

/**
 * Owner monthly for a ZA visitor. Same spelling as
 * loadSaPricingCopy().ownerMonthly. This file is the edge prompt, not the
 * client bundle. A US prompt must not call this.
 */
export function prospectZaOwnerMonthly(): string {
  return `R ${299}/mo`;
}

/**
 * Published Starter trial and the owner price. The trial sentence and the
 * US owner label come from the shared constants. Rand is ZA only.
 */
export function prospectPricingReply(country: "US" | "ZA"): string {
  const owner = country === "ZA" ? prospectZaOwnerMonthly() : OWNER_MONTHLY_USD_LABEL;
  return `Starter is a ${FIRM_TRIAL_SENTENCE}. ${prospectCardTiming()} A business owner's own workspace is ${owner}, and free when their accountant is on Milōn. I won't invent another price. This page is a labelled SAMPLE.`;
}

function prospectPricingPrompt(country: "US" | "ZA"): string {
  return `When the visitor asks the price, use this published line and no other price. Signup does not collect a card. The first result comes before any card. Do not quote this price before they have given a name and email.\n${prospectPricingReply(country)}`;
}

export function prospectSystem(agent: ProspectSlug, country: "US" | "ZA"): string {
  const market =
    country === "ZA"
      ? "The visitor is in South Africa. Rand amounts are allowed only inside the labelled SAMPLE, and not before they give a name and email."
      : "The visitor is outside South Africa. Use dollars if you must mention money. Never use rand.";
  const pricing = prospectPricingPrompt(country);
  if (agent === "tax-specialist") {
    return `${TAX_SPECIALIST_SYSTEM}\n\n${market}\n\n${pricing}`;
  }
  return `${ROLE[agent]}\n\n${SHARED}\n\n${market}\n\n${pricing}`;
}
