/**
 * Mounts the accountant studio shell from the client route, with fixture panes.
 * Supabase is the local stub. Nothing here has a project URL.
 */
import { Component, type ReactNode } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { AdvisoryDrafter } from "@/components/advisory-drafter";
import { AdvisoryPackPanel } from "@/components/advisory-pack-panel";
import { AdvisorySentHistory } from "@/components/advisory-sent-history";
import ActionPlanPanel from "@/components/action-plan";
import { CashForecastPanel } from "@/components/cash-forecast";
import { ClientBriefing } from "@/components/client-briefing";
import { FeatureFinder } from "@/components/feature-finder";
import { OutcomesPanel } from "@/components/outcomes-panel";
import { SectionCard } from "@/components/primitives";
import { RecommendationsPanel } from "@/components/recommendations-panel";
import { ReviewSignoffButton } from "@/components/review-signoff";
import { accountantClientTabSearch, legacyPaneForSearch } from "@/lib/client-route-search";
import {
  CLIENT_RAIL,
  ClientRailButton,
  DELIVERABLE_SECTION_TABS,
  OVERVIEW_SECTION_TABS,
  railGroup,
  SectionTabList,
  selectedSectionId,
} from "@/components/client-studio-chrome";

const CLIENT_ID = "harness-client";

class PaneBoundary extends Component<{ label: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "pane failed" };
  }

  render() {
    if (this.state.error) {
      return (
        <p className="sub" data-pane-error={this.props.label}>
          {this.props.label} could not render in the harness.
        </p>
      );
    }
    return this.props.children;
  }
}

export function RailStudio() {
  const params = useParams({ strict: false }) as { clientId?: string };
  const clientId = params.clientId || CLIENT_ID;
  const search = useSearch({ strict: false }) as {
    tab?: string;
    section?: string;
    focus?: string;
  };
  const navigate = useNavigate();
  const pane = legacyPaneForSearch(search) ?? "overview";
  const group = railGroup(pane);

  const openSection = (section: string) => {
    const rail = group === "deliverables" ? "deliverables" : "overview";
    void navigate({
      to: "/clients/$clientId",
      params: { clientId },
      search: (prev) => accountantClientTabSearch(prev, rail, { section }),
      replace: true,
    });
  };

  return (
    <div className="accountant-portal" data-rail-harness="true" data-rail-ready="true">
      <div id="atmos">
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="grid" />
      </div>
      <div className="shell">
        <div className="topbar">
          <span className="brand">
            <span className="gold-text">MILŌN</span>
          </span>
          <FeatureFinder audience="accountant" clientId={clientId} />
          <span className="spacer" />
        </div>
        <div className="crumb">
          <span>Firm dashboard</span>
          <span>/</span>
          <span>
            <b style={{ color: "var(--ink)" }}>Harbour Glass</b>
          </span>
        </div>
        <div className="client-workspace">
          <nav className="deliverable-rail" aria-label="Client workspace">
            {CLIENT_RAIL.map((item) => (
              <ClientRailButton
                key={item.id}
                id={item.id}
                landing={item.landing}
                label={item.label}
                active={group === item.id}
                clientId={clientId}
                primary={item.id === "ask"}
              />
            ))}
          </nav>
          <div className="deliverable-main">
            {group !== "ask" ? (
              <SectionTabList
                label={group === "deliverables" ? "Deliverables" : "Overview sections"}
                sections={group === "deliverables" ? DELIVERABLE_SECTION_TABS : OVERVIEW_SECTION_TABS}
                selected={selectedSectionId(pane, search.section)}
                onSelect={openSection}
              />
            ) : null}
            {pane === "ask" ? <BotPane /> : null}
            {pane === "overview" ? <BriefingPane /> : null}
            {pane === "cash" ? <CashPane clientId={clientId} /> : null}
            {pane === "advisory" ? <PackPane clientId={clientId} /> : null}
            {pane === "plan" ? <PlanPane clientId={clientId} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function BotPane() {
  return (
    <div className="tabpane on" id="pane-ask">
      <SectionCard className="card hero-card ask-ai-studio-shell">
        <div id="ask-ai-accountant" />
      </SectionCard>
    </div>
  );
}

function BriefingPane() {
  return (
    <div className="tabpane on" id="pane-overview">
      <ClientBriefing
        clientName="Harbour Glass"
        clientCode="HG-14"
        industryLabel="Manufacturing"
        ring={<span className="briefing-kicker">72</span>}
        healthScore={72}
        healthLabel="Stable"
        healthStatus="healthy"
        snapshot={[
          { key: "cash", label: "Cash", value: "R186k" },
          { key: "revenue", label: "Revenue", value: "R420k" },
          { key: "runway", label: "Runway", value: "11 weeks" },
        ]}
        about="A small glass workshop. These figures are local fixture data."
        profile={null}
        whatMatters="Collections are the gap before payroll."
        workflow={null}
        workflowLoading={false}
        openQueries={1}
        reportsIssued={0}
        movementReportAvailable={false}
        hasFigures
        figuresPeriodLabel="September 2026"
      />
    </div>
  );
}

function CashPane({ clientId }: { clientId: string }) {
  return (
    <div className="tabpane on" id="pane-cash">
      <div className="card cf-wrap" id="wizard-cash-panel">
        <div className="cf-head">
          <div>
            <span className="eyebrow">Signature view</span>
            <div className="h-sec">13-week cash forecast</div>
          </div>
          <div className="deliverable-tab-head__sign">
            <PaneBoundary label="Cash sign-off">
              <ReviewSignoffButton
                compact
                clientId={clientId}
                clientName="Harbour Glass"
                scope="cash_forecast"
                signoff={null}
                isStale={false}
                onChange={() => {}}
              />
            </PaneBoundary>
          </div>
        </div>
        <PaneBoundary label="Cash forecast">
          <CashForecastPanel clientId={clientId} clientName="Harbour Glass" canSign hideReadOnlyStamp hideInlineSignOff />
        </PaneBoundary>
      </div>
    </div>
  );
}

function PackPane({ clientId }: { clientId: string }) {
  return (
    <div className="tabpane on" id="pane-advisory">
      <div className="deliverable-tab-head">
        <div>
          <span className="eyebrow">Advisory Drafter</span>
          <div className="h-sec">Write the note</div>
          <p className="sub" style={{ margin: "8px 0 0", maxWidth: "68ch" }}>
            Draft the advisory pack or email from this client&apos;s figures. Sign it off when it is ready to send.
          </p>
        </div>
      </div>
      <PaneBoundary label="Advisory pack">
        <AdvisoryPackPanel
          className="mb-5"
          clientId={clientId}
          firmId={null}
          signoff={null}
          audience="accountant"
          canGenerate
          hasFirm={false}
          onChanged={() => {}}
          onSignoffAction={() => {}}
          currentFigures={{ runwayLabel: "11 weeks", cash: 186000, healthScore: 72 }}
        />
      </PaneBoundary>
      <PaneBoundary label="Recommendations">
        <RecommendationsPanel
          className="mb-5"
          clientId={clientId}
          firmId={null}
          audience="accountant"
          canPropose
          onChanged={() => {}}
          onOpenActions={() => {}}
          onAddFigures={() => {}}
        />
      </PaneBoundary>
      <PaneBoundary label="Outcomes">
        <OutcomesPanel className="mb-5" clientId={clientId} audience="accountant" onChanged={() => {}} />
      </PaneBoundary>
      <PaneBoundary label="Advisory drafter">
        <AdvisoryDrafter clientId={clientId} clientName="Harbour Glass" />
      </PaneBoundary>
      <PaneBoundary label="Sent history">
        <AdvisorySentHistory clientId={clientId} />
      </PaneBoundary>
    </div>
  );
}

function PlanPane({ clientId }: { clientId: string }) {
  return (
    <div className="tabpane on" id="pane-plan">
      <div className="deliverable-tab-head">
        <div>
          <span className="eyebrow">Action Plan</span>
          <div className="h-sec">What still needs doing</div>
          <p className="sub" style={{ margin: "8px 0 0", maxWidth: "68ch" }}>
            This is the shared work list for the engagement.
          </p>
        </div>
        <div className="deliverable-tab-head__sign">
          <PaneBoundary label="Plan sign-off">
            <ReviewSignoffButton
              compact
              clientId={clientId}
              clientName="Harbour Glass"
              scope="action_plan"
              signoff={null}
              isStale={false}
              onChange={() => {}}
            />
          </PaneBoundary>
        </div>
      </div>
      <PaneBoundary label="Action plan">
        <ActionPlanPanel clientId={clientId} clientName="Harbour Glass" simplified isOwner />
      </PaneBoundary>
    </div>
  );
}
