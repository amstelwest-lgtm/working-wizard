import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ACCOUNTANT_CLIENT_TOUR_KEY,
  ACCOUNTANT_DASH_TOUR_KEY,
  OWNER_TOUR_KEY,
  markOnboardingDone,
  onboardingDone,
} from "@/lib/onboarding";

export type WalkthroughVariant = "owner" | "accountant-dashboard" | "accountant-client";

type Step = {
  tab?: string;
  targetId: string | null;
  section?: string;
  title: string;
  body: string;
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

/** Owner: profile+banks happen before this tour; here we walk the product once. */
const OWNER_STEPS: Step[] = [
  {
    tab: "today",
    targetId: ".health-orb",
    section: "Business Health",
    title: "Your health score in one glance",
    body: "This single number summarises profit, assets, financing and cash. Higher is healthier. Everything below explains what is driving it.",
  },
  {
    tab: "today",
    targetId: "ask-ai-overview",
    section: "Ask AI",
    title: "Ask anything about these numbers",
    body: "Type a plain-English question — cash squeeze, margin drop, what to fix first. Answers stay grounded in this client's figures.",
  },
  {
    tab: "waterfall",
    targetId: "wizard-profit-walk",
    section: "Profit",
    title: "See where profit is made or lost",
    body: "This waterfall is the profit walk — revenue down to net profit, step by step. Use it when you need to explain a margin miss to yourself or your accountant.",
  },
  {
    tab: "cash",
    targetId: "wizard-cash-outlook, wizard-cash-table, wizard-cash-panel",
    section: "Cash Forecast",
    title: "See cash 13 weeks ahead",
    body: "Cash Outlook shows your closing balance trajectory and flags tight weeks early. Bank statements can draft this — update it whenever timing changes.",
  },
  {
    tab: "budget",
    targetId: "wizard-budget-panel",
    section: "Budget",
    title: "Plan the year, then compare actuals",
    body: "Your budget is pre-filled from your profile and figures. Each month you can upload a P&L and see Budget vs Actual variance automatically.",
  },
  {
    tab: "next",
    targetId: "wizard-moves-list",
    section: "Next moves",
    title: "Ranked moves, not a to-do dump",
    body: "We surface the highest-impact actions from your live ratios. Start at the top — that is usually the fastest way to lift the score.",
  },
  {
    tab: "tasks",
    targetId: "wizard-tasks-panel",
    section: "Action Plan",
    title: "Turn advice into an action plan",
    body: "Assign owners, track progress, and keep one shared plan with your accountant. You are ready — explore freely, or re-open any tab anytime.",
  },
];

const ACCOUNTANT_DASH_STEPS: Step[] = [
  {
    targetId: "wizard-practice-board",
    section: "Practice",
    title: "Your whole book, one screen",
    body: "Every client's health score in one place. Sort by who needs attention first — before they call in a panic.",
  },
  {
    targetId: ".ctable tbody tr, .client-card, [data-client-row]",
    section: "Clients",
    title: "Open a client workspace",
    body: "Click a client to enter their operating board: health, cash, budget, reports and action plan — the same truth the owner sees.",
  },
  {
    targetId: "wizard-dash-reports",
    section: "Reports",
    title: "Deliverables you can charge for",
    body: "From a client workspace, generate branded advisory PDFs in a few clicks. That is your recurring advisory layer.",
  },
  {
    targetId: "wizard-add-client",
    section: "First client",
    title: "Add the next client the same way",
    body: "Use Add client for each new SME, upload their bank statements, then walk Health → Cash → Budget → Reports → Action Plan once.",
  },
];

const ACCOUNTANT_CLIENT_STEPS: Step[] = [
  {
    tab: "ratios",
    targetId: "finCollapse",
    section: "Upload",
    title: "Bank statements first",
    body: "Upload ~3 months of bank statements (or a P&L PDF) so health, budget and cash have real figures. Use “Draft from banks” on Health & Ratios.",
  },
  {
    tab: "ratios",
    targetId: ".health-orb",
    section: "Business Health",
    title: "Read the health score with the owner",
    body: "Same orb the SME sees. Drill pillars to explain what is driving the score before you prescribe fixes.",
  },
  {
    tab: "ratios",
    targetId: "ask-ai-accountant",
    section: "Ask AI",
    title: "Ask against live client numbers",
    body: "Plain-English questions stay grounded in this client's figures — useful in prep calls and review meetings.",
  },
  {
    tab: "profit",
    targetId: "wizard-profit-walk",
    section: "Profit",
    title: "Show the profit walk",
    body: "This waterfall is the profit walk — how revenue becomes net profit. Use it when margins slip or the owner asks where money went.",
  },
  {
    tab: "cash",
    targetId: "wizard-cash-outlook, wizard-cash-table, wizard-cash-panel",
    section: "Cash Forecast",
    title: "13-week cash is your signature view",
    body: "Cash Outlook shows closing balances and crunch weeks early. Bank statements can draft this forecast — align the owner on collections or spend timing.",
  },
  {
    tab: "budget",
    targetId: "wizard-budget-panel",
    section: "Budget",
    title: "Budget pre-filled from figures",
    body: "After a bank draft we seed the annual budget. Compare Budget vs Actual each month when management accounts land.",
  },
  {
    tab: "reports",
    targetId: "pane-reports",
    section: "Reports",
    title: "Board-ready deliverables",
    body: "Generate branded advisory PDFs from this workspace — the product your practice can charge for repeatedly.",
  },
  {
    tab: "plan",
    targetId: "pane-plan",
    section: "Action Plan",
    title: "Lock an action plan together",
    body: "Turn ranked moves into an owned plan the SME can follow. Then add your next real client the same way.",
  },
];

function stepsFor(variant: WalkthroughVariant): Step[] {
  if (variant === "accountant-dashboard") return ACCOUNTANT_DASH_STEPS;
  if (variant === "accountant-client") return ACCOUNTANT_CLIENT_STEPS;
  return OWNER_STEPS;
}

function storageKeyFor(variant: WalkthroughVariant): string {
  if (variant === "accountant-dashboard") return ACCOUNTANT_DASH_TOUR_KEY;
  if (variant === "accountant-client") return ACCOUNTANT_CLIENT_TOUR_KEY;
  return OWNER_TOUR_KEY;
}

function resolveTarget(targetId: string): Element | null {
  const parts = targetId.split(",").map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const el = /^[.#\[]/.test(part)
      ? document.querySelector(part)
      : document.getElementById(part);
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
  if (Math.abs(width - height) < 8 && (px >= Math.min(width, height) / 2 - 1 || el.classList.contains("rounded-full"))) {
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

  const maxH = Math.min(vh * 0.48, 420);
  if (height > maxH) {
    height = maxH;
    spotTop = Math.max(10, Math.min(spotTop, vh - maxH - 10));
  }
  const maxW = Math.min(vw * 0.94, vw - 20);
  if (width > maxW) {
    width = maxW;
    spotLeft = Math.max(10, (vw - maxW) / 2);
  }

  return {
    top: spotTop,
    left: spotLeft,
    width,
    height,
    radius: readRadius(el, r.width, r.height, pad),
  };
}

/** Place the tour card fully outside the spotlight (never overlapping it). */
function cardLayoutForSpot(
  spot: Spot | null,
  cardH: number,
): { top: number; maxHeight: number } {
  const vh = window.innerHeight;
  const ideal = Math.min(Math.max(cardH, 180), Math.min(vh * 0.52, 420));
  if (!spot) {
    return { top: Math.max(12, vh - ideal - 28), maxHeight: ideal };
  }

  const belowTop = spot.top + spot.height + CARD_GAP;
  const spaceBelow = Math.max(0, vh - belowTop - 12);
  const spaceAbove = Math.max(0, spot.top - CARD_GAP - 12);

  // Prefer below when the card fits (or when below has more room)
  if (spaceBelow >= Math.min(ideal, 200) || spaceBelow >= spaceAbove) {
    const maxHeight = Math.min(ideal, Math.max(140, spaceBelow));
    return { top: belowTop, maxHeight };
  }

  const maxHeight = Math.min(ideal, Math.max(140, spaceAbove));
  const top = Math.max(12, spot.top - CARD_GAP - maxHeight);
  return { top, maxHeight };
}

function scrollTargetAwayFromCard(el: Element, cardH: number) {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const room = Math.min(cardH + CARD_GAP + 24, vh * 0.42);
  // Leave room below the target for the card
  const desiredCenter = Math.min(vh * 0.36, vh - room - r.height / 2);
  const currentCenter = r.top + r.height / 2;
  const delta = currentCenter - desiredCenter;
  if (Math.abs(delta) > 24) {
    window.scrollBy({ top: delta, behavior: "smooth" });
  }
}

export function WalkthroughWizard({
  onTabChange,
  userRole,
  variant: variantProp,
  ready = true,
  onComplete,
}: {
  onTabChange?: (tab: string) => void;
  userRole?: string | null;
  /** Explicit tour; otherwise inferred from role. */
  variant?: WalkthroughVariant;
  /** When false, tour stays hidden (e.g. until profile + first data finish). */
  ready?: boolean;
  onComplete?: () => void;
}) {
  const variant: WalkthroughVariant =
    variantProp ??
    (userRole === "accountant" || userRole === "firm_admin"
      ? "accountant-dashboard"
      : "owner");

  const STEPS = stepsFor(variant);
  const storageKey = storageKeyFor(variant);

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [cardTop, setCardTop] = useState(28);
  const [cardMaxH, setCardMaxH] = useState(420);
  const prevTargetRef = useRef<string | null>(null);
  const activeElRef = useRef<Element | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

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

    if (prevTargetRef.current && prevTargetRef.current !== s.targetId) {
      resolveTarget(prevTargetRef.current)?.classList.remove("wizard-highlight");
    }

    if (s.tab && onTabChange) onTabChange(s.tab);

    let cancelled = false;
    let tries = 0;

    const layout = (el: Element | null) => {
      if (cancelled) return;
      const cardH = cardRef.current?.offsetHeight || CARD_APPROX_H;
      if (!el) {
        setSpot(null);
        const pos = cardLayoutForSpot(null, cardH);
        setCardTop(pos.top);
        setCardMaxH(pos.maxHeight);
        return;
      }
      const next = measureSpot(el);
      setSpot(next);
      const pos = cardLayoutForSpot(next, cardH);
      setCardTop(pos.top);
      setCardMaxH(pos.maxHeight);
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
        // Tab content may still be mounting — retry briefly
        if (tries++ < 25) {
          window.setTimeout(apply, 100);
        } else {
          activeElRef.current = null;
          layout(null);
        }
        return;
      }

      el.classList.add("wizard-highlight");
      activeElRef.current = el;
      prevTargetRef.current = s.targetId;

      const cardH = cardRef.current?.offsetHeight || CARD_APPROX_H;
      scrollTargetAwayFromCard(el, cardH);

      // Remeasure after scroll settles so the hole + card clear each other
      const paint = () => {
        if (cancelled || activeElRef.current !== el) return;
        layout(el);
      };

      requestAnimationFrame(() => {
        paint();
        window.setTimeout(paint, 320);
        window.setTimeout(paint, 560);
      });
    };

    const timer = window.setTimeout(apply, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, visible, onTabChange, STEPS]);

  // Keep spotlight glued to the target on scroll/resize; re-clear the card
  useLayoutEffect(() => {
    if (!visible) return;

    const refresh = () => {
      const el = activeElRef.current;
      const cardH = cardRef.current?.offsetHeight || CARD_APPROX_H;
      if (!el || !document.contains(el)) {
        setSpot(null);
        const pos = cardLayoutForSpot(null, cardH);
        setCardTop(pos.top);
        setCardMaxH(pos.maxHeight);
        return;
      }
      const next = measureSpot(el);
      setSpot(next);
      const pos = cardLayoutForSpot(next, cardH);
      setCardTop(pos.top);
      setCardMaxH(pos.maxHeight);
    };

    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [visible, step]);

  const dismiss = () => {
    markOnboardingDone(storageKey);
    document.querySelectorAll(".wizard-highlight").forEach((el) =>
      el.classList.remove("wizard-highlight"),
    );
    activeElRef.current = null;
    setSpot(null);
    setVisible(false);
    onComplete?.();
  };

  if (!visible || !ready) return null;

  const s = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  const SECTION_COLORS: Record<string, string> = {
    "Business Health": "#c9962b",
    "Ask AI": "#8b5cf6",
    Profit: "#2563eb",
    "Cash Forecast": "#0ea5e9",
    Budget: "#d4a550",
    "Next moves": "#10b981",
    "Action Plan": "#8b5cf6",
    Practice: "#c9962b",
    "First client": "#c9962b",
    Clients: "#c9962b",
    Reports: "#10b981",
    Workspace: "#c9962b",
    Upload: "#0ea5e9",
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
            transition:
              "top 220ms ease, left 220ms ease, width 220ms ease, height 220ms ease, border-radius 220ms ease",
          }}
        />
      )}

      <div
        ref={cardRef}
        style={{
          position: "fixed",
          left: "50%",
          transform: "translateX(-50%)",
          top: cardTop,
          bottom: "auto",
          zIndex: 8002,
          width: "min(460px, calc(100vw - 32px))",
          pointerEvents: "all",
          maxHeight: cardMaxH,
          overflowY: "auto",
          transition: "top 220ms ease, max-height 220ms ease",
        }}
      >
        <div
          style={{
            background: "#0d1525",
            border: `1px solid rgba(${hexToRgb(sectionColor)}, 0.35)`,
            borderRadius: 16,
            padding: "20px 24px 24px",
            boxShadow:
              "0 32px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.13em",
                textTransform: "uppercase",
                color: sectionColor,
                background: `rgba(${hexToRgb(sectionColor)}, 0.12)`,
                padding: "3px 10px",
                borderRadius: 6,
              }}
            >
              {s.section ?? "Overview"}
            </span>
            <span style={{ fontSize: 11, color: "#475569" }}>
              {step + 1} / {STEPS.length}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              gap: 3,
              marginBottom: 18,
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
                  background: i <= step ? sectionColor : "#1e293b",
                  opacity: i < step ? 0.45 : 1,
                  transition: "background 250ms",
                }}
              />
            ))}
          </div>

          <h3
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "#f1f5f9",
              marginBottom: 10,
              lineHeight: 1.3,
              fontFamily: "var(--font-display)",
            }}
          >
            {s.title}
          </h3>

          <p
            style={{
              fontSize: 13.5,
              color: "#94a3b8",
              lineHeight: 1.65,
              marginBottom: 24,
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
                color: "#475569",
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
                    color: "#94a3b8",
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
                onClick={() => (isLast ? dismiss() : setStep((x) => x + 1))}
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#07090f",
                  background: sectionColor,
                  border: "none",
                  borderRadius: 8,
                  padding: "9px 22px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {isLast ? "Done — let's go" : "Next"}
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
