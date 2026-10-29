import { useMemo, type ReactNode } from "react";
import { useAgentActivity } from "@/hooks/use-agent-activity";
import { useMilonTeamFeed, type MilonTeamFeedApi } from "@/hooks/use-milon-team-feed";
import type { ApprovedDraftTarget } from "@/components/owner-draft-card";
import {
  findingFigureEntries,
  findingSentence,
  isVisibleAgentFinding,
  type AgentActivitySnapshot,
} from "@/lib/milon-team-activity";
import { clientAgentWork } from "@/lib/agent-work";
import { rewriteDraftMonthStamp } from "@/lib/statement-period";
import { isTaxAgent, type StageAgentKey } from "@/lib/tax-specialist/agents";
import { TaxSpecialistPage } from "@/components/tax-specialist/tax-specialist-slot";
import { AgentStage } from "./agent-stage";
import { AgentSection } from "./agent-section";
import { AgentWork } from "./agent-work";
import { MilonTeamDesk } from "./milon-team-desk";

type MilonTeamPaneProps = {
  clientId: string;
  /** Home Ask opens this agent's thread. The feed stays off the card stage. */
  agent?: StageAgentKey | null;
  /** The sentence Home already shows for this agent. Wins over an empty feed. */
  homeFinding?: string | null;
  /** Home sentence for this agent when no run finding is on file. */
  findingFallback?: string | null;
  onOpenApproved?: (target: ApprovedDraftTarget) => void;
  onInvite?: () => void;
  /** Landing cards and the stage switcher both land here. */
  onSelectAgent?: (agent: StageAgentKey) => void;
  /** Same market OwnerHome uses for the ZA subtitle and to hide the hand-off strip. */
  marketCountry?: string | null;
  audience?: "owner" | "accountant";
  /** clients.is_demo. Passed through to the team-row chip. */
  sampleClient?: boolean;
  /** Live scorecard ratios. Draft sentences quote these. */
  canonicalRatios?: Record<string, number> | null;
  /** The Ask widget host. An open agent shows it beside the hero; the team desk shows it last. */
  chat?: ReactNode;
};

export function MilonTeamPane(props: MilonTeamPaneProps) {
  const { clientId } = props;
  const feed = useMilonTeamFeed(clientId);
  const live = useAgentActivity(clientId);
  return <MilonTeamPaneView {...props} feed={feed} live={live} />;
}

/** The pane without its data hooks. The route and the screenshot harness share it. */
export function MilonTeamPaneView({
  clientId,
  agent = null,
  homeFinding = null,
  findingFallback = null,
  onOpenApproved,
  onInvite,
  onSelectAgent,
  marketCountry = null,
  audience = "accountant",
  sampleClient = false,
  canonicalRatios = null,
  chat = null,
  feed,
  live,
  now,
}: MilonTeamPaneProps & {
  feed: MilonTeamFeedApi;
  live: AgentActivitySnapshot & { refresh?: () => void };
  now?: Date;
}) {
  const filed = useMemo(() => {
    const newest = live.findings
      .filter((row) => row.agent === agent && isVisibleAgentFinding(row))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (!agent || !newest) return undefined;
    return {
      id: newest.id,
      text: findingSentence({
        title: newest.title,
        detail: newest.detail,
        figures: findingFigureEntries(newest.evidence),
        market: live.market,
        canonicalRatios,
        liveHealth: feed.healthQuote,
        evidence: newest.evidence,
        writtenAt: newest.created_at,
        figuresUpdatedAt: feed.figuresUpdatedAt,
      }),
    };
  }, [agent, live.findings, live.market, canonicalRatios, feed.healthQuote, feed.figuresUpdatedAt]);
  const filedFinding = filed?.text ?? "";
  const homeLine = homeFinding?.trim() || findingFallback?.trim() || "";
  const finding = rewriteDraftMonthStamp(
    homeFinding?.trim() || findingFallback?.trim() || filedFinding,
  );
  const heroFinding = agent
    ? { id: homeLine ? null : (filed?.id ?? null), text: finding || null }
    : null;
  if (isTaxAgent(agent)) {
    return (
      <AgentStage
        agent={agent}
        finding={homeLine || null}
        marketCountry={marketCountry}
        audience={audience}
        taxTab
        onSelect={(next) => onSelectAgent?.(next)}
        chat={chat}
      >
        <TaxSpecialistPage country={marketCountry} />
      </AgentStage>
    );
  }
  const desk = (
    <MilonTeamDesk
      feed={feed}
      now={now}
      live={live}
      initialFilter={agent ?? "all"}
      presentation={agent ? "agent" : "team"}
      onOpenApproved={onOpenApproved}
      onInvite={onInvite}
      onOpenAgent={onSelectAgent}
      onOpenTaxAgent={onSelectAgent ? () => onSelectAgent("tax_specialist") : undefined}
      onRefreshDrafts={live.refresh}
      marketCountry={marketCountry}
      audience={audience}
      sampleClient={sampleClient}
      canonicalRatios={canonicalRatios}
      heroFinding={heroFinding}
    />
  );
  if (!agent) {
    return (
      <>
        {desk}
        {chat}
      </>
    );
  }
  return (
    <AgentStage
      agent={agent}
      finding={finding || null}
      marketCountry={marketCountry}
      audience={audience}
      taxTab
      onSelect={(next) => onSelectAgent?.(next)}
      chat={chat}
    >
      <AgentSection section="work">
        <AgentWork items={clientAgentWork(agent, clientId)} />
      </AgentSection>
      {desk}
    </AgentStage>
  );
}
