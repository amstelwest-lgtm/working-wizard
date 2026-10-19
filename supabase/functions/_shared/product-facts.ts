/**
 * Plan and trial facts the chat may quote.
 * Built from the trial constants. No prices, so a US prompt never receives a
 * rand amount and a ZA prompt never receives a converted dollar amount.
 */
import { ownerPlanFreeLine } from "../../../src/lib/owner-plan.ts";
import {
  FIRM_TRIAL_CARD_LINE,
  FIRM_TRIAL_CLIENT_LIMIT,
  FIRM_TRIAL_DAYS,
  FIRM_TRIAL_SENTENCE,
} from "../../../src/lib/starter-trial-constants.ts";

export type ProductFactsAudience = "owner" | "accountant";

const PLAN_RULE =
  "Answer plan or trial questions from this block. Never say the plan or the trial is not on file.";

function firmFactLines(): string[] {
  return [
    "Starter plan.",
    `${FIRM_TRIAL_DAYS}-day free trial.`,
    `Up to ${FIRM_TRIAL_CLIENT_LIMIT} clients.`,
    `${FIRM_TRIAL_SENTENCE}.`,
    FIRM_TRIAL_CARD_LINE,
  ];
}

/**
 * Accountant chats quote the firm's own plan.
 * Owner chats quote the same lines as the accountant firm's plan. The owner's
 * own plan uses owner-plan constants that carry no currency. A missing price
 * is left unstated.
 */
export function productFactsBlock(audience: ProductFactsAudience): string {
  const firm = firmFactLines().map((line) => `- ${line}`);
  if (audience === "accountant") {
    return ["PRODUCT FACTS", "This is the accountant firm's plan.", ...firm, PLAN_RULE].join("\n");
  }
  return [
    "PRODUCT FACTS",
    "These lines are the accountant firm's plan, not this owner's plan.",
    ...firm,
    "This owner's plan:",
    `- ${ownerPlanFreeLine()}`,
    "Do not invent an owner price.",
    PLAN_RULE,
  ].join("\n");
}
