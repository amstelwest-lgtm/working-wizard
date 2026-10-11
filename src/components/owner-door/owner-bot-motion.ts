import { flushSync } from "react-dom";
import type { AgentKey } from "@/lib/milon-team-feed";

const BOTS = ["financial_manager", "analyst", "advisor"] as const;

export function ownerBotKey(value: string | null | undefined): AgentKey | null {
  if (value === "financial_manager" || value === "analyst" || value === "advisor") return value;
  return null;
}

export const OWNER_BOT_KEYS: readonly AgentKey[] = BOTS;

type StartViewTransition = (update: () => void) => { finished: Promise<void> };

function viewTransition(): StartViewTransition | null {
  if (typeof document === "undefined") return null;
  const start = (document as Document & { startViewTransition?: StartViewTransition })
    .startViewTransition;
  return start ? start.bind(document) : null;
}

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Shared-element zoom when the browser can do it.
 * Reduced motion, and browsers without the API, crossfade instead.
 */
export function runBotTransition(update: () => void): Promise<void> {
  if (typeof document === "undefined") {
    update();
    return Promise.resolve();
  }
  const start = viewTransition();
  if (!start) {
    document.documentElement.dataset.botFade = "plain";
    update();
    return new Promise((resolve) => {
      window.setTimeout(() => {
        if (document.documentElement.dataset.botFade === "plain") {
          delete document.documentElement.dataset.botFade;
        }
        resolve();
      }, 180);
    });
  }
  if (reducedMotion()) document.documentElement.dataset.botFade = "cross";
  const transition = start(() => {
    flushSync(update);
  });
  return transition.finished.finally(() => {
    if (document.documentElement.dataset.botFade === "cross") {
      delete document.documentElement.dataset.botFade;
    }
  });
}
