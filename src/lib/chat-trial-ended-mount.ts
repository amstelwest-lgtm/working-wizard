/**
 * Mount the trial-ended plan card into a chat host.
 * The ask-ai widget is plain DOM, so the card gets its own React root.
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { ChatTrialEndedPlan } from "@/components/trial-ended-plan-block";
import type { TrialEndedBillingAudience } from "@/lib/trial-ended-billing";

export function mountChatTrialEndedPlan(
  host: HTMLElement,
  firmId: string | null,
  audience: TrialEndedBillingAudience = "owner",
): () => void {
  const root = createRoot(host);
  root.render(createElement(ChatTrialEndedPlan, { firmId, audience }));
  return () => {
    root.unmount();
  };
}
