/**
 * Presentational owner door for local screenshots. Fixture figures stay in this
 * file. Production /app never imports it.
 */
import { useEffect, useRef, useState } from "react";
import ActionPlanPanel from "@/components/action-plan";
import { BudgetPanel } from "@/components/budget/budget-panel";
import { CashForecastPanel } from "@/components/cash-forecast";
import { OwnerAvatar } from "@/components/owner-door/owner-avatar";
import { ownerBotKey, runBotTransition } from "@/components/owner-door/owner-bot-motion";
import { OwnerChat, type OwnerChatTurn } from "@/components/owner-door/owner-chat";
import { OwnerHome } from "@/components/owner-door/owner-home";
import { ProfitabilityWaterfall } from "@/components/profitability-waterfall";
import { SphereHero, type SpherePillar } from "@/components/sphere-hero";
import {
  OwnerAccountant,
  OwnerDeliverables,
  OwnerFirst,
  OwnerPlan,
  OwnerSettings,
} from "@/components/owner-door/owner-pages";
import { OwnerShell } from "@/components/owner-door/owner-shell";
import { agentDisplayName, agentShortName } from "@/lib/milon-team";
import { emptyAgentActivity } from "@/lib/milon-team-activity";
import { ownerAnswerTiles, ownerCardStatuses, ownerHomeLines } from "@/lib/owner-answers";
import { AGENT_KEYS, type AgentKey } from "@/lib/milon-team-feed";
import { ownerPresence, type OwnerMotion, type OwnerTalk } from "@/lib/owner-presence";

const USD = { currency: "USD" as const, locale: "en-US" as const };

const BOOKS = {
  hasBooks: true,
  ledger: "QuickBooks" as const,
  revenue: 120000,
  priorRevenue: 100000,
  cogs: 48000,
  priorCogs: 40000,
  receivables: 18000,
  cashflow: {
    openingBalance: "42000",
    revenue: [{ amount: "1000", frequency: "recurring-weekly", startWeek: 1 }],
    expenses: [{ amount: "2500", frequency: "recurring-weekly", startWeek: 1 }],
  },
  openAction: "Approve the payroll run.",
  actionsReady: true,
  signedBy: "Alex Morgan",
  signedOn: "2 Oct 2026",
  market: USD,
};
const TILES = ownerAnswerTiles(BOOKS);

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

function HealthOrb({
  onDriver,
}: {
  onDriver?: (key: string) => void;
}) {
  return (
    <div className="owner-health-hero">
      <SphereHero
        overallHealth={64}
        displayStatus="at_risk"
        pillars={PILLARS}
        caption="Collections are the lever."
        onTopPriority={() => undefined}
        onDriverClick={onDriver}
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
  | "moves"
  | "faces"
  | "settings";

const YTD_PRIOR = {
  revenue: 390000,
  cogs: 150000,
  grossProfit: 240000,
  netProfit: 90000,
  expenses: 150000,
};

const FULL_PRIOR = {
  revenue: 980000,
  cogs: 390000,
  grossProfit: 590000,
  netProfit: 120000,
  expenses: 470000,
};

const READY_ACTUAL_MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map(
  (month) => ({ month, totals: { revenue: 60_000 } }),
);

export function OwnerDoorPreview({
  view,
  bot = null,
  onBot,
  budgetCase = "ready",
}: {
  view: OwnerPreviewView;
  bot?: AgentKey | null;
  onBot?: (agent: AgentKey | null, mode: "push" | "replace") => void;
  budgetCase?: "ready" | "empty" | "draft";
}) {
  const [motion, setMotion] = useState<OwnerMotion>("idle");
  const [done, setDone] = useState(false);
  const [driver, setDriver] = useState<string | null>(null);
  const [liveBot, setLiveBot] = useState<AgentKey | null>(ownerBotKey(bot));
  const [draft, setDraft] = useState("");
  const [liveMessages, setLiveMessages] = useState<OwnerChatTurn[]>([]);
  const [talk, setTalk] = useState<OwnerTalk>(null);
  const [busy, setBusy] = useState(false);
  const liveRef = useRef(liveBot);
  const pushedRef = useRef(false);
  const botHydrated = useRef(false);
  liveRef.current = liveBot;

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

  useEffect(() => {
    const next = ownerBotKey(bot);
    if (!botHydrated.current) {
      botHydrated.current = true;
      return;
    }
    if (next === liveRef.current) return;
    void runBotTransition(() => setLiveBot(next));
  }, [bot]);

  const presence = ownerPresence(emptyAgentActivity());
  const shown =
    view === "work"
      ? {
          ...presence,
          agents: presence.agents.map((agent) =>
            agent.agent === "financial_manager"
              ? { ...agent, motion: "working" as const, sentence: "Working…" }
              : agent,
          ),
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
  const liveAgent = shown.agents.find((agent) => agent.agent === liveBot) ?? null;
  const homeView = view === "rest" || view === "work" || view === "ask";
  const liveMotion: OwnerMotion = talk?.mode ?? liveAgent?.motion ?? "idle";
  const liveSentence =
    talk?.mode === "listening"
      ? "Listening."
      : talk?.mode === "working"
        ? "Working…"
        : talk?.mode === "speaking"
          ? "Speaking."
          : (liveAgent?.sentence ?? "");

  function openLive(next: AgentKey) {
    pushedRef.current = true;
    void runBotTransition(() => {
      setLiveBot(next);
      onBot?.(next, "push");
    });
  }

  function closeLive() {
    const popped = pushedRef.current;
    pushedRef.current = false;
    setTalk(null);
    void runBotTransition(() => setLiveBot(null)).then(() => {
      if (popped && new URLSearchParams(window.location.search).has("bot")) {
        window.history.back();
        return;
      }
      onBot?.(null, "replace");
    });
  }

  function sendLive() {
    const question = draft.trim();
    if (!question || busy || !liveBot) return;
    setDraft("");
    setLiveMessages((current) => [...current, { role: "owner", text: question }]);
    setBusy(true);
    setTalk({ agent: liveBot, mode: "working" });
    window.setTimeout(() => {
      setLiveMessages((current) => [
        ...current,
        { role: "agent", text: "Cash is the first thing to look at." },
      ]);
      setBusy(false);
      setTalk({ agent: liveBot, mode: "speaking" });
      window.setTimeout(() => setTalk(null), 900);
    }, 700);
  }

  function listenLive() {
    if (!liveBot) return;
    setTalk((current) =>
      current?.mode === "listening" ? null : { agent: liveBot, mode: "listening" },
    );
  }

  return (
    <OwnerShell
      screen={
        view === "chat" || view === "recording" || (homeView && liveBot)
          ? "chat"
          : view === "faces"
          ? "home"
          : view === "tasks" || view === "actions" || view === "moves"
            ? "moves"
            : view === "accountant" ||
                view === "deliverables" ||
                view === "plan" ||
                view === "health" ||
                view === "cash" ||
                view === "budget" ||
                view === "profit" ||
                view === "settings"
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
      {view === "health" ? (
        <section className="owner-pane" data-owner-page="health">
          <h1 className="owner-title">Business Health</h1>
          <HealthOrb onDriver={setDriver} />
          {driver ? <p data-health-driver={driver}>Opened {driver}</p> : null}
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
            priorYear={budgetCase === "empty" ? FULL_PRIOR : YTD_PRIOR}
            priorYearMonths={budgetCase === "empty" ? 12 : 7}
            priorYearLabel={budgetCase === "empty" ? "2025" : "Mar–Sep 2025"}
            actualMonths={budgetCase === "ready" ? READY_ACTUAL_MONTHS : undefined}
          />
        </section>
      ) : null}
      {view === "profit" ? (
        <section className="owner-pane" data-owner-page="profit">
          <h1 className="owner-title">Profit</h1>
          <ProfitabilityWaterfall
            clientId="harness-client"
            clientName="Northline Studio"
            periodLabel="September 2026"
            negative="minus"
          />
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
          motion={view === "recording" ? "listening" : "idle"}
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
      {homeView && liveBot && liveAgent ? (
        <OwnerChat
          agent={liveAgent.agent}
          variant="character"
          motion={liveMotion}
          sentence={liveSentence}
          messages={liveMessages}
          draft={draft}
          listening={talk?.mode === "listening"}
          busy={busy}
          error={null}
          onDraft={setDraft}
          onSend={sendLive}
          onListen={listenLive}
          onBack={closeLive}
        />
      ) : null}
      {view === "accountant" ? (
        <OwnerAccountant
          joined={false}
          firmName={null}
          invite={<p className="owner-lede">Invite form</p>}
          uploads={<p className="owner-lede">No files uploaded yet.</p>}
          signed={[{ id: "s1", scope: "cash_forecast", name: "Alex Morgan", when: "2 Oct 2026" }]}
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
      {view === "settings" ? (
        <OwnerSettings
          visitor="us"
          accountantOnMilon={false}
          firmName={null}
          onProfile={() => undefined}
          onQuickBooks={() => undefined}
          onXero={() => undefined}
          onBack={() => undefined}
        />
      ) : null}
      {view === "first" ? (
        <OwnerFirst joined={false} onQuickBooks={() => undefined} onXero={() => undefined} onInvite={() => undefined} />
      ) : null}
      {view === "faces" ? (
        <section className="owner-pane" data-owner-faces="advisor">
          <h1 className="owner-title">{agentDisplayName("advisor")}</h1>
          <div className="owner-agents">
            {(["character", "orb"] as const).map((variant) => (
              <div key={variant} className="owner-agent" data-face={variant}>
                <OwnerAvatar
                  agent="advisor"
                  variant={variant}
                  motion="idle"
                  size="stage"
                  label={`${agentDisplayName("advisor")} ${variant}`}
                />
                <span className="owner-name">{variant === "character" ? "Character" : "Orb"}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {homeView && !liveBot ? (
        <OwnerHome
          variant="character"
          presence={shown}
          lines={ownerHomeLines(TILES, "Collect the two largest invoices")}
          status={ownerCardStatuses(BOOKS)}
          onOpen={openLive}
          onAsk={openLive}
        />
      ) : null}
    </OwnerShell>
  );
}
