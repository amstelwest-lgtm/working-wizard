/**
 * Presentational owner door for local screenshots. Fixture figures stay in this
 * file. Production /app never imports it.
 */
import { useEffect, useState } from "react";
import ActionPlanPanel from "@/components/action-plan";
import { BudgetPanel } from "@/components/budget/budget-panel";
import { CashForecastPanel } from "@/components/cash-forecast";
import { OwnerAvatar } from "@/components/owner-door/owner-avatar";
import { OwnerChat } from "@/components/owner-door/owner-chat";
import { OwnerHome } from "@/components/owner-door/owner-home";
import { ProfitabilityWaterfall } from "@/components/profitability-waterfall";
import { SphereHero, type SpherePillar } from "@/components/sphere-hero";
import {
  OwnerAccountant,
  OwnerDeliverables,
  OwnerFirst,
  OwnerPlan,
} from "@/components/owner-door/owner-pages";
import { OwnerShell } from "@/components/owner-door/owner-shell";
import { agentShortName } from "@/lib/milon-team";
import { AGENT_KEYS } from "@/lib/milon-team-feed";
import { emptyAgentActivity } from "@/lib/milon-team-activity";
import { ownerAnswerTiles } from "@/lib/owner-answers";
import { ownerPresence, type OwnerMotion } from "@/lib/owner-presence";

const USD = { currency: "USD" as const, locale: "en-US" as const };

const TILES = ownerAnswerTiles({
  hasBooks: true,
  ledger: "QuickBooks",
  revenue: 120000,
  priorRevenue: 100000,
  cogs: 48000,
  priorCogs: 40000,
  receivables: 18000,
  cashflow: {
    openingBalance: "80000",
    revenue: [{ amount: "5000", frequency: "recurring-weekly", startWeek: 1 }],
    expenses: [{ amount: "3000", frequency: "recurring-weekly", startWeek: 1 }],
  },
  openAction: "Approve the payroll run.",
  actionsReady: true,
  signedBy: "Alex Morgan",
  signedOn: "2 Oct 2026",
  market: USD,
});

const PILLARS: SpherePillar[] = [
  {
    id: "profit",
    label: "Profit",
    health: 72,
    blurb: "Margin is holding.",
    drivers: [{ key: "grossMargin", label: "Gross margin", health: 74 }],
  },
  {
    id: "assets",
    label: "Assets",
    health: 61,
    blurb: "Assets are working.",
    drivers: [{ key: "roa", label: "Return on assets", health: 61 }],
  },
  {
    id: "financing",
    label: "Financing",
    health: 68,
    blurb: "Debt is light.",
    drivers: [{ key: "debtToEquity", label: "Debt to equity", health: 68 }],
  },
  {
    id: "cash",
    label: "Cash",
    health: 54,
    blurb: "Collections are the lever.",
    drivers: [{ key: "debtorDays", label: "Debtor days", health: 48 }],
  },
];

function HealthOrb({ compact = false, onOpen }: { compact?: boolean; onOpen?: () => void }) {
  return (
    <div className="owner-health-hero">
      <SphereHero
        compact={compact}
        overallHealth={64}
        displayStatus="at_risk"
        pillars={PILLARS}
        caption={compact ? "Tap to see what's behind your score" : "Collections are the lever."}
        onOrbOpen={onOpen}
      />
    </div>
  );
}

export type OwnerPreviewView =
  | "rest"
  | "work"
  | "chat"
  | "recording"
  | "ask"
  | "reel"
  | "actions"
  | "accountant"
  | "deliverables"
  | "plan"
  | "first"
  | "health"
  | "cash"
  | "budget"
  | "tasks"
  | "profit"
  | "moves";

export function OwnerDoorPreview({ view }: { view: OwnerPreviewView }) {
  const [motion, setMotion] = useState<OwnerMotion>("idle");
  const [done, setDone] = useState(false);
  const [openedHealth, setOpenedHealth] = useState(false);

  useEffect(() => {
    if (view !== "reel") return;
    setMotion("idle");
    setDone(false);
    const timers = [
      window.setTimeout(() => setMotion("working"), 1400),
      window.setTimeout(() => setMotion("idle"), 4000),
      window.setTimeout(() => setDone(true), 5600),
    ];
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [view]);

  const presence = ownerPresence(emptyAgentActivity());
  const shown =
    view === "work"
      ? {
          ...presence,
          agents: presence.agents.map((agent) => ({
            ...agent,
            motion: "working" as const,
            sentence: "Working…",
          })),
        }
      : view === "reel"
        ? {
            ...presence,
            agents: presence.agents.map((agent) => ({
              ...agent,
              motion,
              sentence: motion === "working" ? "Working…" : "Nothing new from the books.",
            })),
          }
        : presence;

  const chatAgent = shown.agents.find((agent) => agent.agent === "analyst") ?? shown.agents[0];
  const homeView = view === "rest" || view === "work" || view === "ask";

  return (
    <OwnerShell
      screen={
        homeView && openedHealth
          ? "health"
          : view === "chat" || view === "recording"
          ? "chat"
          : view === "tasks" || view === "actions" || view === "moves"
            ? "moves"
            : view === "accountant" ||
                view === "deliverables" ||
                view === "plan" ||
                view === "health" ||
                view === "cash" ||
                view === "budget" ||
                view === "profit"
              ? view
              : "home"
      }
      businessName="Northline Studio"
      initials="NS"
      workspaces={[{ clientId: "preview", name: "Northline Studio" }]}
      activeClientId="preview"
      onSwitch={() => undefined}
      onNavigate={() => undefined}
      onSignOut={() => undefined}
      onSettings={() => undefined}
      onProfile={() => undefined}
    >
      {view === "reel" ? (
        <div className="owner-pane" data-owner-reel={done ? "done" : "play"} data-motion={motion}>
          <h1 className="owner-title">Rest, then back to work</h1>
          {(["orb", "character"] as const).map((variant) => (
            <div key={variant}>
              <p className="owner-lede">{variant === "orb" ? "Orb" : "Character"}</p>
              <div className="owner-agents">
                {AGENT_KEYS.map((agent) => (
                  <div key={agent} className="owner-agent">
                    <OwnerAvatar
                      agent={agent}
                      variant={variant}
                      size="lg"
                      motion={motion}
                      label={agentShortName(agent)}
                    />
                    <span className="owner-name">{agentShortName(agent)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {view === "health" || (homeView && openedHealth) ? (
        <section className="owner-pane" data-owner-page="health">
          <h1 className="owner-title">Business Health</h1>
          <HealthOrb />
        </section>
      ) : null}
      {view === "cash" ? (
        <section className="owner-pane" data-owner-page="cash">
          <CashForecastPanel
            clientId="harness-client"
            clientName="Northline Studio"
            simplified
            canSign={false}
            hideReadOnlyStamp
            readOnly
            onInvite={() => undefined}
          />
        </section>
      ) : null}
      {view === "budget" ? (
        <section className="owner-pane" data-owner-page="budget">
          <BudgetPanel
            clientId="harness-client"
            clientName="Northline Studio"
            simplified
            role="owner"
            canSign={false}
            hideReadOnlyStamp
            readOnly
            onInvite={() => undefined}
            priorYear={{
              revenue: 980000,
              cogs: 390000,
              grossProfit: 590000,
              netProfit: 120000,
              expenses: 470000,
            }}
            priorYearLabel="2025"
          />
        </section>
      ) : null}
      {view === "profit" ? (
        <section className="owner-pane" data-owner-page="profit">
          <h1 className="owner-title">Profit</h1>
          <ProfitabilityWaterfall clientId="harness-client" clientName="Northline Studio" periodLabel="September 2026" />
        </section>
      ) : null}
      {view === "moves" || view === "tasks" || view === "actions" ? (
        <section className="owner-pane" data-owner-page="moves">
          <h1 className="owner-title">Next moves</h1>
          <ActionPlanPanel
            clientId="harness-client"
            clientName="Northline Studio"
            simplified
            isOwner
            ownerView
            moves={[
              {
                key: "debtorDays",
                title: "Collect the two largest invoices",
                ratioName: "Debtor days",
                impactLine: "Cash arrives sooner.",
                health: 48,
              },
            ]}
          />
        </section>
      ) : null}
      {(view === "chat" || view === "recording") && chatAgent ? (
        <OwnerChat
          agent={chatAgent.agent}
          variant="character"
          motion="idle"
          sentence={chatAgent.sentence}
          messages={[
            { role: "owner", text: "What should I look at first?" },
            {
              role: "agent",
              text: "Connect QuickBooks or Xero, then I can read the 13-week line.",
            },
          ]}
          draft=""
          listening={view === "recording"}
          busy={false}
          error={null}
          onDraft={() => undefined}
          onSend={() => undefined}
          onListen={() => undefined}
          onBack={() => undefined}
        />
      ) : null}
      {view === "accountant" ? (
        <OwnerAccountant
          joined={false}
          firmName={null}
          invite={<p className="owner-lede">Invite form</p>}
          uploads={<p className="owner-lede">No files uploaded yet.</p>}
          onConnect={() => undefined}
        />
      ) : null}
      {view === "deliverables" ? (
        <OwnerDeliverables
          rows={[{ id: "s1", scope: "cash_forecast", name: "Alex Morgan", when: "2 Oct 2026" }]}
          onInvite={() => undefined}
        />
      ) : null}
      {view === "plan" ? <OwnerPlan visitor="us" accountantOnMilon={false} firmName={null} /> : null}
      {view === "first" ? (
        <OwnerFirst joined={false} onQuickBooks={() => undefined} onXero={() => undefined} onInvite={() => undefined} />
      ) : null}
      {homeView && !openedHealth ? (
        <OwnerHome
          variant="character"
          presence={shown}
          tiles={TILES}
          onOpen={() => undefined}
          onAsk={() => undefined}
          onTile={() => undefined}
          hero={<HealthOrb compact onOpen={() => setOpenedHealth(true)} />}
        />
      ) : null}
    </OwnerShell>
  );
}
