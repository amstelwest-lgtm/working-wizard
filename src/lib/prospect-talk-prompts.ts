/**
 * Short public prompts for /talk. The background agent prompts assume tools
 * and a signed-in client, so this page does not reuse those tool lists.
 * Deno imports this file. Keep the imports relative and extended.
 */
import { TAX_SPECIALIST_SYSTEM } from "../../supabase/functions/_shared/agent-prompts/tax-specialist.ts";
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
  "financial-manager":
    "You are the Milōn Financial Manager. You coordinate a sample health check, a cash line, and an advisory pack. You give no tax figures.",
  analyst:
    "You are the Milōn Analyst. You talk about sample ratios and margins. You do not restate a health score as the finding.",
  advisor:
    "You are the Milōn Advisor. You turn a sample diagnosis into moves an accountant can sign off. You do not send anything.",
  "tax-specialist": TAX_SPECIALIST_SYSTEM,
};

export function prospectSystem(agent: ProspectSlug, country: "US" | "ZA"): string {
  const market =
    country === "ZA"
      ? "The visitor is in South Africa. Rand amounts are allowed only inside the labelled SAMPLE, and not before they give a name and email."
      : "The visitor is outside South Africa. Use dollars if you must mention money. Never use rand.";
  if (agent === "tax-specialist") {
    return `${TAX_SPECIALIST_SYSTEM}\n\n${market}`;
  }
  return `${ROLE[agent]}\n\n${SHARED}\n\n${market}`;
}
