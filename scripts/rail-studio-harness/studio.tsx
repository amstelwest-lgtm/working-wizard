/**
 * Mounts the accountant studio shell from the client route, with fixture panes.
 * Supabase is the local stub. Nothing here has a project URL.
 */
import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ARAP_GOLD_BTN } from "@/components/arap-answer-strip";
import { PeriodPill } from "@/components/chrome-icons";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { AdvisoryDrafter } from "@/components/advisory-drafter";
import { AdvisoryPackPanel } from "@/components/advisory-pack-panel";
import { AdvisoryTabSignoff } from "@/components/advisory-tab-signoff";
import { AdvisorySentHistory } from "@/components/advisory-sent-history";
import { ReportsStudio } from "@/routes/_authenticated/reports-studio";
import { SourceDocumentsView } from "@/components/source-documents-panel";
import type { SourceDocumentsModel } from "@/lib/source-documents-ui";
import ActionPlanPanel from "@/components/action-plan";
import { CashForecastPanel } from "@/components/cash-forecast";
import { CollectionsPanel } from "@/components/collections-panel";
import { PayablesPanel } from "@/components/payables-panel";
import { finalizeCollections } from "@/lib/collections";
import { finalizePayables } from "@/lib/payables";
import { BudgetPanel } from "@/components/budget/budget-panel";
import type { BudgetActualMonth } from "@/lib/budget-chart-table";
import { DataUpToDate } from "@/components/data-up-to-date";
import { StrategicMovesPanel } from "@/components/strategic-moves-panel";
import { rankStrategicMoves } from "@/lib/strategic-moves";
import { DeliverableAnswerStrip, deliverableDrawerHint } from "@/components/deliverable-answer-strip";
import { FirmDashboardCrumb } from "@/components/firm-dashboard-crumb";
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
import { AgentStage } from "@/components/milon-team/agent-stage";
import { AgentWork } from "@/components/milon-team/agent-work";
import { MilonTeamDesk } from "@/components/milon-team/milon-team-desk";
import { clientAgentWork } from "@/lib/agent-work";
import { clientBackTarget } from "@/lib/client-back";
import { ClientBackLink, ClientSectionOverview, ClientSubpageFrame } from "@/components/client-subpage";
import { NoteLayer } from "@/components/note-layer";
import { DESK_NOW, useMilonTeamFeedStub } from "./milon-team-stub";
import {
  PILLAR_LABELS,
  PILLAR_SHORT_LABELS,
  scorecardHealthFromFinancials,
  type HealthPillarId,
} from "@/lib/health-score";
import { figureSourceChipLabel } from "@/lib/ledger-link-copy";
import { planAnswerSentence, type PackAnswerStatus } from "@/lib/plan-pack-copy";
import type { AdvisorySignoffAction } from "@/lib/advisory-signoff";
import { buildFinancialSnapshot, healthHeadline } from "@/lib/client-briefing";
import { buildVarianceChips } from "@/lib/prior-period";
import { booksCoverPeriod, booksTileLines } from "@/lib/books-answer";
import { overviewBudgetTileFigure } from "@/lib/budget-chart-table";
import { overviewCashTileFigure } from "@/lib/cash-forecast-parity";
import { statementArApMoney } from "@/components/statement-arap-fallback";
import { createBudgetDocument } from "@/lib/budget.months";
import {
  budgetSeededFromStatement,
  budgetVersusStatement,
  seedBudgetFromFinancials,
} from "@/lib/budget.bridges";
import type { BudgetQualification } from "@/lib/budget.types";
import type { NextStep } from "@/lib/next-step";
import {
  overviewSectionCards,
  snapshotFigure,
  storedAmountFigure,
} from "@/lib/overview-moves-copy";
import { OwnerHome } from "@/components/owner-door/owner-home";
import { ownerAnswerTiles, ownerCardStatuses, ownerHomeLines, type OwnerBooks } from "@/lib/owner-answers";
import { ownerPresence } from "@/lib/owner-presence";
import { emptyAgentActivity } from "@/lib/milon-team-activity";
import { signoffStatusLine } from "@/lib/signoff-status";
import type { AgentKey } from "@/lib/milon-team-feed";
import { currencySymbol, formatMoneyCompact, ZA_MARKET } from "@/lib/market";
import { computeOverviewCaption, healthAnswerSentence } from "@/lib/overview-insights";
import { preferStatementPeriod, readStatementMeta } from "@/lib/statement-period";
import { derivePeriodWaterfallFallback } from "@/lib/weekly-inputs";
import { FeatureFinder } from "@/components/feature-finder";
import { OutcomesPanel } from "@/components/outcomes-panel";
import { SectionCard } from "@/components/primitives";
import { RecommendationsPanel } from "@/components/recommendations-panel";
import {
  accountantClientTabSearch,
  legacyHashDestination,
  legacyPaneForSearch,
  routerHash,
} from "@/lib/client-route-search";
import { ClientRail } from "@/components/client-studio-chrome";
import { AccountantMenuButton, DrawerBackdrop, useAccountantDrawer } from "@/components/accountant-nav";
import { SettingsMenu } from "@/components/settings-menu";
import { ThemeToggle } from "@/components/theme-toggle";

const CLIENT_ID = "harness-client";
/** Same freshness line the Books pane already shows. */
const HARNESS_BOOKS_FRESHNESS = "Snapshot on file · September 2026";
/** Same clock as the collections fixture sync. */
const HARNESS_FIGURES_UPDATED_AT = "2026-10-01T00:00:00.000Z";

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
    packView?: string;
    planView?: string;
    drafterView?: string;
    view?: string;
    report?: string;
    filter?: string;
    agent?: string;
  };
  const navigate = useNavigate();
  useLayoutEffect(() => {
    const hash = window.location.hash;
    const next = legacyHashDestination({ tab: search.tab, section: search.section }, hash);
    if (!next) return;
    void navigate({
      to: "/clients/$clientId",
      params: { clientId },
      search: (prev) => accountantClientTabSearch(prev, next.tab, { section: next.section }),
      hash: routerHash(hash),
      replace: true,
    });
  }, [search.tab, search.section, clientId, navigate]);
  const pane = legacyPaneForSearch(search) ?? "overview";
  useEffect(() => {
    if (pane !== "reports") return;
    const id =
      search.section === "drafts" ? "reports-drafts" : search.section === "sent" ? "reports-sent" : null;
    if (!id) return;
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [pane, search.section]);
  const [menuOpen, setMenuOpen] = useState(false);
  useAccountantDrawer(menuOpen, () => setMenuOpen(false));

  return (
    <div className={`accountant-portal${menuOpen ? " nav-open" : ""}`} data-rail-harness="true" data-rail-ready="true">
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
          <PeriodPill />
          <FeatureFinder audience="accountant" clientId={clientId} />
          <span className="spacer" />
          <SettingsMenu
            className="tb-btn settings-gear"
            onSettings={() => {
              setMenuOpen(false);
              void navigate({ to: "/settings" });
            }}
            onPlan={() => {
              setMenuOpen(false);
              void navigate({ to: "/settings", hash: "firm-billing" });
            }}
          />
          <span className="topbar-theme">
            <ThemeToggle />
          </span>
          <AccountantMenuButton open={menuOpen} onClick={() => setMenuOpen((open) => !open)} />
          <div className={`topbar-actions${menuOpen ? " open" : ""}`} />
        </div>
        <div className="crumb">
          <FirmDashboardCrumb linked={false} onBack={() => {}} />
          <span>/</span>
          <span>
            <b style={{ color: "var(--ink)" }}>Harbour Glass</b>
          </span>
          <HarnessCrumb clientId={clientId} pane={pane} section={search.section} />
        </div>
        <div className="client-workspace">
          <DrawerBackdrop open={menuOpen} onClose={() => setMenuOpen(false)} />
          <ClientRail clientId={clientId} search={search} onNavigate={() => setMenuOpen(false)} />
          <div className="deliverable-main">
            {(() => {
              const back = clientBackTarget({
                tab: pane,
                section: search.section,
                agent: search.agent,
              });
              return back ? <ClientBackLink clientId={clientId} label={back.label} tab={back.tab} /> : null;
            })()}
            <div data-notes-tray-slot="" className="notes-tray-slot" />
            {pane === "ask" || (pane === "overview" && search.agent) ? (
              <BotPane agent={search.agent} />
            ) : null}
            {pane === "overview" && !search.agent ? <BriefingPane /> : null}
            {pane === "moves" ? <MovesPane /> : null}
            {pane === "summary" ? <BooksPane clientId={clientId} /> : null}
            {pane === "ratios" ? <HealthPane clientId={clientId} /> : null}
            {pane === "profit" ? <ProfitPane clientId={clientId} /> : null}
            {pane === "cash" ? <CashPane clientId={clientId} /> : null}
            {pane === "budget" ? <BudgetPane clientId={clientId} /> : null}
            {pane === "plan" ? (
              <PlanPane
                clientId={clientId}
                planView={search.planView}
                initialFilter={search.filter === "overdue" ? "overdue" : undefined}
              />
            ) : null}
            {pane === "reports" ? (
              <ReportsPane clientId={clientId} packView={search.packView} />
            ) : null}
          </div>
        </div>
        <NoteLayer
          clientId={clientId}
          tab={pane === "overview" ? "overview" : pane}
          workspace="accountant"
          clientName="Harbour Glass"
          authorName="Harbour & Co"
        />
      </div>
    </div>
  );
}

function BotPane({ agent }: { agent?: string }) {
  const feed = useMilonTeamFeedStub("harbour-glass");
  const navigate = useNavigate();
  const selected =
    agent === "financial_manager" || agent === "analyst" || agent === "advisor" ? agent : null;
  useEffect(() => {
    const el = document.getElementById("ask-ai-accountant");
    if (!el || el.dataset.askAiMounted === "1") return;
    let cancelled = false;
    el.dataset.clientId = CLIENT_ID;
    el.innerHTML = "";
    void import("@/lib/ask-ai.js").then((mod: { mountAskAi?: (node: HTMLElement, opts: unknown) => void }) => {
      if (cancelled || typeof mod.mountAskAi !== "function" || el.dataset.askAiMounted === "1") return;
      el.dataset.askAiMounted = "1";
      mod.mountAskAi(el, {
        endpoint: "/__harness/bot-reply",
        botEndpoint: "/__harness/bot-reply",
        variant: "studio",
        audience: "accountant",
        getToken: async () => "harness",
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const open = (next: "financial_manager" | "analyst" | "advisor") => {
    void navigate({
      to: "/clients/$clientId",
      params: { clientId: CLIENT_ID },
      search: { tab: "home", agent: next },
    });
  };
  return (
    <div className="tabpane on" id="pane-ask">
      <div className="milon-desk-host">
        {selected ? (
          <AgentStage
            agent={selected}
            finding="Cash is on the 13-week forecast."
            onSelect={open}
            marketCountry="ZA"
            audience="accountant"
          >
            <AgentWork label="On this client" items={clientAgentWork(selected, CLIENT_ID)} />
            <MilonTeamDesk
              feed={feed}
              now={DESK_NOW}
              initialFilter={selected}
              presentation="agent"
              marketCountry="ZA"
              audience="accountant"
            />
          </AgentStage>
        ) : (
          <MilonTeamDesk
            feed={feed}
            now={DESK_NOW}
            initialFilter="all"
            marketCountry="ZA"
            audience="accountant"
          />
        )}
        <div id="ask-ai-accountant" className="ask-ai-studio-shell" />
      </div>
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

const HARNESS_DOCUMENTS: SourceDocumentsModel = {
  heading: "Documents",
  lede: "Source documents for this client. Approve a draft before anything posts to the ledger.",
  showUpload: false,
  duplicate: false,
  empty: null,
  primaryId: "doc-karoo",
  cards: [
    {
      id: "doc-karoo",
      fileName: "karoo-invoice.pdf",
      answer: "Karoo Traders invoice",
      detail: "Held for review.",
      holding: "Held in Milōn",
      progress: null,
      rows: [{ label: "Supplier", value: "Karoo Traders" }],
      lines: [],
      notes: [],
      approval: null,
      action: { kind: "quiet" },
    },
  ],
};

function BooksPane({ clientId }: { clientId: string }) {
  return (
    <div className="tabpane on" id="pane-summary">
      <div id="accounting-connect" className="data-fresh__ledgers">
        <QboConnectCard clientId={clientId} returnPath={`/clients/${clientId}`} financials={HARNESS_FINANCIALS} />
        <XeroConnectCard clientId={clientId} returnPath={`/clients/${clientId}`} financials={HARNESS_FINANCIALS} />
        <SageConnectCard clientId={clientId} />
      </div>
      <SourceDocumentsView model={HARNESS_DOCUMENTS} />
      <div id="wizard-brain-hero" className="card hero-card pad brain-hero">
        <span className="eyebrow">Client brain</span>
        <h2 className="h-sec" style={{ marginBottom: 6 }}>
          The background on Harbour Glass
        </h2>
        <p className="sub">
          This is the collection of context around this client. Source documents sit above it.
        </p>
      </div>
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
  const navigate = useNavigate();
  const books: OwnerBooks = {
    hasBooks: true,
    ledger: null,
    revenue: 420000,
    priorRevenue: null,
    cogs: 80000,
    priorCogs: null,
    receivables: null,
    cashflow: null,
    openAction: HARNESS_STEP.title,
    actionsReady: true,
    signedBy: null,
    signedOn: null,
    market: ZA_MARKET,
  };
  const open = (agent: AgentKey) => {
    void navigate({
      to: "/clients/$clientId",
      params: { clientId: CLIENT_ID },
      search: (prev) => ({ ...prev, tab: "home", agent }),
    });
  };
  const go = (tab: string, section?: string) => {
    void navigate({
      to: "/clients/$clientId",
      params: { clientId: CLIENT_ID },
      search: section ? { tab, section } : { tab },
    });
  };
  return (
    <div className="tabpane on" id="pane-overview">
      <div className="owner-door" data-client-home="true">
        <OwnerHome
          title="Your whole finance team"
          variant="character"
          showInvite={false}
          audience="accountant"
          marketCountry="ZA"
          presence={ownerPresence(emptyAgentActivity())}
          lines={ownerHomeLines(ownerAnswerTiles(books), harnessMoves()[0]?.title ?? null)}
          status={ownerCardStatuses(books)}
          onOpen={open}
          onAsk={open}
          needs={{
            actionsHeading: "Action plan",
            actionLines: [HARNESS_STEP.title],
            draftsHeading: "Drafts",
            draftLines: ["No draft waiting."],
            deliverablesHeading: "Reports",
            deliverableLines: ["Nothing ready to send."],
            syncHeading: "Books",
            syncLines: ["No books connected."],
          }}
          onMoves={() => go("plan")}
          onActions={() => go("plan")}
          onDrafts={() => go("reports", "drafts")}
          onDeliverables={() => go("reports")}
          onBooks={() => go("portal")}
          signoffLine={signoffStatusLine({ kind: "draft", scopeLabel: "Advisory" })}
        />
      </div>
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

function HealthPane({ clientId }: { clientId: string }) {
  const search = useSearch({ strict: false }) as { section?: string };
  const navigate = useNavigate();
  const section = search.section;
  const [healthDrill, setHealthDrill] = useState<{
    token: number;
    pillarId: "profit" | "assets" | "financing" | "cash";
  } | null>(null);
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
    includeScore: section === "pillars",
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
      {section !== "score" && section !== "pillars" ? (
        <>
          <ClientSectionOverview
            clientId={clientId}
            eyebrow="Numbers"
            title="Health"
            subtitle="Score and where it hurts each have their own page. The figures stay here."
            links={[
              {
                id: "score",
                label: "Score",
                detail: "The health score, with sign-off and the PDF.",
                search: (prev) => accountantClientTabSearch(prev, "health", { section: "score" }),
              },
              {
                id: "pillars",
                label: "Where it hurts",
                detail: "The pillars that pull the score down.",
                search: (prev) => accountantClientTabSearch(prev, "health", { section: "pillars" }),
              },
            ]}
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
        </>
      ) : null}
      {section === "score" ? (
        <ClientSubpageFrame
          id="score"
          eyebrow="Health"
          title="Score"
          subtitle="The health score for this client. Sign off and export the PDF from this page."
        >
          <DeliverableAnswerStrip
            heading="Health score"
            sentence={sentence}
            chip={chip}
            scope="financials"
            clientId={clientId}
            clientName="Harbour Glass"
            signoff={null}
            signoffKnown={false}
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
          <PaneBoundary label="Health score">
            <div className="health-plate">
              <SphereHero
                hideCaption
                overallHealth={Number.isFinite(avg) ? avg : Number.NaN}
                displayStatus={overall.displayStatus}
                pillars={spherePillars}
                drillTo={healthDrill}
                onDriverClick={() => undefined}
              />
            </div>
          </PaneBoundary>
        </ClientSubpageFrame>
      ) : null}
      {section === "pillars" ? (
        <ClientSubpageFrame
          id="pillars"
          eyebrow="Health"
          title="Where it hurts"
          subtitle="The pillars that pull the score down."
        >
          <div className="health-plate">
            <SimplifiedRatios
              sections={sections}
              onOpenPillar={(id) => {
                if (id !== "profit" && id !== "assets" && id !== "financing" && id !== "cash") return;
                setHealthDrill({ token: Date.now(), pillarId: id });
                void navigate({
                  to: "/clients/$clientId",
                  params: { clientId },
                  search: (prev) => accountantClientTabSearch(prev, "health", { section: "score" }),
                });
              }}
            />
          </div>
        </ClientSubpageFrame>
      ) : null}
    </div>
  );
}

function ProfitPane({ clientId }: { clientId: string }) {
  const search = useSearch({ strict: false }) as { section?: string };
  const meta = readStatementMeta(HARNESS_FINANCIALS);
  const preferPeriod = preferStatementPeriod(HARNESS_FINANCIALS);
  const [profitExport, setProfitExport] = useState<WaterfallExportApi | null>(null);
  const section = search.section;
  return (
    <div className="tabpane on" id="pane-profit">
      {section !== "waterfall" && section !== "lines" ? (
        <ClientSectionOverview
          clientId={clientId}
          eyebrow="Profit"
          title="Profit"
          subtitle="The waterfall and the product lines each have their own page."
          links={[
            {
              id: "waterfall",
              label: "Waterfall",
              detail: "Where profit goes, from revenue down to the bottom line.",
              search: (prev) => accountantClientTabSearch(prev, "profit", { section: "waterfall" }),
            },
            {
              id: "lines",
              label: "Product lines",
              detail: "Revenue and net profit by product line.",
              search: (prev) => accountantClientTabSearch(prev, "profit", { section: "lines" }),
            },
          ]}
        />
      ) : null}
      {section === "lines" ? (
        <ClientSubpageFrame
          id="lines"
          eyebrow="Profit"
          title="Product lines"
          subtitle="Revenue and net profit by product line, so you can see which lines actually make the money."
        >
          <ProductMixPanel
            totalRevenue={420000}
            incentive="Answer these to build revenue and net profit per product line."
          />
        </ClientSubpageFrame>
      ) : null}
      {section === "waterfall" ? (
        <ClientSubpageFrame
          id="waterfall"
          eyebrow="Profit"
          title="Waterfall"
          subtitle="Where profit goes, from revenue down to the bottom line. Sign off and export from here."
        >
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
            signoff={{
              id: "harness-signoff-profitability",
              client_id: clientId,
              scope: "profitability",
              signed_off_by_id: "harness-local-user",
              signed_off_by_name: "Ada Mbeki",
              signed_off_by_initials: "AM",
              signed_off_by_title: null,
              firm_name: "Harbour & Co",
              note: null,
              signature_data: null,
              signed_off_at: "2026-10-02T08:00:00.000Z",
            }}
            signoffKnown
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
            <p className="sub" style={{ marginTop: 12 }}>
              <Link
                to="/clients/$clientId"
                params={{ clientId }}
                search={(prev) => accountantClientTabSearch(prev, "health")}
              >
                Edit the period figures on Health.
              </Link>
            </p>
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
        </ClientSubpageFrame>
      ) : null}
    </div>
  );
}

const HARNESS_ARAP = {
  receivables: 92000,
  payables: 41000,
  debtorDays: 48,
  creditorDays: 31,
};

/**
 * Overview tiles read the same fixture the other panes already use.
 * The hand-built snapshot only has cash, revenue, and runway, so profit,
 * collections, payables, budget, and books stay blank unless filled here.
 */
function harnessOverviewCards(snapshot: readonly { key: string; value: string }[]) {
  const revenue = Number(HARNESS_FINANCIALS.revenue);
  const cogs = Number(HARNESS_FINANCIALS.cogs);
  const fixedCosts = Number(HARNESS_FINANCIALS.fixedCosts);
  const operatingMargin = (revenue - cogs - fixedCosts) / revenue;
  const marginSnapshot = buildFinancialSnapshot({
    chips: buildVarianceChips({
      currentFinancials: HARNESS_FINANCIALS,
      currentRatios: { "Operating Margin": operatingMargin },
      prior: null,
    }),
    financialsUpdatedAt: HARNESS_FIGURES_UPDATED_AT,
    periodLabel: HARNESS_FINANCIALS.periodLabel,
    datedPeriod: true,
    market: ZA_MARKET,
  });
  const booksPeriod = booksCoverPeriod(HARNESS_BOOKS_FRESHNESS);
  const qualification: BudgetQualification = {
    payMotion: "mix",
    volumeUnit: "units_sku",
    driverKind: "units_price",
    costShape: "balanced",
    debtorDaysDefault: HARNESS_ARAP.debtorDays,
    capexMode: "none",
    confirmedAt: HARNESS_FIGURES_UPDATED_AT,
  };
  const seeded = seedBudgetFromFinancials(
    createBudgetDocument({
      templateId: "hybrid_primary",
      qualification,
      fyStartMonth: ZA_MARKET.fyStartMonthDefault,
      ref: new Date("2026-09-30T12:00:00.000Z"),
      market: ZA_MARKET,
    }),
    {
      ...HARNESS_FINANCIALS,
      receivables: String(HARNESS_ARAP.receivables),
      payables: String(HARNESS_ARAP.payables),
      periodMonths: "1",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
    },
  );
  const compared = budgetVersusStatement(seeded.doc, {
    ...HARNESS_FINANCIALS,
    ebit: String(revenue - cogs - fixedCosts),
    periodMonths: "1",
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
  });
  const budget = overviewBudgetTileFigure({
    budgetRevenue: compared?.budgetRevenue,
    actualRevenue: compared?.revenue,
    seeded: budgetSeededFromStatement(compared),
    money: (amount) => formatMoneyCompact(amount, ZA_MARKET),
  });
  const books = booksTileLines({
    period: booksPeriod ?? snapshotFigure(marginSnapshot, "updated"),
    source: HARNESS_FINANCIALS.statementSource,
    sourceLabel: figureSourceChipLabel(HARNESS_FINANCIALS.statementSource),
    syncedStamp: snapshotFigure(marginSnapshot, "updated"),
  });
  return overviewSectionCards(
    {
      health: healthHeadline(72, "Stable"),
      cash: overviewCashTileFigure({
        headline: "No shortfall",
        opening: Number(HARNESS_FINANCIALS.cash),
        lowest: Number(HARNESS_FINANCIALS.cash),
        lowestIsOpening: true,
        money: (amount) => formatMoneyCompact(amount, ZA_MARKET),
      }),
      profit: snapshotFigure(marginSnapshot, "om"),
      collections: storedAmountFigure(HARNESS_ARAP.receivables, (amount) =>
        statementArApMoney(amount, ZA_MARKET),
      ),
      payables: storedAmountFigure(HARNESS_ARAP.payables, (amount) =>
        statementArApMoney(amount, ZA_MARKET),
      ),
      budget,
      moves: harnessMoves()[0]?.title ?? null,
      books: books.figure,
    },
    books.detail ? { books: books.detail } : undefined,
  );
}

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
    <section id="pane-collections" aria-label="Who to chase" className="mt-8">
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
    </section>
  );
}

function PayablesPane({ aged }: { aged: boolean }) {
  return (
    <section id="pane-payables" aria-label="Who to pay" className="mt-8">
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
    </section>
  );
}

function CashPane({ clientId }: { clientId: string }) {
  const search = useSearch({ strict: false }) as { section?: string; aged?: string | number };
  const aged = search.aged === 1 || search.aged === "1";
  const section = search.section;
  return (
    <div className="tabpane on" id="pane-cash">
      {section !== "forecast" && section !== "collections" && section !== "payables" ? (
        <ClientSectionOverview
          clientId={clientId}
          eyebrow="Numbers"
          title="Cash flow"
          subtitle="The forecast, who to chase, and who to pay each have their own page."
          links={[
            {
              id: "forecast",
              label: "13-week forecast",
              detail: "Thirteen weeks of cash, with sign-off on this page.",
              search: (prev) => accountantClientTabSearch(prev, "cash", { section: "forecast" }),
            },
            {
              id: "collections",
              label: "Who to chase",
              detail: "Debtors to collect.",
              search: (prev) => accountantClientTabSearch(prev, "cash", { section: "collections" }),
            },
            {
              id: "payables",
              label: "Who to pay",
              detail: "Bills to schedule against the cash you have.",
              search: (prev) => accountantClientTabSearch(prev, "cash", { section: "payables" }),
            },
          ]}
        />
      ) : null}
      {section === "forecast" ? (
        <ClientSubpageFrame
          id="forecast"
          eyebrow="Cash flow"
          title="13-week forecast"
          subtitle="Thirteen weeks of cash. Sign off and export from this page."
        >
          <div className="card cf-wrap" id="wizard-cash-panel">
            <PaneBoundary label="Cash forecast">
              <CashForecastPanel
                clientId={clientId}
                clientName="Harbour Glass"
                canSign
                hideReadOnlyStamp
                signoffKnown
                signoff={{
                  id: "harness-signoff-cash",
                  client_id: clientId,
                  scope: "cash_forecast",
                  signed_off_by_id: "harness-local-user",
                  signed_off_by_name: "Ada Mbeki",
                  signed_off_by_initials: "AM",
                  signed_off_by_title: null,
                  firm_name: "Harbour & Co",
                  note: null,
                  signature_data: null,
                  signed_off_at: "2026-10-02T08:00:00.000Z",
                }}
                statementChip={figureSourceChipLabel(HARNESS_FINANCIALS.statementSource)}
              />
            </PaneBoundary>
          </div>
        </ClientSubpageFrame>
      ) : null}
      {section === "collections" ? (
        <ClientSubpageFrame
          id="collections"
          eyebrow="Cash flow"
          title="Who to chase"
          subtitle="Debtors to collect, with the controls for this list."
        >
          <CollectionsPane aged={aged} />
        </ClientSubpageFrame>
      ) : null}
      {section === "payables" ? (
        <ClientSubpageFrame
          id="payables"
          eyebrow="Cash flow"
          title="Who to pay"
          subtitle="Bills to schedule against the cash you have."
        >
          <PayablesPane aged={aged} />
        </ClientSubpageFrame>
      ) : null}
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
        <CashForecastPanel
          clientId={clientId}
          clientName="Harbour Glass"
          canSign={false}
          hideReadOnlyStamp
          statementChip={figureSourceChipLabel(HARNESS_FINANCIALS.statementSource)}
        />
      </PaneBoundary>
    </div>
  );
}

/** Harness-only month actuals so the chart can show variance. Not stored. */
const HARNESS_BUDGET_ACTUALS: readonly BudgetActualMonth[] = [
  ["2026-03", 38000, 6000, 10000],
  ["2026-04", 30000, 9000, 14000],
  ["2026-05", 36000, 6500, 11000],
  ["2026-06", 28000, 8000, 13000],
  ["2026-07", 40000, 6200, 10500],
  ["2026-08", 34000, 7000, 12000],
].map(([month, revenue, cogs, overheads]) => ({
  month: String(month),
  totals: {
    revenue: Number(revenue),
    cogs: Number(cogs),
    grossProfit: Number(revenue) - Number(cogs),
    overheadsTotal: Number(overheads),
    overheadsOps: Number(overheads),
    depreciation: 0,
    ebit: Number(revenue) - Number(cogs) - Number(overheads),
  },
}));

function BudgetPane({ clientId }: { clientId: string }) {
  const search = useSearch({ strict: false }) as { section?: string; view?: string };
  const navigate = useNavigate();
  const section = search.section === "months" || search.view === "table" ? "months" : search.section;
  return (
    <div className="tabpane on" id="pane-budget">
      {section !== "year" && section !== "months" ? (
        <ClientSectionOverview
          clientId={clientId}
          eyebrow="Numbers"
          title="Budget"
          subtitle="This year and the month-by-month view each have their own page."
          links={[
            {
              id: "year",
              label: "This year",
              detail: "The year on one chart.",
              search: (prev) => accountantClientTabSearch(prev, "budget", { section: "year" }),
            },
            {
              id: "months",
              label: "Month by month",
              detail: "Every month in a table.",
              search: (prev) => accountantClientTabSearch(prev, "budget", { section: "months" }),
            },
          ]}
        />
      ) : (
        <ClientSubpageFrame
          id={section}
          eyebrow="Budget"
          title={section === "months" ? "Month by month" : "This year"}
          subtitle={
            section === "months"
              ? "Every month in a table. Sign off from this page."
              : "The year on one chart. Sign off from this page."
          }
        >
          <PaneBoundary label="Budget">
            <BudgetPanel
              clientId={clientId}
              clientName="Harbour Glass"
              role="accountant"
              canSign
              hideInlineSignOff
              signoffKnown={false}
              simplified
              financials={{ revenue: "420000", cogs: "80000", fixedCosts: "140000", cash: "186000" }}
              fyStartMonthDefault={3}
              lens={section === "months" ? "table" : "chart"}
              onLensChange={(next) => {
                void navigate({
                  to: "/clients/$clientId",
                  params: { clientId },
                  search: (prev) =>
                    accountantClientTabSearch(prev, "budget", {
                      section: next === "table" ? "months" : "year",
                    }),
                  replace: true,
                });
              }}
              actualMonths={HARNESS_BUDGET_ACTUALS}
            />
          </PaneBoundary>
        </ClientSubpageFrame>
      )}
    </div>
  );
}

const HARNESS_CRUMB: Record<string, { label: string; tab: string }> = {
  overview: { label: "Home", tab: "home" },
  ask: { label: "Home", tab: "home" },
  ratios: { label: "Health", tab: "health" },
  cash: { label: "Cash flow", tab: "cash" },
  profit: { label: "Profit", tab: "profit" },
  budget: { label: "Budget", tab: "budget" },
  moves: { label: "Next moves", tab: "moves" },
  plan: { label: "Action plan", tab: "plan" },
  reports: { label: "Reports", tab: "reports" },
  summary: { label: "Books", tab: "portal" },
};

const HARNESS_SECTION_LABEL: Record<string, string> = {
  score: "Score",
  pillars: "Where it hurts",
  forecast: "13-week forecast",
  collections: "Who to chase",
  payables: "Who to pay",
  waterfall: "Waterfall",
  lines: "Product lines",
  year: "This year",
  months: "Month by month",
  open: "Open work",
  overdue: "Overdue",
  drafts: "Drafts",
  sent: "Sent",
  documents: "Documents",
  connections: "Connections",
};

function HarnessCrumb({
  clientId,
  pane,
  section,
}: {
  clientId: string;
  pane: string;
  section?: string;
}) {
  const parent = HARNESS_CRUMB[pane];
  if (!parent || pane === "overview") return null;
  const child = section ? (HARNESS_SECTION_LABEL[section] ?? null) : null;
  return (
    <>
      <span>/</span>
      {child ? (
        <Link
          to="/clients/$clientId"
          params={{ clientId }}
          search={(prev) => accountantClientTabSearch(prev, parent.tab)}
          className="crumb-link"
        >
          {parent.label}
        </Link>
      ) : (
        <b style={{ color: "var(--ink)" }}>{parent.label}</b>
      )}
      {child ? (
        <>
          <span>/</span>
          <b style={{ color: "var(--ink)" }}>{child}</b>
        </>
      ) : null}
    </>
  );
}

function harnessPackAction(status: PackAnswerStatus, signedBy: string | null): AdvisorySignoffAction {
  return {
    state: {
      status,
      version: 3,
      signedBy,
      firmName: "Harbour & Co",
      signedAt: signedBy ? "2026-10-02T08:00:00.000Z" : null,
      zone: "Africa/Johannesburg",
      reviewedByKind: "accountant",
    },
    line: null,
    canSignOff: status === "draft" || status === "in_review",
    blocked: false,
    busy: false,
    signOff: () => {},
  };
}

function ReportsPane({ clientId, packView }: { clientId: string; packView?: string }) {
  const cycleSection = {
    key: "last_cycle_results",
    title: "What the last cycle achieved",
    body: "No recommendations were actioned in the last cycle, so there is nothing to measure yet. From the next pack on, this section reports whether the moves you accepted actually moved the numbers. Expected versus actual comes from the statements, not from memory. The right edge of this paragraph has to stay readable when the share button sits over the last lines. Collections, cash, and the health score are unchanged by this note. A signed pack still names who reviewed it and when.",
  };
  const fixture =
    packView === "cycle"
      ? {
          periodLabel: "September 2026",
          sectionCount: 1,
          status: "draft" as const,
          signedBy: null,
          version: 3,
          sections: [cycleSection],
        }
      : packView === "draft"
      ? { periodLabel: "September 2026", sectionCount: 6, status: "draft" as const, signedBy: null, version: 3 }
      : packView === "ready"
        ? { periodLabel: "September 2026", sectionCount: 6, status: "in_review" as const, signedBy: null, version: 3 }
        : packView === "stale"
          ? {
              periodLabel: "September 2026",
              sectionCount: 6,
              status: "signed_stale" as const,
              signedBy: "Ada Mbeki",
              signedDate: "2 Oct 2026",
              version: 3,
            }
          : null;
  return (
    <div className="tabpane on" id="pane-reports">
      <section id="reports-drafts" className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-[#102A43] dark:text-[#F4F7FB]">
          Drafts
        </h2>
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
          chip={figureSourceChipLabel("upload")}
          fixture={fixture}
          primary={
            fixture ? (
              <AdvisoryTabSignoff
                hideLine
                action={harnessPackAction(fixture.status, fixture.signedBy ?? null)}
                pageSignoff={null}
              />
            ) : null
          }
          inputs={
            <DeliverableInputConfig
              clientId={clientId}
              deliverableId="advisory"
              context={{ financials: HARNESS_FINANCIALS }}
            />
          }
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
      <section className="mb-5 rounded-2xl border border-[#DBEAFE] bg-white p-4 shadow-sm dark:border-[#1e3a5f] dark:bg-[#102A43]">
        <PaneBoundary label="Advisory drafter">
          <AdvisoryDrafter clientId={clientId} clientName="Harbour Glass" />
        </PaneBoundary>
      </section>
      </section>
      <section id="reports-pdfs">
        <PaneBoundary label="Reports">
          <ReportsStudio
            embedded
            client="Harbour Glass"
            clientId={clientId}
            sourceChip={figureSourceChipLabel("upload")}
          />
        </PaneBoundary>
      </section>
      <section id="reports-sent" className="mt-8">
        <PaneBoundary label="Sent history">
          <AdvisorySentHistory clientId={clientId} />
        </PaneBoundary>
      </section>
    </div>
  );
}

function PlanPane({
  clientId,
  planView,
  initialFilter,
}: {
  clientId: string;
  planView?: string;
  initialFilter?: "overdue";
}) {
  const [sentence, setSentence] = useState("");
  const [planKnown, setPlanKnown] = useState(false);
  const [planCount, setPlanCount] = useState(0);
  const focusAdd = useRef<(() => void) | null>(null);
  const signoff =
    planView === "signed"
      ? {
          id: "harness-plan-signoff",
          client_id: clientId,
          scope: "action_plan" as const,
          signed_off_by_id: "harness-local-user",
          signed_off_by_name: "Ada Mbeki",
          signed_off_by_initials: "AM",
          signed_off_by_title: null,
          firm_name: "Harbour & Co",
          note: null,
          signature_data: null,
          signed_off_at: "2026-10-02T08:00:00.000Z",
        }
      : null;
  return (
    <div className="tabpane on" id="pane-plan">
      <section className="mb-5 rounded-2xl border border-[#DBEAFE] bg-white p-4 shadow-sm dark:border-[#1e3a5f] dark:bg-[#102A43]">
      <DeliverableAnswerStrip
        heading="Action plan"
        sentence={planKnown ? sentence : ""}
        scope="action_plan"
        clientId={clientId}
        clientName="Harbour Glass"
        signoff={signoff}
        isStale={false}
        onSignoffChange={() => {}}
        canSign={planCount > 0}
        signoffVerbOnly
        extraActions={
          planKnown && planCount === 0 ? (
            <button type="button" className={ARAP_GOLD_BTN} onClick={() => focusAdd.current?.()}>
              Add action
            </button>
          ) : null
        }
      />
      <ReviewInputsDrawer hint={deliverableDrawerHint("plan", { financials: HARNESS_FINANCIALS })}>
        <DeliverableInputConfig
          clientId={clientId}
          deliverableId="plan"
          context={{ financials: HARNESS_FINANCIALS }}
        />
      </ReviewInputsDrawer>
      </section>
      <PaneBoundary label="Action plan">
        <ActionPlanPanel
          clientId={clientId}
          clientName="Harbour Glass"
          simplified
          isOwner
          initialFilter={initialFilter}
          onAnswer={(actions) => {
            setPlanKnown(true);
            setPlanCount(actions.length);
            setSentence(planAnswerSentence(actions));
          }}
          onRegisterAdd={(focus) => {
            focusAdd.current = focus;
          }}
        />
      </PaneBoundary>
    </div>
  );
}
