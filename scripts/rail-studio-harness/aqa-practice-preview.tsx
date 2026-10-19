/**
 * Fixture proof for the accountant practice findings. Not a client file.
 * `shot=before-*` rebuilds the reported screen. `shot=after-*` uses the
 * components that ship.
 */
import { useState } from "react";
import { AccountantNav, type NavSection } from "@/components/accountant-nav";
import { PracticeRail } from "@/components/practice-rail";
import { PortfolioHealthScatter } from "@/components/portfolio-health-scatter";
import { PageHeader } from "@/components/primitives/page-header";
import { noteShowsFloatingPin } from "@/lib/note-pin";

const SENTENCE =
  "Tracked asks. System rules open and close these on their own; anything you add by hand stays until you close it.";

const LONG_NAV: NavSection[] = [
  {
    id: "book",
    label: "Book",
    headings: [
      "Clients",
      "Health",
      "Cash flow",
      "Profit",
      "Budget",
      "Next moves",
      "Action plan",
      "Reports",
      "Books",
      "Practice",
      "Settings",
      "Team",
      "Inbox",
      "Billing",
      "Referrals",
      "Archive",
      "Tasks",
      "Notes",
    ].map((label, index) => ({
      id: `h${index}`,
      label,
      to: {
        to: "/aqa-practice-nav" as "/practice",
        search: () => ({ shot: "after-menu", closed: "1" }),
      },
      items: [
        {
          id: `${index}-a`,
          label: `${label} overview`,
          to: {
            to: "/aqa-practice-nav" as "/practice",
            search: () => ({ shot: "after-menu", closed: "1" }),
          },
        },
        {
          id: `${index}-b`,
          label: `${label} detail`,
          to: {
            to: "/aqa-practice-nav" as "/practice",
            search: () => ({ shot: "after-menu", closed: "1" }),
          },
        },
      ],
    })),
  },
];

function BeforeNav() {
  const items = [
    ["Needs attention", "/practice#needs-attention"],
    ["Follow up", "/practice#follow-up"],
    ["Insights", "/practice#portfolio-insights"],
    ["Marketplace", "/practice#marketplace"],
    ["Playbooks", "/practice#playbooks"],
    ["Open queries", "/clients#wizard-dash-queries"],
  ] as const;
  return (
    <div className="accountant-portal premium-shell" data-shot="before-nav">
      <main className="shell">
        <h1>Practice</h1>
        <p className="sub">One page. Every item is an anchor.</p>
        <ul>
          {items.map(([label, href]) => (
            <li key={href}>
              <a href={href}>{label}</a>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

function AfterNav() {
  return (
    <div className="accountant-portal premium-shell" data-shot="after-nav">
      <div className="client-workspace">
        <PracticeRail />
        <main className="deliverable-main">
          <PageHeader eyebrow="Practice" title="Insights" subtitle="Health score against the stored 30-day trend." />
        </main>
      </div>
    </div>
  );
}

function BeforeChart() {
  return (
    <div className="accountant-portal premium-shell" data-shot="before-chart">
      <main className="shell">
        <div className="ph-scatter" style={{ minHeight: 0 }}>
          <div className="ph-scatter-head">
            <div className="ph-kicker">Portfolio health</div>
            <div className="ph-sub">Health score vs trend</div>
          </div>
          <div className="ph-scatter-chart" style={{ height: 0, minHeight: 0 }} />
        </div>
      </main>
    </div>
  );
}

function AfterChart({ points }: { points: boolean }) {
  return (
    <div className="accountant-portal premium-shell" data-shot={points ? "after-chart" : "after-chart-empty"}>
      <main className="shell">
        <PageHeader eyebrow="Practice" title="Insights" subtitle="Fixture points are labelled. An empty book stays empty." />
        <PortfolioHealthScatter
          clients={
            points
              ? [
                  {
                    id: "harbour",
                    name: "Harbour Glass",
                    score: 72,
                    trendDelta: 6,
                    revenue: 120000,
                    status: "healthy",
                  },
                  {
                    id: "karoo",
                    name: "Karoo Traders",
                    score: 41,
                    trendDelta: -8,
                    revenue: 80000,
                    status: "at_risk",
                  },
                ]
              : []
          }
          onSelect={() => {}}
        />
        {points ? <p className="sub">Fixture scores, not a client file.</p> : null}
      </main>
    </div>
  );
}

function HealthCopy({ stray }: { stray: boolean }) {
  const showPin = stray || noteShowsFloatingPin({ x: 0, y: 0, ratioKey: null });
  return (
    <div className="accountant-portal premium-shell" data-shot={stray ? "before-health" : "after-health"}>
      <main className="shell" style={{ position: "relative", maxWidth: 640, paddingTop: 48 }}>
        <h1>Health</h1>
        <p data-hand-copy="true" style={{ position: "relative", maxWidth: "62ch" }}>
          {SENTENCE}
          {showPin ? (
            <span
              data-stray-pin="T"
              style={{
                position: "absolute",
                left: 210,
                top: 18,
                width: 28,
                height: 28,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                background: "#1a2540",
                color: "#0B5FFF",
                border: "2px solid #0B5FFF",
                fontSize: 10,
                fontWeight: 800,
              }}
            >
              T
            </span>
          ) : null}
        </p>
      </main>
    </div>
  );
}

function MenuShot({ fixed, closed = false }: { fixed: boolean; closed?: boolean }) {
  const [open, setOpen] = useState(!closed);
  return (
    <div
      className={`accountant-portal premium-shell${open ? " nav-open" : ""}`}
      data-shot={fixed ? "after-menu" : "before-menu"}
      data-menu-open={open ? "true" : "false"}
    >
      <div className="shell">
        <div className="topbar">
          <span className="brand">
            <span className="gold-text">MILŌN</span>
          </span>
          <button type="button" className="topbar-menu-btn" onClick={() => setOpen(true)}>
            Open menu
          </button>
        </div>
        {fixed ? (
          <AccountantNav
            label="Practice"
            sections={LONG_NAV}
            selection={{ headingId: "h1", subId: null }}
            storageKey="aqa-practice-nav-preview"
            onNavigate={() => setOpen(false)}
          />
        ) : (
          <nav
            className="deliverable-rail"
            aria-label="Practice"
            style={{ overflow: "hidden", height: 280, maxHeight: 280 }}
            onWheel={(event) => event.preventDefault()}
          >
            {LONG_NAV[0]?.headings.map((heading) => (
              <a key={heading.id} href="#practice">
                {heading.label}
              </a>
            ))}
          </nav>
        )}
        <main className="deliverable-main">
          <h1>Health</h1>
          <p>{open ? "Menu is open." : "Menu closed after navigation."}</p>
        </main>
      </div>
    </div>
  );
}

export function AqaPracticePreview({ shot, closed = false }: { shot: string; closed?: boolean }) {
  if (shot === "before-nav") return <BeforeNav />;
  if (shot === "after-nav") return <AfterNav />;
  if (shot === "before-chart") return <BeforeChart />;
  if (shot === "after-chart") return <AfterChart points />;
  if (shot === "after-chart-empty") return <AfterChart points={false} />;
  if (shot === "before-health") return <HealthCopy stray />;
  if (shot === "after-health") return <HealthCopy stray={false} />;
  if (shot === "before-menu") return <MenuShot fixed={false} />;
  return <MenuShot fixed closed={closed} />;
}
