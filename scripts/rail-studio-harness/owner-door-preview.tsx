/**
 * Presentational owner door for local screenshots. Fixture figures stay in this
 * file. Production /app never imports it.
 */
import { useEffect, useState } from "react";
import { OwnerAvatar } from "@/components/owner-door/owner-avatar";
import { OwnerChat } from "@/components/owner-door/owner-chat";
import { OwnerHome } from "@/components/owner-door/owner-home";
import {
  OwnerAccountant,
  OwnerActions,
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

export type OwnerPreviewView =
  | "rest"
  | "work"
  | "chat"
  | "ask"
  | "reel"
  | "actions"
  | "accountant"
  | "deliverables"
  | "plan"
  | "first";

export function OwnerDoorPreview({ view }: { view: OwnerPreviewView }) {
  const [motion, setMotion] = useState<OwnerMotion>("idle");
  const [done, setDone] = useState(false);

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

  return (
    <OwnerShell
      screen={
        view === "chat"
          ? "chat"
          : view === "actions" || view === "accountant" || view === "deliverables" || view === "plan"
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
      {view === "chat" && chatAgent ? (
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
          listening={false}
          busy={false}
          error={null}
          onDraft={() => undefined}
          onSend={() => undefined}
          onListen={() => undefined}
          onBack={() => undefined}
        />
      ) : null}
      {view === "actions" ? (
        <OwnerActions
          ready
          rows={[{ id: "a1", title: "Approve the payroll run.", status: "not_started", due: "16 Oct 2026" }]}
          onAsk={() => undefined}
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
      {view === "rest" || view === "work" || view === "ask" ? (
        <OwnerHome
          variant="character"
          presence={shown}
          tiles={TILES}
          onOpen={() => undefined}
          onAsk={() => undefined}
          onTile={() => undefined}
        />
      ) : null}
    </OwnerShell>
  );
}
