import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import {
  ACCOUNTANT_CLIENT_EMPTY_TOUR_KEY,
  ACCOUNTANT_CLIENT_TOUR_KEY,
  ACCOUNTANT_DASH_EMPTY_TOUR_KEY,
  ACCOUNTANT_DASH_TOUR_KEY,
  OWNER_EMPTY_TOUR_KEY,
  OWNER_TOUR_KEY,
  markOnboardingDone,
  onboardingDone,
} from "@/lib/onboarding";

export type WalkthroughVariant =
  | "owner"
  | "owner-empty"
  | "accountant-dashboard"
  | "accountant-dashboard-empty"
  | "accountant-client"
  | "accountant-client-empty";

type Step = {
  tab?: string;
  targetId: string | null;
  section?: string;
  title: string;
  body: string;
  /** One-line owner incentive — shown as a gold pull-quote on owner tours. */
  why?: string;
};

type Spot = {
  top: number;
  left: number;
  width: number;
  height: number;
  radius: number;
};

const CARD_APPROX_H = 280;
const SPOT_PAD = 10;
const ORB_PAD = 4;
const CARD_GAP = 20;

function isOwnerChrome(variant: WalkthroughVariant): boolean {
  return variant === "owner" || variant === "owner-empty";
}

/**
 * Owner, no figures yet: two honest steps that sell the unlock, not the chrome.
 * The full board tour (OWNER_STEPS) runs the first time a real score exists.
 */
const OWNER_EMPTY_STEPS: Step[] = [
  {
    tab: "today",
    targetId: "wizard-empty-score",
    section: "Business Health",
    title: "This is where you’ll see if the business is leaking",
    why: "Catch the weak spot while it’s still cheap to fix.",
    body: "Once your figures are in, this orb becomes an early-warning system — profit, assets, financing and cash each flag a different bottleneck. Nothing is invented. The rest of this tour continues on your real score the moment it lands.",
  },
  {
    tab: "today",
    targetId: "wizard-first-figures",
    section: "Figures",
    title: "One upload unlocks the whole board",
    why: "You get a working picture today. You get a signed picture when they stamp it.",
    body: "This is the only job right now. Bank statements or a financial statement — and Milōn drafts your Profit waterfall, 13-week cash forecast and year plan from it, then queues each for your accountant to review and sign off. Nothing is final until they do.",
  },
];

/**
 * Owner scored-board tour: an incentive-led walk of the operating board.
 * Every step must answer “what do I get for the business?” Bot and Budget
 * were dropped — they didn’t earn a slot next to notes, sign-off, product
 * lines, cash, Milōn Bot next moves, and the Action Plan.
 */
const OWNER_STEPS: Step[] = [
  {
    tab: "today",
    targetId: ".health-orb",
    section: "Business Health",
    title: "This score is an early-warning system — not a report card",
    why: "The weak pillar is the one quietly taxing the business.",
    body: "Profit, assets, financing and cash each flag a different bottleneck: customers paying late, stock tying up cash, debt that’s too heavy, or a week you can’t make payroll. Tap the orb. Fix the red one first — that’s how you stop managing by gut feel.",
  },
  {
    tab: "today",
    targetId: "wizard-notes-pin",
    section: "Notes",
    title: "Pin the question to the number — stop chasing it by email",
    why: "The answer comes back on the same figure, not in a lost thread.",
    body: "The gold pen drops a note on this exact page: a ratio, a cash week, a product line. Your accountant sees it as an open query on that deliverable. @mention them to email. Resolve it when you’re satisfied. That’s how you stop talking past each other.",
  },
  {
    tab: "waterfall",
    targetId: "wizard-profit-walk",
    section: "Profit",
    title: "Watch every rand go from a sale to what’s actually left",
    why: "Most owners only see a bank balance. This shows why it looks like that.",
    body: "This waterfall is the profit story in one picture — revenue, costs, and what stays. It is a working draft until your accountant reviews and signs it off. Don’t make a pricing or cost call on an unsigned number.",
  },
  {
    tab: "waterfall",
    targetId: "wizard-product-mix",
    section: "Product lines",
    title: "Find the line that actually makes the money",
    why: "Busy is not the same as profitable.",
    body: "Total profit can hide a product that’s loud but barely pays. Five short questions split revenue by line — sales share versus profit share. A quiet high-margin line may be carrying a noisy low-margin one. That’s the conversation that changes what you sell, drop, or reprice.",
  },
  {
    tab: "waterfall",
    targetId: "wizard-owner-signoff",
    section: "Sign-off",
    title: "Your accountant’s name on the number is the green light",
    why: "Speed from Milōn. Trust from the person who knows the file.",
    body: "Health, profit and cash wait for their stamp. When they sign, their signature appears here — the same number you can brief a bank or a partner on. Until then, treat it as a working draft. You move fast. They make it final.",
  },
  {
    tab: "cash",
    targetId: "wizard-cash-outlook, wizard-cash-table, wizard-cash-panel",
    section: "Cash Forecast",
    title: "See the next 13 weeks before a shortfall arrives",
    why: "Profit is last month. Cash is whether week 7 still works.",
    body: "This forecast is already built from your figures — closing balances and the weeks that go red. Use it to chase invoices, delay a spend, or call the bank while you still have options. Your accountant signs it off before you lean on it. Each new statement refreshes it and asks them to look again.",
  },
  {
    tab: "next",
    targetId: "wizard-moves-hero, wizard-moves-list",
    section: "Next moves",
    title: "Milōn Bot ranked the next move for this business — not a generic list",
    why: "The top item is the highest-value hour you can spend this week.",
    body: "These recommendations are curated from the full Milōn picture of this business. Your accountant can review them and sign off when they are fit to act on. Start at the top. Send the one you’ll own into the Action Plan.",
  },
  {
    tab: "tasks",
    targetId: "wizard-action-goal, wizard-action-list, wizard-action-plan, wizard-tasks-panel",
    section: "Action Plan",
    title: "Leave with a plan your accountant can see you run",
    why: "A diagnosis without owners is just a meeting.",
    body: "Set the quarter outcome up top, pull a move from Next Steps, put a name and a date on it. Same plan your accountant sees — so the next conversation is about progress, not “what were we going to do?” This is how advice turns into money.",
  },
];

const ACCOUNTANT_DASH_EMPTY_STEPS: Step[] = [
  {
    targetId: "wizard-practice-board",
    section: "Practice",
    title: "This is your practice board",
    body: "Every client you add lands here — health, runway and who needs attention. The book is empty until you add the first one. Same loop after that: add a client, upload their figures, review what Milōn drafts, sign off, deliver.",
  },
  {
    targetId: "wizard-add-client",
    section: "First client",
    title: "Step 2 of 2 · Add your first client",
    body: "Start with a real client whose statements you have to hand, or a sandbox client to learn the loop. After you add them, Milōn will ask for about 3 months of bank statements or a P&L and balance sheet — one upload drafts Profit, Cash and Budget for you to sign off.",
  },
];

const ACCOUNTANT_DASH_STEPS: Step[] = [
  {
    targetId: "wizard-practice-board",
    section: "Practice",
    title: "Your whole book at a glance",
    body: "Health, runway and status for every client — so you know who needs a call before they do. Each tile is a pulse-check on the book, not a to-do list.",
  },
  {
    targetId: "wizard-dash-queries, wizard-practice-board",
    section: "Queries",
    title: "The Queries column",
    body: "In the client table, Queries is the inbox for questions from client management. A number here means something is waiting on you — open the row and reply on the same figure they marked.",
  },
  {
    targetId: ".ctable tbody tr, .client-card, [data-client-row]",
    section: "Clients",
    title: "Open a client workspace",
    body: "Click a row to open the shared workspace. You and the client work on the same numbers and the same tabs. Their screen looks a little different — they see a simpler view — but it is the same file.",
  },
  {
    targetId: "wizard-dash-reports",
    section: "Reports",
    title: "Reports you can brand",
    body: "Reports Studio is where you assemble board-ready PDFs. You can brand them with the client's own logo and colours — not only the firm's.",
  },
  {
    targetId: "wizard-add-client",
    section: "Grow the book",
    title: "Add the next client",
    body: "Use Add client, then start from what they send you — bank statements, management accounts, or a spreadsheet. MILŌN drafts the profitability graphs, the cashflow forecast, and the rolling 12-month budget. You review, correct, and sign off.",
  },
];

/**
 * Accountant, client has no figures yet: two honest steps pointing at the one
 * thing to do. The full studio tour (ACCOUNTANT_CLIENT_STEPS) runs the first
 * time this client has a real score.
 */
const ACCOUNTANT_CLIENT_EMPTY_STEPS: Step[] = [
  {
    tab: "overview",
    targetId: "first-figures-card, .health-orb",
    section: "This file",
    title: "Nothing is in this file yet",
    body: "You are looking at an empty client workspace. There is no health score, no profit picture, and no forecast until someone puts numbers in. That is normal on a new file — it is not broken.",
  },
  {
    tab: "overview",
    targetId: "first-figures-card",
    section: "Figures",
    title: "Start with one upload",
    body: "Ask client management for bank statements or a P&L and balance sheet — or drop the file in yourself. One upload is enough for MILŌN to draft Profitability, the 13-week Cash Forecast, and the 12-month Budget. Each tab then waits for your review and sign-off before anything is branded or delivered.",
  },
];

const ACCOUNTANT_CLIENT_STEPS: Step[] = [
  {
    tab: "ask",
    targetId: "ask-ai-accountant",
    section: "Milōn Bot",
    title: "Start with Milōn Bot",
    body: "Ask against the drafted deliverables — ratios, waterfall, cash outlook, next moves, the action plan — or what’s outstanding on the brain. It can draft next steps or an advisory pack for you to review. It won’t invent figures or send email.",
  },
  {
    tab: "overview",
    targetId: "wizard-open-queries",
    section: "Queries",
    title: "Questions from client management",
    body: "When client management pins a question on a number, it lands here as an open query. Click to jump to the same figure they marked. The Queries column on your practice board counts what is still waiting.",
  },
  {
    tab: "summary",
    targetId: "wizard-brain-hero, pane-summary",
    section: "Client Brain",
    title: "The client brain is the background file",
    body: "This tab is the context around the client — profile, facts, uploads, drafts — so you and Milōn Bot can advise this business, not a generic SME. Empty blocks are waiting for a fact or an upload; they are not broken. Agreed work that client management will chase lives on Action Plan.",
  },
  {
    tab: "ratios",
    targetId: "finCollapse",
    section: "Figures",
    title: "Figures live here",
    body: "Open this panel to correct a line, change the period, or upload a new statement. Every upload can refresh Profitability, the Cash Forecast and the Budget — and anything you had signed off flips to Needs re-review until you look again.",
  },
  {
    tab: "ratios",
    targetId: ".health-orb",
    section: "Business Health",
    title: "The health score",
    body: "The gold orb is this business’s health score — one number built from the ratios underneath. Click through the rings to see what is pulling the score up or down, so you can explain it to client management in plain language.",
  },
  {
    tab: "profit",
    targetId: "wizard-profit-walk",
    section: "Profit",
    title: "Profit is drafted — review it",
    body: "MILŌN built this waterfall from the first upload. Check the lines, then sign off Profitability with the gold button. Until you do, client management sees a draft with no stamp.",
  },
  {
    tab: "cash",
    targetId: "wizard-cash-outlook, wizard-cash-table, wizard-cash-panel",
    section: "Cash Forecast",
    title: "13 weeks, forecast for you",
    body: "Closing balances and crunch weeks, drafted from the same upload. Review the assumptions, sign off the 13-week Cash Forecast, and align client management on collections or spend timing before a shortfall hits.",
  },
  {
    tab: "budget",
    targetId: "wizard-budget-tab-head, wizard-budget-plan, wizard-budget-panel",
    section: "Budget",
    title: "The 12-month Budget",
    body: "This is the year plan. The graph at the top is the picture; the numbers underneath are the plan you can edit. Sign the 12-month Budget when it reads true, then compare what actually happened against it.",
  },
  {
    tab: "reports",
    targetId: "pane-reports",
    section: "Reports",
    title: "Deliver branded advice",
    body: "This is the same Reports Studio as the rest of the practice. Sign off Business Health & Ratios, Profitability, the 13-week Cash Forecast, or the 12-month Budget first — each stamp carries into the board-ready PDF you generate here.",
  },
  {
    tab: "plan",
    targetId: "wizard-action-goal, wizard-action-list, wizard-action-plan, pane-plan",
    section: "Action Plan",
    title: "This is the Action Plan",
    body: "This tab is the shared work list for the engagement: what still needs doing, who owns each item, and what is overdue. Your job is to sign the work off when it is ready, then help client management follow up on anything still outstanding.",
  },
];

function stepsFor(variant: WalkthroughVariant): Step[] {
  if (variant === "accountant-dashboard") return ACCOUNTANT_DASH_STEPS;
  if (variant === "accountant-dashboard-empty") return ACCOUNTANT_DASH_EMPTY_STEPS;
  if (variant === "accountant-client") return ACCOUNTANT_CLIENT_STEPS;
  if (variant === "accountant-client-empty") return ACCOUNTANT_CLIENT_EMPTY_STEPS;
  if (variant === "owner-empty") return OWNER_EMPTY_STEPS;
  return OWNER_STEPS;
}

function storageKeyFor(variant: WalkthroughVariant): string {
  if (variant === "accountant-dashboard") return ACCOUNTANT_DASH_TOUR_KEY;
  if (variant === "accountant-dashboard-empty") return ACCOUNTANT_DASH_EMPTY_TOUR_KEY;
  if (variant === "accountant-client") return ACCOUNTANT_CLIENT_TOUR_KEY;
  if (variant === "accountant-client-empty") return ACCOUNTANT_CLIENT_EMPTY_TOUR_KEY;
  if (variant === "owner-empty") return OWNER_EMPTY_TOUR_KEY;
  return OWNER_TOUR_KEY;
}

function resolveTarget(targetId: string): Element | null {
  const parts = targetId
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    const el = /^[.#[]/.test(part) ? document.querySelector(part) : document.getElementById(part);
    if (el) return el;
  }
  return null;
}

function readRadius(el: Element, width: number, height: number, pad: number): number {
  if (el instanceof HTMLElement && el.classList.contains("health-orb")) {
    return Math.max(width, height) / 2 + pad;
  }
  const style = window.getComputedStyle(el);
  const raw = style.borderTopLeftRadius || style.borderRadius || "0";
  if (raw.includes("%")) {
    const pct = parseFloat(raw) || 0;
    return (Math.min(width, height) * pct) / 100 + pad;
  }
  const px = parseFloat(raw) || 0;
  // Near-circular buttons (orb): keep a full circle spotlight
  if (
    Math.abs(width - height) < 8 &&
    (px >= Math.min(width, height) / 2 - 1 || el.classList.contains("rounded-full"))
  ) {
    return Math.max(width, height) / 2 + pad;
  }
  return Math.min(24, px + 4) + pad * 0.35;
}

function padFor(el: Element): number {
  return el instanceof HTMLElement && el.classList.contains("health-orb") ? ORB_PAD : SPOT_PAD;
}

function measureSpot(el: Element): Spot {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = padFor(el);
  const isOrb = el instanceof HTMLElement && el.classList.contains("health-orb");

  // The health orb is a circle — hug it instead of clipping to a short rectangle.
  if (isOrb) {
    const size = Math.max(r.width, r.height) + pad * 2;
    return {
      top: r.top + r.height / 2 - size / 2,
      left: r.left + r.width / 2 - size / 2,
      width: size,
      height: size,
      radius: size / 2,
    };
  }

  // Intersect with the viewport so tall panes still get a clear lit region
  const top = Math.max(r.top, 10);
  const left = Math.max(r.left, 10);
  const bottom = Math.min(r.bottom, vh - 10);
  const right = Math.min(r.right, vw - 10);
  let width = Math.max(48, right - left) + pad * 2;
  let height = Math.max(48, bottom - top) + pad * 2;
  let spotTop = top - pad;
  let spotLeft = left - pad;

  // Keep the hole compact so the tour card has room to show the full body
  const maxH = Math.min(vh * 0.28, 240);
  if (height > maxH) {
    height = maxH;
    // Anchor to the visible top of the target — don't float the hole mid-page
    spotTop = Math.max(10, Math.min(top - pad, vh - maxH - 12));
  }
  const maxW = Math.min(vw * 0.92, vw - 24);
  if (width > maxW) {
    width = maxW;
    spotLeft = Math.max(12, Math.min(left - pad, vw - maxW - 12));
  }

  return {
    top: spotTop,
    left: spotLeft,
    width,
    height,
    radius: readRadius(
      el,
      Math.min(r.width, width - pad * 2),
      Math.min(r.height, height - pad * 2),
      pad,
    ),
  };
}

function measuredCardHeight(el: HTMLElement | null, fallback = CARD_APPROX_H): number {
  if (!el) return fallback;
  return Math.max(el.scrollHeight, el.offsetHeight);
}

/** Place the tour card fully outside the spotlight, sized to its paragraph. */
function cardLayoutForSpot(
  spot: Spot | null,
  cardH: number,
): { top: number; maxHeight: number } {
  const vh = window.innerHeight;
  const margin = 12;
  const needed = Math.max(cardH, 1);
  const viewportCap = vh - margin * 2;

  if (!spot) {
    const maxHeight = Math.min(needed, viewportCap);
    return { top: Math.max(margin, vh - maxHeight - margin), maxHeight };
  }

  const belowTop = spot.top + spot.height + CARD_GAP;
  const spaceBelow = Math.max(0, vh - belowTop - margin);
  const spaceAbove = Math.max(0, spot.top - CARD_GAP - margin);

  if (spaceBelow >= needed) {
    return { top: belowTop, maxHeight: needed };
  }
  if (spaceAbove >= needed) {
    return { top: Math.max(margin, spot.top - CARD_GAP - needed), maxHeight: needed };
  }
  if (spaceBelow >= spaceAbove) {
    return { top: belowTop, maxHeight: Math.max(140, spaceBelow) };
  }
  return { top: margin, maxHeight: Math.max(140, spaceAbove) };
}

function scrollTargetAwayFromCard(el: Element, cardH: number, reduceMotion = false) {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const room = Math.min(cardH + CARD_GAP + 16, vh * 0.72);
  // Park the feature in the upper band so the card can sit cleanly underneath
  const desiredTop = Math.max(56, Math.min(vh * 0.14, vh - room - Math.min(r.height, vh * 0.4)));
  const delta = r.top - desiredTop;
  if (Math.abs(delta) > 20) {
    window.scrollBy({ top: delta, behavior: reduceMotion ? "auto" : "smooth" });
  }
}

export function WalkthroughWizard({
  onTabChange,
  userRole,
  variant: variantProp,
  ready = true,
  onComplete,
  onFinish,
}: {
  onTabChange?: (tab: string) => void;
  userRole?: string | null;
  /** Explicit tour; otherwise inferred from role. */
  variant?: WalkthroughVariant;
  /** When false, tour stays hidden (e.g. until profile + first data finish). */
  ready?: boolean;
  /** Fires on both "Skip tour" and the final button. */
  onComplete?: () => void;
  /** Fires only when the last step's primary button is pressed (not on skip). */
  onFinish?: () => void;
}) {
  const variant: WalkthroughVariant =
    variantProp ??
    (userRole === "accountant" || userRole === "firm_admin" ? "accountant-dashboard" : "owner");

  const STEPS = stepsFor(variant);
  const storageKey = storageKeyFor(variant);
  const ownerChrome = isOwnerChrome(variant);
  const reduceMotion = usePrefersReducedMotion();
  const motionTransition = reduceMotion
    ? "none"
    : "top var(--brand-duration) var(--brand-ease), left var(--brand-duration) var(--brand-ease), width var(--brand-duration) var(--brand-ease), height var(--brand-duration) var(--brand-ease), border-radius var(--brand-duration) var(--brand-ease)";

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [cardTop, setCardTop] = useState(28);
  const [cardMaxH, setCardMaxH] = useState(420);
  const prevTargetRef = useRef<string | null>(null);
  const activeElRef = useRef<Element | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const onTabChangeRef = useRef(onTabChange);
  const lastTabRef = useRef<string | null>(null);
  const spotRef = useRef<Spot | null>(null);
  const paintTimersRef = useRef<number[]>([]);

  onTabChangeRef.current = onTabChange;

  useEffect(() => {
    if (!ready) {
      setVisible(false);
      return;
    }
    if (!onboardingDone(storageKey)) setVisible(true);
  }, [ready, storageKey]);

  useEffect(() => {
    if (!visible) return;
    const s = STEPS[step];
    if (!s) return;

    if (prevTargetRef.current && prevTargetRef.current !== s.targetId) {
      resolveTarget(prevTargetRef.current)?.classList.remove("wizard-highlight");
    }

    // Only switch tabs when the step's tab actually changes — never re-fire on
    // parent re-renders (inline onTabChange identities used to restart this
    // effect and thrash scroll/state until the page crashed on Cash).
    if (s.tab && s.tab !== lastTabRef.current) {
      lastTabRef.current = s.tab;
      onTabChangeRef.current?.(s.tab);
    }

    let cancelled = false;
    let tries = 0;
    paintTimersRef.current.forEach((id) => clearTimeout(id));
    paintTimersRef.current = [];

    const spotsEqual = (a: Spot | null, b: Spot | null) => {
      if (a === b) return true;
      if (!a || !b) return false;
      return (
        Math.abs(a.top - b.top) < 1 &&
        Math.abs(a.left - b.left) < 1 &&
        Math.abs(a.width - b.width) < 1 &&
        Math.abs(a.height - b.height) < 1 &&
        Math.abs(a.radius - b.radius) < 1
      );
    };

    const layout = (el: Element | null) => {
      if (cancelled) return;
      const cardH = measuredCardHeight(cardRef.current);
      if (!el) {
        if (spotRef.current !== null) {
          spotRef.current = null;
          setSpot(null);
        }
        const pos = cardLayoutForSpot(null, cardH);
        setCardTop((t) => (Math.abs(t - pos.top) < 1 ? t : pos.top));
        setCardMaxH((h) => (Math.abs(h - pos.maxHeight) < 1 ? h : pos.maxHeight));
        return;
      }
      const next = measureSpot(el);
      if (!spotsEqual(spotRef.current, next)) {
        spotRef.current = next;
        setSpot(next);
      }
      const pos = cardLayoutForSpot(next, cardH);
      setCardTop((t) => (Math.abs(t - pos.top) < 1 ? t : pos.top));
      setCardMaxH((h) => (Math.abs(h - pos.maxHeight) < 1 ? h : pos.maxHeight));
    };

    const apply = () => {
      if (cancelled) return;
      if (!s.targetId) {
        activeElRef.current = null;
        prevTargetRef.current = null;
        layout(null);
        return;
      }
      const el = resolveTarget(s.targetId);
      if (!el) {
        // Tab content may still be mounting (lazy Cash/Budget) — retry briefly
        if (tries++ < 30) {
          const id = window.setTimeout(apply, 120);
          paintTimersRef.current.push(id);
        } else {
          activeElRef.current = null;
          layout(null);
        }
        return;
      }

      el.classList.add("wizard-highlight");
      activeElRef.current = el;
      prevTargetRef.current = s.targetId;

      const cardH = measuredCardHeight(cardRef.current);
      scrollTargetAwayFromCard(el, cardH, reduceMotion);

      const paint = () => {
        if (cancelled || activeElRef.current !== el) return;
        layout(el);
      };

      requestAnimationFrame(() => {
        paint();
        paintTimersRef.current.push(window.setTimeout(paint, 320));
        paintTimersRef.current.push(window.setTimeout(paint, 700));
      });
    };

    const timer = window.setTimeout(apply, 160);
    paintTimersRef.current.push(timer);

    return () => {
      cancelled = true;
      paintTimersRef.current.forEach((id) => clearTimeout(id));
      paintTimersRef.current = [];
    };
    // Intentionally omit onTabChange — held in a ref to avoid re-entry loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, visible, variant]);

  // Keep spotlight glued to the target on scroll/resize; throttle to avoid
  // update storms while smooth-scrolling the cash/budget panels into place.
  useLayoutEffect(() => {
    if (!visible) return;

    let raf = 0;
    const refresh = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const el = activeElRef.current;
        const cardH = measuredCardHeight(cardRef.current);
        if (!el || !document.contains(el)) {
          if (spotRef.current !== null) {
            spotRef.current = null;
            setSpot(null);
          }
          const pos = cardLayoutForSpot(null, cardH);
          setCardTop((t) => (Math.abs(t - pos.top) < 1 ? t : pos.top));
          setCardMaxH((h) => (Math.abs(h - pos.maxHeight) < 1 ? h : pos.maxHeight));
          return;
        }
        const next = measureSpot(el);
        const prev = spotRef.current;
        if (
          !prev ||
          Math.abs(prev.top - next.top) >= 1 ||
          Math.abs(prev.left - next.left) >= 1 ||
          Math.abs(prev.width - next.width) >= 1 ||
          Math.abs(prev.height - next.height) >= 1
        ) {
          spotRef.current = next;
          setSpot(next);
        }
        const pos = cardLayoutForSpot(next, cardH);
        setCardTop((t) => (Math.abs(t - pos.top) < 1 ? t : pos.top));
        setCardMaxH((h) => (Math.abs(h - pos.maxHeight) < 1 ? h : pos.maxHeight));
      });
    };

    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [visible, step, ownerChrome]);

  const dismiss = () => {
    markOnboardingDone(storageKey);
    document
      .querySelectorAll(".wizard-highlight")
      .forEach((el) => el.classList.remove("wizard-highlight"));
    activeElRef.current = null;
    setSpot(null);
    setVisible(false);
    onComplete?.();
  };

  if (!visible || !ready) return null;

  const s = STEPS[step];
  if (!s) return null;
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  const SECTION_COLORS: Record<string, string> = {
    "Business Health": "#c9962b",
    "Milōn Bot": "#8b5cf6",
    "Ask AI": "#8b5cf6",
    Profit: "#2563eb",
    "Cash Forecast": "#0ea5e9",
    Budget: "#d4a550",
    Notes: "#d4a550",
    "Product lines": "#c9962b",
    "Sign-off": "#d4a550",
    "Next moves": "#10b981",
    "Action Plan": "#8b5cf6",
    Practice: "#c9962b",
    "Grow the book": "#c9962b",
    "First client": "#c9962b",
    Clients: "#c9962b",
    Reports: "#10b981",
    Workspace: "#c9962b",
    Upload: "#0ea5e9",
    Figures: "#0ea5e9",
    Overview: "#c9962b",
  };
  const sectionColor = SECTION_COLORS[s.section ?? "Overview"] ?? "#c9962b";

  return (
    <>
      {/* Click catcher — does not dim; spotlight box-shadow dims around the hole */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 8000,
          pointerEvents: "all",
          background: spot ? "transparent" : "rgba(7, 9, 15, 0.68)",
        }}
      />

      {/* Spotlight hole: transparent pad + giant shadow darkens everything else */}
      {spot && (
        <div
          aria-hidden
          className="wizard-spotlight"
          style={{
            position: "fixed",
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            borderRadius: spot.radius,
            boxShadow: "0 0 0 9999px rgba(7, 9, 15, 0.72)",
            outline: `2px solid rgba(${hexToRgb(sectionColor)}, 0.85)`,
            outlineOffset: 2,
            zIndex: 8001,
            pointerEvents: "none",
            transition: motionTransition,
          }}
        />
      )}

      <div
        ref={cardRef}
        className={ownerChrome ? "walkthrough-card walkthrough-card--owner" : "walkthrough-card"}
        style={{
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          top: cardTop,
          bottom: "auto",
          zIndex: 8002,
          width: "min(560px, calc(100vw - 24px))",
          pointerEvents: "all",
          maxHeight: cardMaxH,
          overflowY: cardMaxH + 8 < measuredCardHeight(cardRef.current) ? "auto" : "hidden",
          transition: reduceMotion
            ? "none"
            : "top var(--brand-duration) var(--brand-ease), max-height var(--brand-duration) var(--brand-ease)",
        }}
      >
        <div
          style={{
            position: "relative",
            background: ownerChrome
              ? "linear-gradient(180deg, #141c2e 0%, #0d1525 28%, #0b1220 100%)"
              : "#0d1525",
            border: ownerChrome
              ? "1px solid rgba(212, 165, 80, 0.28)"
              : `1px solid rgba(${hexToRgb(sectionColor)}, 0.35)`,
            borderRadius: 16,
            padding: "20px 24px 22px",
            boxShadow: ownerChrome
              ? "0 36px 72px rgba(0,0,0,0.72), 0 0 0 1px rgba(255,255,255,0.05), 0 0 48px rgba(212,165,80,0.08)"
              : "0 32px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
            overflow: "hidden",
          }}
        >
          {ownerChrome && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 3,
                background:
                  "linear-gradient(90deg, #ac8400 0%, #d4af37 35%, #fdee79 50%, #d4af37 65%, #ac8400 100%)",
              }}
            />
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
              gap: 12,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: ownerChrome ? "0.16em" : "0.13em",
                textTransform: "uppercase",
                color: ownerChrome ? "#e5be72" : sectionColor,
                background: ownerChrome
                  ? "rgba(212, 165, 80, 0.12)"
                  : `rgba(${hexToRgb(sectionColor)}, 0.12)`,
                padding: "3px 10px",
                borderRadius: 999,
                border: ownerChrome ? "1px solid rgba(212, 165, 80, 0.22)" : "none",
              }}
            >
              {ownerChrome ? `Milōn · ${s.section ?? "Overview"}` : (s.section ?? "Overview")}
            </span>
            <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>
              {step + 1} / {STEPS.length}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              gap: 3,
              marginBottom: 16,
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            {STEPS.map((_, i) => (
              <div
                key={i}
                style={{
                  height: 3,
                  flex: 1,
                  borderRadius: 2,
                  background: i <= step ? (ownerChrome ? "#d4a550" : sectionColor) : "#1e293b",
                  opacity: i < step ? 0.45 : 1,
                  transition: reduceMotion ? "none" : "background var(--brand-duration) var(--brand-ease)",
                }}
              />
            ))}
          </div>

          <h3
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#f8fafc",
              marginBottom: ownerChrome ? 12 : 10,
              lineHeight: 1.28,
              fontFamily: "var(--font-display)",
              letterSpacing: ownerChrome ? "-0.015em" : undefined,
            }}
          >
            {s.title}
          </h3>

          {ownerChrome && s.why && (
            <p
              style={{
                fontSize: 13.5,
                fontWeight: 600,
                color: "#e5be72",
                lineHeight: 1.45,
                margin: "0 0 10px",
                fontFamily: "var(--font-display)",
              }}
            >
              {s.why}
            </p>
          )}

          <p
            style={{
              fontSize: 13.5,
              color: ownerChrome ? "#cbd5e1" : "#94a3b8",
              lineHeight: 1.65,
              marginBottom: 20,
            }}
          >
            {s.body}
          </p>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <button
              onClick={dismiss}
              style={{
                fontSize: 12,
                color: "#64748b",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px 0",
                fontFamily: "inherit",
              }}
            >
              Skip tour
            </button>

            <div style={{ display: "flex", gap: 8 }}>
              {!isFirst && (
                <button
                  onClick={() => setStep((x) => x - 1)}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#cbd5e1",
                    background: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: 8,
                    padding: "9px 18px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Back
                </button>
              )}
              <button
                onClick={() => {
                  if (!isLast) {
                    setStep((x) => x + 1);
                    return;
                  }
                  dismiss();
                  onFinish?.();
                }}
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#1b1300",
                  background: ownerChrome
                    ? "linear-gradient(120deg, #ac8400, #d4af37 40%, #fdee79 60%, #d4af37 80%, #ac8400)"
                    : sectionColor,
                  backgroundSize: ownerChrome ? "200% auto" : undefined,
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 22px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  boxShadow: ownerChrome ? "0 8px 24px rgba(212, 175, 55, 0.28)" : undefined,
                  letterSpacing: ownerChrome ? "0.01em" : undefined,
                }}
              >
                {isLast
                  ? variant === "owner-empty"
                    ? "Bring in my figures"
                    : variant === "owner"
                      ? "Open my Action Plan"
                      : variant === "accountant-dashboard-empty"
                        ? "Got it — add my first client"
                        : variant === "accountant-client-empty"
                          ? "Got it — bring in the figures"
                          : "Done — let's go"
                  : ownerChrome
                    ? "Show me"
                    : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}
