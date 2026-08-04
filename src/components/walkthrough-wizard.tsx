import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "milon_walkthrough_v2"; // bumped so all users see the refreshed tour

type Step = {
  tab?: string;
  targetId: string | null;
  section?: string;
  title: string;
  body: string;
};

// ── Business-owner first-run tour (6 steps) ──────────────────────────────────
const OWNER_STEPS: Step[] = [
  {
    tab: "today",
    targetId: ".health-orb",
    section: "Overview",
    title: "This is your health score",
    body: "One number for your whole business, updated live from your figures. Higher is healthier. Everything else on this page explains what's behind it.",
  },
  {
    tab: "today",
    targetId: "wizard-today-metrics",
    section: "Overview",
    title: "Four things drive that score",
    body: "Profit, Assets, Financing and Cash. Tap any pillar to see exactly what's pushing it up or dragging it down — in plain English.",
  },
  {
    tab: "today",
    targetId: null,
    section: "Today",
    title: "Start simple",
    body: "Stay on Simplified for the big picture. Switch to Complex only when you want the full detail behind every ratio.",
  },
  {
    tab: "today",
    targetId: "wizard-today-nba",
    section: "Today",
    title: "Your priority this week",
    body: "We rank what to fix first for the biggest impact. Each week, start here — it's the fastest way to move your score.",
  },
  {
    tab: "today-complex",
    targetId: "wizard-ratio-inputs",
    section: "Overview · Complex",
    title: "Keep your figures current",
    body: "Enter your latest revenue, costs and balance sheet figures. Every ratio and benchmark recalculates instantly as you type. Update these whenever things change — the rest is automatic.",
  },
  {
    tab: "cash",
    targetId: "wizard-cash-table",
    section: "Cash",
    title: "See cash before it bites",
    body: "Your 13-week cash forecast shows the crunch weeks early — so you can act while there's still time. That's it, you're ready. Your accountant sees this view too.",
  },
];

// ── Accountant first-run tour (5 steps) ──────────────────────────────────────
const ACCOUNTANT_STEPS: Step[] = [
  {
    targetId: null,
    section: "Overview",
    title: "Your whole book, one view",
    body: "Every client's health score in a single dashboard, live. Sort by risk to see who needs you first — before they call in a panic.",
  },
  {
    targetId: ".client-card, .client-row",
    section: "Clients",
    title: "Open any client",
    body: "Tap a client to drop into their full dashboard: score, pillars, ratios and cash forecast — the same view they see, so you're always on the same page.",
  },
  {
    targetId: null,
    section: "Alerts",
    title: "Early-warning flags",
    body: "When a client's numbers move the wrong way, you get flagged here first. This is the advisory moment clients pay for.",
  },
  {
    targetId: null,
    section: "Reports",
    title: "Branded reports in a click",
    body: "Generate white-label reports with your practice's branding. Turn the analysis into a deliverable you can charge for.",
  },
  {
    targetId: null,
    section: "Advisory",
    title: "Advise in context",
    body: "Comment straight on a client's live figures — they're notified instantly. That's your recurring advisory layer, running. You're ready to go.",
  },
];

/** Resolves a step targetId to a DOM element. Supports CSS selectors and plain IDs. */
function resolveTarget(targetId: string): Element | null {
  if (/^[.#\[]/.test(targetId)) {
    // CSS selector — try first alternative if comma-separated
    const first = targetId.split(",")[0].trim();
    return document.querySelector(first);
  }
  return document.getElementById(targetId);
}

export function WalkthroughWizard({
  onTabChange,
  userRole,
}: {
  onTabChange?: (tab: string) => void;
  userRole?: string | null;
}) {
  const STEPS =
    userRole === "accountant" || userRole === "firm_admin"
      ? ACCOUNTANT_STEPS
      : OWNER_STEPS;

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const prevTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (!localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;

    const s = STEPS[step];

    // Remove highlight from previous target
    if (prevTargetRef.current && prevTargetRef.current !== s.targetId) {
      resolveTarget(prevTargetRef.current)?.classList.remove("wizard-highlight");
    }

    // Switch tab first (owner app only), then scroll after a short delay
    if (s.tab && onTabChange) onTabChange(s.tab);

    const timer = setTimeout(() => {
      if (!s.targetId) return;
      const el = resolveTarget(s.targetId);
      if (!el) return;
      el.classList.add("wizard-highlight");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      prevTargetRef.current = s.targetId;
    }, 280);

    return () => clearTimeout(timer);
  }, [step, visible, onTabChange, STEPS]);

  const dismiss = () => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, "1");
    }
    document.querySelectorAll(".wizard-highlight").forEach((el) =>
      el.classList.remove("wizard-highlight"),
    );
    setVisible(false);
  };

  if (!visible) return null;

  const s = STEPS[step];
  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  const SECTION_COLORS: Record<string, string> = {
    Today: "#c9962b",
    Overview: "#c9962b",
    Ratios: "#2563eb",
    Cash: "#0ea5e9",
    Moves: "#10b981",
    Tasks: "#8b5cf6",
    Clients: "#c9962b",
    Alerts: "#e25c5c",
    Reports: "#10b981",
    Advisory: "#8b5cf6",
  };
  const sectionColor = SECTION_COLORS[s.section ?? "Overview"] ?? "#c9962b";

  return (
    <>
      {/* Backdrop — dims everything, blocks accidental clicks */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 8000,
          background: "rgba(7, 9, 15, 0.68)",
          pointerEvents: "all",
        }}
      />

      {/* Wizard card */}
      <div
        style={{
          position: "fixed",
          bottom: 28,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 8002,
          width: "min(460px, calc(100vw - 32px))",
          pointerEvents: "all",
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
          {/* Section badge + counter */}
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

          {/* Progress bar */}
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
                  background:
                    i < step
                      ? sectionColor
                      : i === step
                        ? sectionColor
                        : "#1e293b",
                  opacity: i < step ? 0.45 : i === step ? 1 : 1,
                  transition: "background 250ms",
                }}
              />
            ))}
          </div>

          {/* Title */}
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

          {/* Body */}
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

          {/* Actions */}
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
                  onClick={() => setStep((s) => s - 1)}
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
                onClick={() => (isLast ? dismiss() : setStep((s) => s + 1))}
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
                  transition: "filter 150ms",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.filter =
                    "brightness(1.12)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLButtonElement).style.filter = "none")
                }
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

/** Convert #rrggbb to "r, g, b" for rgba() usage */
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}
