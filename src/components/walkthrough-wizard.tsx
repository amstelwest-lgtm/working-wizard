import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "milon_walkthrough_v1";

type Step = {
  tab: string;
  targetId: string | null;
  section: string;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  // ── Today (3) ─────────────────────────────────────────────────────────────
  {
    tab: "today",
    targetId: "wizard-today-metrics",
    section: "Today",
    title: "Your three vital signs",
    body: "Every time you open Milōn you see cash runway, operating margin, and debtor days at a glance. These three numbers tell you whether the business is healthy right now — no digging required.",
  },
  {
    tab: "today",
    targetId: "wizard-today-nba",
    section: "Today",
    title: "Your highest-impact move, right now",
    body: "Milōn scores every possible action against your numbers and surfaces the one that will move the needle most for your business type today. Tap it to see the full step-by-step playbook.",
  },
  {
    tab: "today",
    targetId: "wizard-today-alerts",
    section: "Today",
    title: "Alerts before they become crises",
    body: "This section flags risks automatically — low runway, margin pressure, slow-paying customers. Green means all clear; amber and red need your attention. Check it each morning.",
  },
  // ── Ratios (3) ────────────────────────────────────────────────────────────
  {
    tab: "dashboard",
    targetId: "wizard-ratio-inputs",
    section: "Ratios",
    title: "Enter your numbers once",
    body: "Type in your latest revenue, costs, and balance sheet figures here. Milōn recalculates every ratio and benchmark instantly as you type. Update these when figures change — everything else is automatic.",
  },
  {
    tab: "dashboard",
    targetId: "wizard-ratio-hero",
    section: "Ratios",
    title: "The two numbers that matter most",
    body: "Shareholder Return shows how hard your equity is working for you. Working Capital Cycle shows how many days cash is trapped in operations — the lower the better. These are your headline KPIs.",
  },
  {
    tab: "dashboard",
    targetId: "wizard-ratio-profit",
    section: "Ratios",
    title: "Profit drivers — tap any tile",
    body: "These five ratios decompose your return on equity into its root causes. Each one is benchmarked against your industry. Tap any tile to see why it matters and get five specific moves to improve it.",
  },
  // ── Cash (3) ──────────────────────────────────────────────────────────────
  {
    tab: "cash",
    targetId: "wizard-cash-setup",
    section: "Cash",
    title: "Set up your 13-week forecast",
    body: "Enter your opening bank balance and add every recurring income and expense as a line item. Milōn maps exactly when cash arrives and leaves, week by week, for the next 13 weeks.",
  },
  {
    tab: "cash",
    targetId: "wizard-cash-table",
    section: "Cash",
    title: "Week-by-week cash position",
    body: "This table shows every inflow, outflow, net cash, and closing balance for the next quarter. A red closing balance means a shortfall — you now have weeks of lead time to act before it hits.",
  },
  {
    tab: "cash",
    targetId: "wizard-cash-scenario",
    section: "Cash",
    title: "Stress-test with scenario sliders",
    body: "Drag Revenue down to 80% and watch the forecast repaint in real time. Model a big expense, a late-paying customer, or a new hire — see exactly when and if cash runs out before it happens.",
  },
  // ── Moves (2) + Tasks (1) ─────────────────────────────────────────────────
  {
    tab: "next",
    targetId: "wizard-moves-list",
    section: "Moves",
    title: "Every move ranked by financial leverage",
    body: "These strategic actions are scored and sorted by how much they will shift your key ratios. The ones at the top give you the most return for your effort given your specific business model.",
  },
  {
    tab: "next",
    targetId: "wizard-moves-list",
    section: "Moves",
    title: "Tap any move for the full playbook",
    body: "Each move opens a detailed checklist with the financial logic, a benchmark showing where you should be, and concrete action steps. No guesswork — just a clear, prioritised plan.",
  },
  {
    tab: "tasks",
    targetId: "wizard-tasks-panel",
    section: "Tasks",
    title: "Convert moves into tracked tasks",
    body: "Assign any action to a team member with a due date. Your accountant can see progress in real time from their portal. Nothing falls through the cracks — every decision has an owner.",
  },
];

export function WalkthroughWizard({
  onTabChange,
}: {
  onTabChange: (tab: string) => void;
}) {
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
      document.getElementById(prevTargetRef.current)?.classList.remove("wizard-highlight");
    }

    // Switch tab first, then scroll after a short delay
    onTabChange(s.tab);

    const timer = setTimeout(() => {
      if (!s.targetId) return;
      const el = document.getElementById(s.targetId);
      if (!el) return;
      el.classList.add("wizard-highlight");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      prevTargetRef.current = s.targetId;
    }, 280);

    return () => clearTimeout(timer);
  }, [step, visible, onTabChange]);

  const dismiss = () => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, "1");
    }
    // Remove any lingering highlights
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
    Ratios: "#2563eb",
    Cash: "#0ea5e9",
    Moves: "#10b981",
    Tasks: "#8b5cf6",
  };
  const sectionColor = SECTION_COLORS[s.section] ?? "#c9962b";

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
              {s.section}
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
