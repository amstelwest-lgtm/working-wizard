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
const OWNER_CARD_APPROX_H = 400;
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
 * lines, cash, Claude’s next moves, and the Action Plan.
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
    title: "Claude ranked the next move for this business — not a generic list",
    why: "The top item is the highest-value hour you can spend this week.",
    body: "These steps are written for your live ratios, then scored three ways: Eisenhower (do it, decide it, or drop it), Cynefin (simple fix or a messy one?), and impact (which lever moves health the most). Start at the top. Send the one you’ll own into the Action Plan.",
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
    body: "Health, runway and status for every client — so you know who needs attention before they call. The Queries column is unresolved notes the owner pinned for you.",
  },
  {
    targetId: "wizard-dash-queries, wizard-practice-board",
    section: "Queries",
    title: "Notes waiting on you",
    body: "This column counts unresolved notes the owner pinned on their board. Open the client and pick them up from Open queries at the top of their workspace — reply on the same deliverable they marked.",
  },
  {
    targetId: ".ctable tbody tr, .client-card, [data-client-row]",
    section: "Clients",
    title: "Open a client workspace",
    body: "Click any row to enter their board — same health, cash, budget and plan the owner sees, ready for an advisory conversation.",
  },
  {
    targetId: "wizard-dash-reports",
    section: "Reports",
    title: "Reports you can charge for",
    body: "Reports studio is where branded PDFs live. Generate them from inside a client workspace once you have reviewed and signed off the figures behind them.",
  },
  {
    targetId: "wizard-add-client",
    section: "Grow the book",
    title: "Add the next client the same way",
    body: "Use Add client and upload ~3 months of banks. Milōn drafts Profit, Cash and Budget from that one upload; you review, sign off and deliver. That loop is the practice.",
  },
];

/**
 * Accountant, client has no figures yet: two honest steps pointing at the one
 * thing to do. The full studio tour (ACCOUNTANT_CLIENT_STEPS) runs the first
 * time this client has a real score.
 */
const ACCOUNTANT_CLIENT_EMPTY_STEPS: Step[] = [
  {
    tab: "ratios",
    targetId: ".health-orb",
    section: "Business Health",
    title: "This client's score lands here",
    body: "Nothing is invented in the studio. Once figures are in, Milōn scores profit, assets, financing and cash into one number — the same orb the owner sees — and this tour continues on the real thing.",
  },
  {
    tab: "ratios",
    targetId: "first-figures-card",
    section: "Figures",
    title: "Step 2 of 2 · Bring in the figures",
    body: "This is the only thing to do right now. One upload — bank statements or a P&L and balance sheet (PDF, Excel or CSV) — and Milōn drafts Profit, Cash Forecast and Budget from it. Each tab then waits for your review and sign-off before anything is branded or delivered.",
  },
];

const ACCOUNTANT_CLIENT_STEPS: Step[] = [
  {
    tab: "ask",
    targetId: "ask-ai-accountant",
    section: "Milōn Bot",
    title: "Start with Milōn Bot",
    body: "Now that this client has figures, the studio opens here. Ask against the drafted deliverables — ratios, waterfall, cash outlook, next moves, the action plan — or what’s outstanding on the brain. It can draft next steps or an advisory pack for you to review. It won’t invent figures or send email.",
  },
  {
    tab: "ask",
    targetId: "wizard-open-queries",
    section: "Queries",
    title: "Outstanding notes from the owner",
    body: "When the owner pins a note on their board, it lands here as an open query. Click to jump to the pin on the same deliverable they marked — Profit, Cash, Health and so on. The Queries column on your practice board counts what is still outstanding.",
  },
  {
    tab: "summary",
    targetId: "wizard-brain-hero, pane-summary",
    section: "Summary",
    title: "The client brain is the background file",
    body: "This tab is the collection of context around the client — profile, facts, uploads, drafts — so you and Milōn Bot can advise this business, not a generic SME. Empty blocks are waiting for a fact or an upload; they are not broken. Add a fact here. Agreed work the owner will chase lives on Action Plan.",
  },
  {
    tab: "ratios",
    targetId: "finCollapse",
    section: "Figures",
    title: "Figures live here",
    body: "Open this panel to correct a line, change the period, or upload a new statement. Every upload can refresh Profit, Cash and Budget — and anything you had signed off flips to Needs re-review until you look again.",
  },
  {
    tab: "ratios",
    targetId: ".health-orb",
    section: "Business Health",
    title: "Read the score with the owner",
    body: "Same orb the SME sees. Drill the pillars so you can explain what’s driving the number, then sign off Health here — your signature appears beside the orb on their board.",
  },
  {
    tab: "profit",
    targetId: "wizard-profit-walk",
    section: "Profit",
    title: "Profit is drafted — review it",
    body: "Milōn built this waterfall from the first upload. Check the lines, then sign off profitability with the gold button. Until you do, the owner sees a draft with no stamp.",
  },
  {
    tab: "cash",
    targetId: "wizard-cash-outlook, wizard-cash-table, wizard-cash-panel",
    section: "Cash Forecast",
    title: "13 weeks, forecast for you",
    body: "Closing balances and crunch weeks, drafted from the same upload. Review the assumptions, sign off, and align the owner on collections or spend timing before a shortfall hits.",
  },
  {
    tab: "budget",
    targetId: "wizard-budget-month-engine, wizard-budget-plan, wizard-budget-panel",
    section: "Budget",
    title: "Annual plan, seeded — needs your sign-off",
    body: "The budget was built from profile and figures at upload. Sign it off once it reads true. Cash timing, Budget vs actuals, and industry checks sit underneath — closed until you open them.",
  },
  {
    tab: "reports",
    targetId: "pane-reports",
    section: "Reports",
    title: "Deliver branded advice",
    body: "This is the same Reports Studio as the rest of the practice. Sign off Health, Profit, Cash or Budget first — each stamp carries into the board-ready PDF you generate here.",
  },
  {
    tab: "plan",
    targetId: "wizard-action-goal, wizard-action-list, wizard-action-plan, pane-plan",
    section: "Action Plan",
    title: "Leave with an owned plan",
    body: "Lock the outcome goal and the actions the SME will run. Same plan they see in their app — then move to the next client.",
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

/** Place the tour card fully outside the spotlight (never overlapping it). */
function cardLayoutForSpot(
  spot: Spot | null,
  cardH: number,
  premium = false,
): { top: number; maxHeight: number } {
  const vh = window.innerHeight;
  const ideal = premium
    ? Math.min(Math.max(cardH, 300), Math.min(vh * 0.82, 720))
    : Math.min(Math.max(cardH, 220), Math.min(vh * 0.68, 560));
  if (!spot) {
    return { top: Math.max(12, vh - ideal - 28), maxHeight: ideal };
  }

  const belowTop = spot.top + spot.height + CARD_GAP;
  const spaceBelow = Math.max(0, vh - belowTop - 12);
  const spaceAbove = Math.max(0, spot.top - CARD_GAP - 12);
  const targetInUpperHalf = spot.top + spot.height / 2 < vh * 0.5;
  const floor = premium ? 260 : 200;

  // Prefer below when the feature sits in the upper half (normal flow)
  if (targetInUpperHalf && spaceBelow >= (premium ? 220 : 160)) {
    return { top: belowTop, maxHeight: Math.min(ideal, Math.max(floor, spaceBelow)) };
  }
  if (spaceBelow >= Math.min(ideal, premium ? 280 : 220) || spaceBelow >= spaceAbove) {
    return { top: belowTop, maxHeight: Math.min(ideal, Math.max(floor, spaceBelow)) };
  }

  const maxHeight = Math.min(ideal, Math.max(floor, spaceAbove));
  const top = Math.max(12, spot.top - CARD_GAP - maxHeight);
  return { top, maxHeight };
}

function scrollTargetAwayFromCard(el: Element, cardH: number, reduceMotion = false) {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const room = Math.min(Math.max(cardH, 240) + CARD_GAP + 16, vh * 0.62);
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
      const cardH = cardRef.current?.offsetHeight || (ownerChrome ? OWNER_CARD_APPROX_H : CARD_APPROX_H);
      if (!el) {
        if (spotRef.current !== null) {
          spotRef.current = null;
          setSpot(null);
        }
        const pos = cardLayoutForSpot(null, cardH, ownerChrome);
        setCardTop((t) => (Math.abs(t - pos.top) < 1 ? t : pos.top));
        setCardMaxH((h) => (Math.abs(h - pos.maxHeight) < 1 ? h : pos.maxHeight));
        return;
      }
      const next = measureSpot(el);
      if (!spotsEqual(spotRef.current, next)) {
        spotRef.current = next;
        setSpot(next);
      }
      const pos = cardLayoutForSpot(next, cardH, ownerChrome);
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

      const cardH = cardRef.current?.offsetHeight || (ownerChrome ? OWNER_CARD_APPROX_H : CARD_APPROX_H);
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
        const cardH = cardRef.current?.offsetHeight || (ownerChrome ? OWNER_CARD_APPROX_H : CARD_APPROX_H);
        if (!el || !document.contains(el)) {
          if (spotRef.current !== null) {
            spotRef.current = null;
            setSpot(null);
          }
          const pos = cardLayoutForSpot(null, cardH, ownerChrome);
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
        const pos = cardLayoutForSpot(next, cardH, ownerChrome);
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
          width: ownerChrome ? "min(680px, calc(100vw - 20px))" : "min(560px, calc(100vw - 24px))",
          pointerEvents: "all",
          maxHeight: cardMaxH,
          overflowY: "auto",
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
            borderRadius: ownerChrome ? 20 : 16,
            padding: ownerChrome ? "26px 28px 22px" : "20px 24px 24px",
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
              marginBottom: ownerChrome ? 16 : 14,
              gap: 12,
            }}
          >
            <span
              style={{
                fontSize: ownerChrome ? 11 : 10,
                fontWeight: 700,
                letterSpacing: ownerChrome ? "0.16em" : "0.13em",
                textTransform: "uppercase",
                color: ownerChrome ? "#e5be72" : sectionColor,
                background: ownerChrome
                  ? "rgba(212, 165, 80, 0.12)"
                  : `rgba(${hexToRgb(sectionColor)}, 0.12)`,
                padding: ownerChrome ? "5px 12px" : "3px 10px",
                borderRadius: 999,
                border: ownerChrome ? "1px solid rgba(212, 165, 80, 0.22)" : "none",
              }}
            >
              {ownerChrome ? `Milōn · ${s.section ?? "Overview"}` : (s.section ?? "Overview")}
            </span>
            <span style={{ fontSize: ownerChrome ? 12 : 11, color: "#64748b", whiteSpace: "nowrap" }}>
              {step + 1} / {STEPS.length}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              gap: ownerChrome ? 4 : 3,
              marginBottom: ownerChrome ? 20 : 18,
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            {STEPS.map((_, i) => (
              <div
                key={i}
                style={{
                  height: ownerChrome ? 4 : 3,
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
              fontSize: ownerChrome ? 24 : 18,
              fontWeight: ownerChrome ? 500 : 700,
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
                fontSize: 15,
                fontWeight: 600,
                color: "#e5be72",
                lineHeight: 1.45,
                margin: "0 0 14px",
                fontFamily: "var(--font-display)",
              }}
            >
              {s.why}
            </p>
          )}

          <p
            style={{
              fontSize: ownerChrome ? 16.5 : 13.5,
              color: ownerChrome ? "#cbd5e1" : "#94a3b8",
              lineHeight: ownerChrome ? 1.62 : 1.65,
              marginBottom: ownerChrome ? 26 : 24,
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
                fontSize: ownerChrome ? 13 : 12,
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
                    fontSize: ownerChrome ? 14 : 13,
                    fontWeight: 600,
                    color: "#cbd5e1",
                    background: "#1e293b",
                    border: "1px solid #334155",
                    borderRadius: ownerChrome ? 10 : 8,
                    padding: ownerChrome ? "11px 18px" : "9px 18px",
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
                  fontSize: ownerChrome ? 14 : 13,
                  fontWeight: 700,
                  color: "#1b1300",
                  background: ownerChrome
                    ? "linear-gradient(120deg, #ac8400, #d4af37 40%, #fdee79 60%, #d4af37 80%, #ac8400)"
                    : sectionColor,
                  backgroundSize: ownerChrome ? "200% auto" : undefined,
                  border: "none",
                  borderRadius: ownerChrome ? 10 : 8,
                  padding: ownerChrome ? "11px 22px" : "9px 22px",
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
