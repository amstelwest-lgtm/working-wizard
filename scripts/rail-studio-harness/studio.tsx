/**
 * Mounts the accountant studio shell from the client route, with fixture panes.
 * Supabase is the local stub. Nothing here has a project URL.
 */
import { Component, useState, type ReactNode } from "react";
import { ARAP_GOLD_BTN } from "@/components/arap-answer-strip";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { AdvisoryDrafter } from "@/components/advisory-drafter";
import { AdvisoryPackPanel } from "@/components/advisory-pack-panel";
import { AdvisorySentHistory } from "@/components/advisory-sent-history";
import ActionPlanPanel from "@/components/action-plan";
import { CashForecastPanel } from "@/components/cash-forecast";
import { CollectionsPanel } from "@/components/collections-panel";
import { PayablesPanel } from "@/components/payables-panel";
import { finalizeCollections } from "@/lib/collections";
import { finalizePayables } from "@/lib/payables";
import { BudgetPanel } from "@/components/budget/budget-panel";
import { ClientBriefing } from "@/components/client-briefing";
import { DataUpToDate } from "@/components/data-up-to-date";
import { StrategicMovesPanel } from "@/components/strategic-moves-panel";
import { rankStrategicMoves } from "@/lib/strategic-moves";
import { DeliverableAnswerStrip, deliverableDrawerHint } from "@/components/deliverable-answer-strip";
import { DeliverableInputConfig } from "@/components/deliverable-input-config";
import { ProductMixPanel } from "@/components/product-mix-panel";
import {
  ProfitabilityWaterfall,
  profitAnswerSentence,
  type WaterfallExportApi,
} from "@/components/profitability-waterfall";
import { QboConnectCard } from "@/components/qbo-connect";
import { ReviewInputsDrawer } from "@/components/review-inputs-drawer";
import { SageConnectCard } from "@/components/sage-connect";
import { SimplifiedRatios } from "@/components/simplified-ratios";
import { SphereHero } from "@/components/sphere-hero";
import { buildSpherePillars } from "@/components/sphere-hero-adapter";
import { XeroConnectCard } from "@/components/xero-connect";
import {
  PILLAR_LABELS,
  PILLAR_SHORT_LABELS,
  scorecardHealthFromFinancials,
  type HealthPillarId,
} from "@/lib/health-score";
import { figureSourceChipLabel } from "@/lib/ledger-link-copy";
import { healthHeadline } from "@/lib/client-briefing";
import type { NextStep } from "@/lib/next-step";
import {
  overviewAnswerSentence,
  overviewSectionCards,
  snapshotFigure,
} from "@/lib/overview-moves-copy";
import { NextStepCard } from "@/components/next-step-card";
import { OverviewSectionCards } from "@/components/overview-section-cards";
import { currencySymbol } from "@/lib/market";
import { computeOverviewCaption, healthAnswerSentence } from "@/lib/overview-insights";
import { preferStatementPeriod, readStatementMeta } from "@/lib/statement-period";
import { derivePeriodWaterfallFallback } from "@/lib/weekly-inputs";
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
    aged?: string | number;
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
            {pane === "moves" ? <MovesPane /> : null}
            {pane === "summary" ? <BooksPane clientId={clientId} /> : null}
            {pane === "ratios" ? (
              <HealthPane
                clientId={clientId}
                pillars={search.section === "pillars" || search.focus === "pillars"}
              />
            ) : null}
            {pane === "profit" ? <ProfitPane clientId={clientId} /> : null}
            {pane === "cash" ? <CashPane clientId={clientId} /> : null}
            {pane === "collections" ? <CollectionsPane aged={search.aged === 1 || search.aged === "1"} /> : null}
            {pane === "payables" ? <PayablesPane aged={search.aged === 1 || search.aged === "1"} /> : null}
            {pane === "budget" ? <BudgetPane clientId={clientId} /> : null}
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

function harnessMoves() {
  return rankStrategicMoves({
    healthByKey: { debtorDays: 40, creditorDays: 70, grossMargin: 55 },
    limit: 3,
  });
}

const HARNESS_STEP: NextStep = {
  key: "diagnosis",
  state: "diagnosis",
  stateLabel: "Diagnosis",
  audience: "accountant",
  urgency: "now",
  title: "Review the health diagnosis",
  reason: "The figures are on file. The next step is the review already on this page.",
  cta: {
    label: "Review diagnosis",
    route: {
      path: "/clients/harness-client",
      tab: "ratios",
      search: {},
      href: "/clients/harness-client?tab=overview&section=health",
    },
  },
  outstanding: {
    openQuestions: 0,
    proposedRecommendations: 0,
    approvedWithoutAction: 0,
    openActions: 0,
    overdueActions: 0,
    blockedActions: 0,
    actionedUnmeasured: 0,
    openDataRequests: 0,
  },
  daysToReview: null,
  openDataRequestKinds: [],
};

function BooksPane({ clientId }: { clientId: string }) {
  return (
    <div className="tabpane on" id="pane-summary">
      <DataUpToDate
        clientId={clientId}
        returnPath={`/clients/${clientId}`}
        onUpload={() => {}}
        freshness="Snapshot on file · September 2026"
        chip={figureSourceChipLabel(HARNESS_FINANCIALS.statementSource)}
        fixtureOpenKinds={["bank_statement"]}
      />
    </div>
  );
}

function MovesPane() {
  return (
    <div className="tabpane on" id="pane-moves">
      <StrategicMovesPanel moves={harnessMoves()} clientId={CLIENT_ID} onOpenPlan={() => {}} />
    </div>
  );
}

function BriefingPane() {
  const snapshot = [
    { key: "cash", label: "Cash", value: "R186k" },
    { key: "revenue", label: "Revenue", value: "R420k" },
    { key: "runway", label: "Runway", value: "11 weeks" },
  ];
  const matters = "Collections are the gap before payroll.";
  const cards = overviewSectionCards({
    health: healthHeadline(72, "Stable"),
    cash: snapshotFigure(snapshot, "runway") ?? snapshotFigure(snapshot, "cash"),
    profit: snapshotFigure(snapshot, "om"),
    moves: harnessMoves()[0]?.title ?? null,
  });
  return (
    <div className="tabpane on" id="pane-overview">
      <DeliverableAnswerStrip
        heading="Overview"
        sentence={overviewAnswerSentence({ whatMatters: matters, score: 72, label: "Stable" })}
        chip={figureSourceChipLabel(HARNESS_FINANCIALS.statementSource)}
        scope="financials"
        clientId={CLIENT_ID}
        clientName="Harbour Glass"
        signoff={null}
        isStale={false}
        onSignoffChange={() => {}}
        extraActions={
          <button type="button" className={ARAP_GOLD_BTN} data-next-step-cta={HARNESS_STEP.key}>
            {HARNESS_STEP.cta.label}
          </button>
        }
      />
      <ReviewInputsDrawer hint="Connections, exports">
        <div className="briefing-actions">
          <button type="button" className="btn ghost mini">
            Ask Milōn Bot
          </button>
          <button type="button" className="btn ghost mini">
            Upload
          </button>
          <button type="button" className="btn ghost mini">
            Generate report
          </button>
        </div>
      </ReviewInputsDrawer>
      <OverviewSectionCards cards={cards} onOpen={() => {}} />
      <NextStepCard
        clientId={CLIENT_ID}
        audience="accountant"
        surface="accountant_portal"
        fixtureStep={HARNESS_STEP}
        hideCta
        onAct={() => {}}
      />
      <ClientBriefing
        clientName="Harbour Glass"
        clientCode="HG-14"
        industryLabel="Manufacturing"
        ring={<span className="briefing-kicker">72</span>}
        healthScore={72}
        healthLabel="Stable"
        healthStatus="healthy"
        snapshot={snapshot}
        about="A small glass workshop. These figures are local fixture data."
        profile={null}
        whatMatters={matters}
        hideWhatMatters
        hideConnectionActions
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

const HARNESS_FINANCIALS = {
  cash: "186000",
  revenue: "420000",
  cogs: "80000",
  fixedCosts: "140000",
  statementSource: "upload",
  periodLabel: "September 2026",
};

function HealthPane({ clientId, pillars }: { clientId: string; pillars: boolean }) {
  const overall = scorecardHealthFromFinancials({
    financials: HARNESS_FINANCIALS,
    cashBalance: 186000,
  });
  const pillarById = Object.fromEntries(
    overall.pillars.map((pillar) => [pillar.id, pillar.score ?? Number.NaN]),
  ) as Record<HealthPillarId, number>;
  const pillarStatus = Object.fromEntries(overall.pillars.map((pillar) => [pillar.id, pillar.status]));
  const avg = overall.overall ?? Number.NaN;
  const caption = computeOverviewCaption({
    hasRealFinancials: true,
    avgHealth: avg,
    cashHealth: pillarById.cash ?? Number.NaN,
    displayStatus: overall.displayStatus,
  });
  const sentence = healthAnswerSentence({
    caption,
    score: Number.isFinite(avg) ? avg : null,
    bandLabel: overall.displayLabel,
    includeScore: pillars,
    pillars: (["profit", "assets", "financing", "cash"] as const).map((id) => ({
      label: PILLAR_SHORT_LABELS[id],
      score: pillarById[id],
      status: pillarStatus[id],
    })),
  });
  const chip = figureSourceChipLabel(HARNESS_FINANCIALS.statementSource);
  const spherePillars = buildSpherePillars({
    overallHealth: avg,
    pillarHealths: pillarById,
    pillarStatus,
    healthMap: {},
    ratioMeta: {},
  });
  const sections = (["profit", "assets", "financing", "cash"] as const).map((id) => ({
    id,
    label: PILLAR_LABELS[id],
    health: pillarById[id],
    status: pillarStatus[id],
    series: [] as number[],
  }));

  return (
    <div className="tabpane on" id="pane-ratios">
      <DeliverableAnswerStrip
        heading={pillars ? "Where it hurts" : "Health score"}
        sentence={sentence}
        chip={chip}
        scope="financials"
        clientId={clientId}
        clientName="Harbour Glass"
        signoff={null}
        isStale={false}
        onSignoffChange={() => {}}
        canSign
        extraActions={
          <button type="button" className="answer-strip__icon" aria-label="Export PDF" title="Export PDF">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
            </svg>
          </button>
        }
      />
      <ReviewInputsDrawer hint={deliverableDrawerHint("ratios", { financials: HARNESS_FINANCIALS })}>
        <DeliverableInputConfig
          clientId={clientId}
          deliverableId="ratios"
          context={{ financials: HARNESS_FINANCIALS }}
        />
        <div className="card collapse" id="finCollapse">
          <div className="c-head">
            <h3>
              Financials <span className="autosave">Auto-saved</span>
            </h3>
            <span className="hint">
              Edit the figures or upload a statement. The score follows what is saved here.
            </span>
          </div>
        </div>
      </ReviewInputsDrawer>
      <PaneBoundary label="Health score">
        <div style={{ marginBottom: 32 }}>
          {pillars ? null : (
          <div style={{ background: "#0a0e1a", borderRadius: 20, padding: "16px 8px", marginBottom: 20 }}>
            <SphereHero
              onDark
              hideCaption
              overallHealth={Number.isFinite(avg) ? avg : Number.NaN}
              displayStatus={overall.displayStatus}
              pillars={spherePillars}
            />
          </div>
          )}
          <div style={{ background: "#0a0e1a", borderRadius: 20, padding: 16 }}>
            <SimplifiedRatios sections={sections} />
          </div>
        </div>
      </PaneBoundary>
      <div id="accounting-connect" style={{ marginBottom: 16, display: "grid", gap: 10 }}>
        <QboConnectCard clientId={clientId} returnPath={`/clients/${clientId}`} financials={HARNESS_FINANCIALS} />
        <XeroConnectCard clientId={clientId} returnPath={`/clients/${clientId}`} financials={HARNESS_FINANCIALS} />
        <SageConnectCard clientId={clientId} />
      </div>
    </div>
  );
}

function ProfitPane({ clientId }: { clientId: string }) {
  const meta = readStatementMeta(HARNESS_FINANCIALS);
  const preferPeriod = preferStatementPeriod(HARNESS_FINANCIALS);
  const [profitExport, setProfitExport] = useState<WaterfallExportApi | null>(null);
  return (
    <div className="tabpane on" id="pane-profit">
      <DeliverableAnswerStrip
        heading="Profitability"
        sentence={profitAnswerSentence({
          currency: currencySymbol(),
          periodLabel: meta.periodLabel,
          preferPeriod,
        })}
        chip={figureSourceChipLabel(meta.statementSource)}
        scope="profitability"
        clientId={clientId}
        clientName="Harbour Glass"
        signoff={null}
        isStale={false}
        onSignoffChange={() => {}}
        canSign
        extraActions={
          <button
            type="button"
            className="answer-strip__icon"
            aria-label="Export PDF"
            title="Export PDF"
            disabled={profitExport?.exporting}
            onClick={() => profitExport?.exportPdf()}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
            </svg>
          </button>
        }
      />
      <ReviewInputsDrawer hint={deliverableDrawerHint("profit", { financials: HARNESS_FINANCIALS })}>
        <DeliverableInputConfig
          clientId={clientId}
          deliverableId="profit"
          context={{ financials: HARNESS_FINANCIALS }}
        />
        <p className="eyebrow">Product lines</p>
        <p className="sub" style={{ marginBottom: 16 }}>
          Answer these questions to build revenue and net profit per product line — so you can see which
          lines actually make the money.
        </p>
        <ProductMixPanel
          totalRevenue={420000}
          incentive="Answer these to build revenue and net profit per product line."
        />
        <div className="card collapse open" id="profitFinCollapse" style={{ marginTop: 20 }}>
          <div className="c-head">
            <h3>
              Profitability inputs <span className="autosave">Auto-saved</span>
            </h3>
            <span className="hint">Period P&amp;L that feeds the waterfall — same figures as Health &amp; Ratios</span>
          </div>
          <div className="c-body">
            <div className="c-inner">
              <p className="sub" style={{ marginTop: 0 }}>
                Edit the period figures here. The waterfall updates from this P&amp;L — weekly figures the
                owner enters stay on their board.
              </p>
            </div>
          </div>
        </div>
      </ReviewInputsDrawer>
      <div id="wizard-profit-walk">
        <PaneBoundary label="Profitability waterfall">
          <ProfitabilityWaterfall
            fallback={derivePeriodWaterfallFallback(HARNESS_FINANCIALS)}
            clientName="Harbour Glass"
            clientId={clientId}
            periodLabel={meta.periodLabel}
            preferPeriod={preferPeriod}
            statementSource={meta.statementSource}
            hideLead
            hideCardExport
            onExportReady={setProfitExport}
          />
        </PaneBoundary>
      </div>
    </div>
  );
}

const HARNESS_ARAP = {
  receivables: 92000,
  payables: 41000,
  debtorDays: 48,
  creditorDays: 31,
};

const HARNESS_COLLECTIONS = finalizeCollections({
  source: "xero",
  asOf: "2026-09-30",
  syncedAt: "2026-10-01T00:00:00.000Z",
  contacts: [
    {
      contactId: "c-acme",
      name: "Acme",
      outstanding: 21000,
      overdue: 21000,
      ageBucket: "91+",
      buckets: [],
      invoices: [
        { invoiceId: "i1", reference: "INV-14", dueDate: "2026-06-01", amount: 21000, ageBucket: "91+" },
      ],
    },
    {
      contactId: "c-north",
      name: "North Glass",
      outstanding: 9000,
      overdue: 9000,
      ageBucket: "2 Months",
      buckets: [],
      invoices: [
        { invoiceId: "i2", reference: "INV-22", dueDate: "2026-08-01", amount: 9000, ageBucket: "2 Months" },
      ],
    },
    {
      contactId: "c-fit",
      name: "Harbour Fit",
      outstanding: 5000,
      overdue: 5000,
      ageBucket: "1 Month",
      buckets: [],
      invoices: [
        { invoiceId: "i3", reference: "INV-30", dueDate: "2026-09-01", amount: 5000, ageBucket: "1 Month" },
      ],
    },
    {
      contactId: "c-lane",
      name: "Lane & Co",
      outstanding: 3000,
      overdue: 3000,
      ageBucket: "1 Month",
      buckets: [],
      invoices: [
        { invoiceId: "i4", reference: "INV-31", dueDate: "2026-09-04", amount: 3000, ageBucket: "1 Month" },
      ],
    },
  ],
});

const HARNESS_PAYABLES = finalizePayables({
  source: "xero",
  asOf: "2026-09-30",
  syncedAt: "2026-10-01T00:00:00.000Z",
  suppliers: [
    {
      supplierId: "s-kiln",
      name: "Kiln Gas",
      outstanding: 9000,
      overdue: 9000,
      ageBucket: "2 Months",
      buckets: [],
      bills: [
        { billId: "b1", reference: "BILL-3", dueDate: "2026-08-12", amount: 9000, ageBucket: "2 Months" },
      ],
    },
    {
      supplierId: "s-sand",
      name: "Sand Co",
      outstanding: 6000,
      overdue: 6000,
      ageBucket: "1 Month",
      buckets: [],
      bills: [
        { billId: "b2", reference: "BILL-8", dueDate: "2026-09-02", amount: 6000, ageBucket: "1 Month" },
      ],
    },
    {
      supplierId: "s-freight",
      name: "Freight",
      outstanding: 3000,
      overdue: 3000,
      ageBucket: "Current",
      buckets: [],
      bills: [
        { billId: "b3", reference: "BILL-9", dueDate: "2026-09-20", amount: 3000, ageBucket: "Current" },
      ],
    },
  ],
});

function CollectionsPane({ aged }: { aged: boolean }) {
  return (
    <div className="tabpane on" id="pane-collections">
      <PaneBoundary label="Collections">
        <CollectionsPanel
          clientId={CLIENT_ID}
          periodLabel="September 2026"
          position={HARNESS_ARAP}
          statementSource={HARNESS_FINANCIALS.statementSource}
          fixtureSnapshot={aged ? HARNESS_COLLECTIONS : undefined}
          onUploadAged={() => {}}
          onConnectXero={() => {}}
          onConnectQbo={() => {}}
          onOpenDrafts={() => {}}
          onOpenActions={() => {}}
        />
      </PaneBoundary>
    </div>
  );
}

function PayablesPane({ aged }: { aged: boolean }) {
  return (
    <div className="tabpane on" id="pane-payables">
      <PaneBoundary label="Payables">
        <PayablesPanel
          clientId={CLIENT_ID}
          runwayWeeks={11}
          periodLabel="September 2026"
          position={HARNESS_ARAP}
          statementSource={HARNESS_FINANCIALS.statementSource}
          fixtureSnapshot={aged ? HARNESS_PAYABLES : undefined}
          onUploadAged={() => {}}
          onConnectXero={() => {}}
          onConnectQbo={() => {}}
          onOpenDrafts={() => {}}
          onOpenActions={() => {}}
        />
      </PaneBoundary>
    </div>
  );
}

function CashPane({ clientId }: { clientId: string }) {
  return (
    <div className="tabpane on" id="pane-cash">
      <div className="card cf-wrap" id="wizard-cash-panel">
        <PaneBoundary label="Cash forecast">
          <CashForecastPanel clientId={clientId} clientName="Harbour Glass" canSign hideReadOnlyStamp />
        </PaneBoundary>
      </div>
    </div>
  );
}

export function OwnerCashBoard({ clientId }: { clientId: string }) {
  const tabs = ["Business Health", "Profit", "Cash Forecast", "Budget", "Next moves", "Action Plan"];
  return (
    <div data-owner-board="true" data-rail-ready="true" className="mx-auto max-w-5xl px-3 py-4">
      <div className="mb-3 flex gap-2 overflow-x-auto border-b border-[#b7872a]/20">
        {tabs.map((label) => (
          <span
            key={label}
            className={`shrink-0 border-b-2 px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] ${
              label === "Cash Forecast"
                ? "border-[#d4a550] text-[#d4a550]"
                : "border-transparent text-slate-500"
            }`}
          >
            {label}
          </span>
        ))}
      </div>
      <PaneBoundary label="Owner cash">
        <CashForecastPanel clientId={clientId} clientName="Harbour Glass" canSign={false} hideReadOnlyStamp />
      </PaneBoundary>
    </div>
  );
}

function BudgetPane({ clientId }: { clientId: string }) {
  return (
    <div className="tabpane on" id="pane-budget">
      <PaneBoundary label="Budget">
        <BudgetPanel
          clientId={clientId}
          clientName="Harbour Glass"
          role="accountant"
          canSign
          hideInlineSignOff
          simplified={false}
          financials={{ revenue: "420000", cogs: "80000", fixedCosts: "140000", cash: "186000" }}
          fyStartMonthDefault={3}
        />
      </PaneBoundary>
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
