/**
 * Short public prompts for /talk. The background agent prompts assume tools
 * and a signed-in client, so this page does not reuse those tool lists.
 * Deno imports this file. Keep the imports relative and extended.
 */
import { TAX_SPECIALIST_SYSTEM } from "../../supabase/functions/_shared/agent-prompts/tax-specialist.ts";
import { AGENT_DISPLAY_NAME } from "./milon-team-names.ts";
import { zaOwnerMonthlyLabel, zaTalkPriceLine } from "./pricing/za-talk-price.server.ts";
import { usTalkPriceLine } from "./public-pricing-lines.ts";
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
 * Owner monthly for a ZA visitor. Same string the pricing page renders.
 * A US prompt must not call this.
 */
export function prospectZaOwnerMonthly(): string {
  return zaOwnerMonthlyLabel();
}

/**
 * The public pricing page's line for this market. Trial length and the card
 * sentence are included only because that page states them. No hand-written
 * price.
 */
export function prospectPricingReply(country: "US" | "ZA"): string {
  const published = country === "ZA" ? zaTalkPriceLine() : usTalkPriceLine();
  return `${published} This page is a labelled SAMPLE.`;
}

function prospectPricingPrompt(country: "US" | "ZA"): string {
  return `When the visitor asks the price, answer immediately with this published line and no other price. Do not ask for a name or an email first.\n${prospectPricingReply(country)}`;
}

export function prospectSystem(agent: ProspectSlug, country: "US" | "ZA"): string {
  const market =
    country === "ZA"
      ? "The visitor is in South Africa. Quote the published price as soon as they ask. Other rand amounts belong only in the labelled SAMPLE, after a name and email."
      : "The visitor is outside South Africa. Use dollars if you must mention money. Never use rand.";
  const pricing = prospectPricingPrompt(country);
  if (agent === "tax-specialist") {
    return `${TAX_SPECIALIST_SYSTEM}\n\n${market}\n\n${pricing}`;
  }
  return `${ROLE[agent]}\n\n${SHARED}\n\n${market}\n\n${pricing}`;
}
