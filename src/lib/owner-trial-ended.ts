/**
 * Owner chat when ask-ai or Milōn Bot returns the cardless trial block.
 * The accountant pays for a linked firm. An owner with no firm sees their own plan.
 */
import type { OwnerVisitor } from "./owner-plan.ts";
import type { OwnerSubscribeView } from "./owner-subscribe.ts";
import { isStarterTrialEndedMessage } from "./starter-trial-generation.ts";

export const OWNER_ACCOUNTANT_TRIAL_NOTE =
  "Your accountant's Milōn plan needs to be renewed before the team can answer here. Ask your accountant to choose a plan.";

export type OwnerChatPlan = {
  /** True when this business is a client of an accountant firm. */
  accountantFirm: boolean;
  visitor: OwnerVisitor | null;
  zaMonthly?: string | null;
  firmName?: string | null;
  billing?: OwnerSubscribeView;
  subscribeBusy?: boolean;
  onSubscribe?: () => void;
};

export function ownerAskIsTrialEnded(
  message: string | null | undefined,
  code?: string | null,
): boolean {
  const extra = typeof code === "string" ? code.trim() : "";
  if (extra && isStarterTrialEndedMessage(extra)) return true;
  const text = typeof message === "string" ? message.trim() : "";
  return text !== "" && isStarterTrialEndedMessage(text);
}
