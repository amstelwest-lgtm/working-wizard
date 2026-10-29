import {
  Outlet,
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { accountantValidatedSearch } from "@/lib/client-route-search";
import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { toast, Toaster } from "sonner";
import { AccountantProfileProvider } from "@/contexts/accountant-profile";
import { NotesProvider } from "@/contexts/notes";
import { MarketProvider } from "@/contexts/market";
import { AuthProvider } from "@/hooks/use-auth";
import { applyPortalTheme, resolvePortalTheme } from "@/lib/portal-theme";
import appCss from "@/styles.css?url";
import { authenticatedLayoutLinks, founderPortalLinks } from "@/styles/app-route-styles";
import { ShareButton } from "@/components/share";
import { FloatingNoteButton } from "@/components/floating-note-button";
import { NoteLayer } from "@/components/note-layer";
import type { ClientNote } from "@/lib/notes.functions";
import { StaffInvitePreview } from "./invite-preview";
import { ImportLowsPreview } from "./import-lows-preview";
import { MilonTeamDeskPage } from "./milon-team-desk-page";
import { AgentStagePreview } from "./agent-stage-preview";
import { OwnerCashBoard, RailStudio } from "./studio";
import { OwnerDoorPreview, type OwnerPreviewView } from "./owner-door-preview";
import { ProofLandingPreview } from "./proof-preview";
import { PersonaCritPreview } from "./persona-crit-preview";
import { Retest560Preview } from "./retest-560-preview";
import { FmBriefPreview } from "./fm-brief-preview";
import { PracticeTodayPreview } from "./practice-today-preview";
import { ActionPlanPreview } from "./action-plan-preview";
import { CashForecastPanel } from "@/components/cash-forecast";
import { Retest568Preview } from "./retest-568-preview";
import { FinalWalkPreview } from "./final-walk-preview";
import { Retest578Preview } from "./retest-578-preview";
import { AqaFollowupPreview } from "./aqa-followup-preview";
import { AqaRetest573Preview } from "./aqa-retest-573-preview";
import { AqaPracticePreview } from "./aqa-practice-preview";
import { WalkthroughPreview } from "./walkthrough-preview";
import { TaxPackPreview } from "./tax-pack-preview";
import { Route as DashboardRoute } from "@/routes/_authenticated/dashboard";
import { Route as ClientsIndexRoute } from "@/routes/_authenticated/clients.index";
import { Route as PracticeRoute } from "@/routes/_authenticated/practice";
import { ReportsStudio } from "@/routes/_authenticated/reports-studio";
import { Route as SettingsRoute } from "@/routes/_authenticated/settings.index";
import { Route as TeamRoute } from "@/routes/_authenticated/settings.team";
import { Route as BrandRoute } from "@/routes/_authenticated/settings.brand";

const Dashboard = DashboardRoute.options.component as ComponentType;
const ClientsIndex = ClientsIndexRoute.options.component as ComponentType;
const PracticePage = PracticeRoute.options.component as ComponentType;
const SettingsPage = SettingsRoute.options.component as ComponentType;
const TeamAccessPage = TeamRoute.options.component as ComponentType;
const BrandPage = BrandRoute.options.component as ComponentType;

const HARNESS_PREVIEW_NOTES: ClientNote[] = [
  {
    id: "harness-note-1",
    clientId: "harness-client",
    tab: "overview",
    x: 48,
    y: 220,
    ratioKey: null,
    text: "Check the health figure before the next review.",
    authorId: "harness",
    author: "Harbour & Co",
    authorEmail: null,
    timestamp: "2026-10-08T08:00:00.000Z",
    resolved: false,
    taggedMilonIt: false,
    mentions: [],
    replies: [],
  },
  ...(["today", "waterfall", "cash", "budget", "tasks"] as const).map((tab) => ({
    id: `harness-note-${tab}`,
    clientId: "harness-client",
    tab,
    x: 48,
    y: 220,
    ratioKey: null,
    text: "Check this figure before the next review.",
    authorId: "harness",
    author: "Harbour & Co",
    authorEmail: null,
    timestamp: "2026-10-08T08:00:00.000Z",
    resolved: false,
    taggedMilonIt: false,
    mentions: [],
    replies: [],
  })),
];

// Light is the default. Dark only after an explicit theme_pref_v2 choice.
applyPortalTheme(resolvePortalTheme());

// The local stub rejects server calls with "harness-local". Keep those out of
// the screenshots. App toast code is unchanged.
const hideHarnessToast = (message: unknown) => String(message ?? "").includes("harness-local");
const toastError = toast.error.bind(toast);
toast.error = ((message, data) => {
  if (hideHarnessToast(message)) return "";
  return toastError(message, data);
}) as typeof toast.error;

// Same sheets as `__root` (styles.css) plus `/_authenticated` head links.
// The client route itself adds none; #370 moved those onto the layout.
const sheetHrefs = [
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,500;1,600&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=Noto+Sans:wght@300;400;500;600;700;800&display=swap",
  appCss,
  ...authenticatedLayoutLinks.flatMap((link) => (link.rel === "stylesheet" ? [link.href] : [])),
  ...founderPortalLinks.map((link) => link.href),
];
for (const href of sheetHrefs) {
  const el = document.createElement("link");
  el.rel = "stylesheet";
  el.href = href;
  document.head.appendChild(el);
}

const rootRoute = createRootRoute({
  component: () => (
    <AuthProvider>
      <AccountantProfileProvider>
        <NotesProvider previewNotes={HARNESS_PREVIEW_NOTES}>
          <Outlet />
          <ShareButton />
          <FloatingNoteButton />
          <Toaster />
        </NotesProvider>
      </AccountantProfileProvider>
    </AuthProvider>
  ),
});
const clientRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clients/$clientId",
  validateSearch: (search: Record<string, unknown>) => {
    const shaped = accountantValidatedSearch(search);
    return {
      tab: shaped.tab,
      section: shaped.section,
      focus: shaped.focus,
      report: shaped.report,
      filter: shaped.tab ? shaped.filter : search.filter === "overdue" ? "overdue" : undefined,
      agent:
        search.agent === "financial_manager" || search.agent === "analyst" || search.agent === "advisor"
          ? search.agent
          : undefined,
      aged: search.aged === 1 || search.aged === "1" ? 1 : undefined,
      packView:
        search.packView === "draft" ||
        search.packView === "ready" ||
        search.packView === "stale" ||
        search.packView === "cycle"
          ? search.packView
          : undefined,
      planView:
        search.planView === "empty" || search.planView === "signed" ? search.planView : undefined,
      drafterView: search.drafterView === "sent" ? "sent" : undefined,
      view:
        search.view === "table" ||
        search.view === "13week" ||
        search.view === "chart" ||
        search.view === "progress" ||
        search.view === "books"
          ? search.view
          : undefined,
    };
  },
  component: function ClientHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <RailStudio />
      </MarketProvider>
    );
  },
});

const ownerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app",
  component: function OwnerHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <OwnerCashBoard clientId="harness-client" />
      </MarketProvider>
    );
  },
});

const agentStageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/agent-stage",
  component: AgentStagePreview,
});

const teamDeskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/milon-team-desk",
  validateSearch: (search: Record<string, unknown>) => ({
    fixture:
      search.fixture === "empty" ? "empty" : search.fixture === "live" ? "live" : "populated",
    agent:
      search.agent === "financial_manager" ||
      search.agent === "analyst" ||
      search.agent === "advisor" ||
      search.agent === "tax_specialist"
        ? search.agent
        : undefined,
  }),
  component: MilonTeamDeskPage,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite",
  validateSearch: (search: Record<string, unknown>) => ({
    view:
      search.view === "create" || search.view === "revoked" || search.view === "workspace"
        ? search.view
        : "landing",
  }),
  component: function InviteHarness() {
    const search = useSearch({ strict: false }) as {
      view?: "landing" | "create" | "revoked" | "workspace";
    };
    return <StaffInvitePreview view={search.view ?? "landing"} />;
  },
});

const ownerDoorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/owner-door",
  validateSearch: (search: Record<string, unknown>) => ({
    view: (
      [
        "rest",
        "work",
        "chat",
        "ask",
        "reel",
        "recording",
        "actions",
        "accountant",
        "deliverables",
        "plan",
        "first",
        "health",
        "cash",
        "budget",
        "tasks",
        "profit",
        "moves",
        "faces",
        "settings",
      ].includes(String(search.view))
        ? String(search.view)
        : "rest"
    ) as OwnerPreviewView,
    bot:
      search.bot === "financial_manager" || search.bot === "analyst" || search.bot === "advisor"
        ? search.bot
        : undefined,
    budgetCase:
      search.budgetCase === "empty" || search.budgetCase === "draft" ? search.budgetCase : "ready",
    signoff:
      search.signoff === "signed" || search.signoff === "unsigned" || search.signoff === "stale"
        ? search.signoff
        : undefined,
    bots: search.bots === "stack" ? "stack" : search.bots === "row" ? "row" : undefined,
    bill:
      search.bill === "none" ||
      search.bill === "stripe" ||
      search.bill === "firm" ||
      search.bill === "unavailable"
        ? search.bill
        : undefined,
  }),
  component: function OwnerDoorHarness() {
    const search = useSearch({ strict: false }) as {
      view?: OwnerPreviewView;
      bot?: "financial_manager" | "analyst" | "advisor";
      budgetCase?: "ready" | "empty" | "draft";
      bill?: "none" | "stripe" | "firm" | "unavailable";
    };
    const navigate = useNavigate();
    const noteTab =
      search.view === "cash"
        ? "cash"
        : search.view === "profit"
          ? "waterfall"
          : search.view === "budget"
            ? "budget"
            : search.view === "tasks" || search.view === "actions" || search.view === "moves"
              ? "tasks"
              : "today";
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <main className="min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
          <div id="board-pack" className="founder-shell mx-auto py-5 lg:py-7">
            <OwnerDoorPreview
              view={search.view ?? "rest"}
              bot={search.bot ?? null}
              budgetCase={search.budgetCase ?? "ready"}
              bill={search.bill}
              onBot={(next, mode) => {
                void navigate({
                  to: "/owner-door",
                  search: (prev) => {
                    const view = prev.view ?? "rest";
                    if (next) return { view, bot: next };
                    return { view };
                  },
                  replace: mode === "replace",
                });
              }}
            />
          </div>
        </main>
        <NoteLayer
          clientId="harness-client"
          tab={noteTab}
          workspace="owner"
          authorName="Theo"
          clientName="Karoo Traders"
        />
      </MarketProvider>
    );
  },
});

const importLowsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/import-lows",
  component: function ImportLowsHarness() {
    return (
      <MarketProvider selection={{ country: "US", regionCode: "NY" }}>
        <ImportLowsPreview />
      </MarketProvider>
    );
  },
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  component: function DashboardHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <Dashboard />
      </MarketProvider>
    );
  },
});

const clientsIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/clients",
  component: function ClientsHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <ClientsIndex />
      </MarketProvider>
    );
  },
});

const practiceOverviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice",
  component: function PracticeHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <PracticePage />
      </MarketProvider>
    );
  },
});

const settingsTeamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/team",
  component: function SettingsTeamHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <TeamAccessPage />
      </MarketProvider>
    );
  },
});

const settingsBrandRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/brand",
  component: function SettingsBrandHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <BrandPage />
      </MarketProvider>
    );
  },
});

const deskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/desk",
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reports",
  validateSearch: (search: Record<string, unknown>) => ({
    client: typeof search.client === "string" ? search.client : undefined,
    clientId: typeof search.clientId === "string" ? search.clientId : undefined,
    report: typeof search.report === "string" ? search.report : undefined,
    action: search.action === "preview" || search.action === "download" ? search.action : undefined,
    emptyClient: search.emptyClient === "1" || search.emptyClient === 1 ? "1" : undefined,
  }),
  component: function ReportsHarness() {
    const search = useSearch({ strict: false }) as {
      client?: string;
      clientId?: string;
      report?: string;
      action?: "preview" | "download";
      emptyClient?: "1";
    };
    const emptyForecast = search.emptyClient === "1" && search.report === "forecast";
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <div
          className="accountant-portal practice-home"
          style={emptyForecast ? { background: "#ffffff", minHeight: "100vh" } : undefined}
        >
          <div className="shell">
            <ReportsStudio
              client={search.client}
              clientId={search.clientId}
              report={search.report}
              action={search.action}
              embedded={emptyForecast || undefined}
              onlyKeys={emptyForecast ? ["forecast"] : undefined}
            />
          </div>
        </div>
      </MarketProvider>
    );
  },
});

const fmBriefRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/fm-brief",
  component: function FmBriefHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <FmBriefPreview />
      </MarketProvider>
    );
  },
});

const practiceTodayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice-today",
  component: PracticeTodayPreview,
});

const personaCritRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/persona-crit",
  component: function PersonaCritHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <PersonaCritPreview />
      </MarketProvider>
    );
  },
});

const retest560Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/retest-560",
  component: Retest560Preview,
});

const actionPlanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/action-plan",
  component: function ActionPlanHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <ActionPlanPreview />
      </MarketProvider>
    );
  },
});

const cashSuggestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cash-suggest",
  component: function CashSuggestHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <div className="min-h-screen bg-[#F4F7FB] p-4">
          <p className="mb-3 text-xs uppercase tracking-[0.16em] text-[#102A43]">
            Fixture proof — not a client file
          </p>
          <CashForecastPanel clientId="harness-client" clientName="Harbour Glass" />
        </div>
      </MarketProvider>
    );
  },
});

const cashOnceOffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cash-once-off",
  component: function CashOnceOffHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <div className="min-h-screen bg-[#F4F7FB] p-4">
          <p className="mb-3 text-xs uppercase tracking-[0.16em] text-[#102A43]">
            Fixture proof — not a client file
          </p>
          <CashForecastPanel clientId="harness-client" clientName="Harbour Glass" />
        </div>
      </MarketProvider>
    );
  },
});

const retest568Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/retest-568",
  component: Retest568Preview,
});

const aqaRetest573Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/aqa-retest-573",
  component: function AqaRetest573Harness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <AqaRetest573Preview />
      </MarketProvider>
    );
  },
});

const retest578Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/retest-578",
  component: function Retest578Harness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <Retest578Preview />
      </MarketProvider>
    );
  },
});

const finalWalkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/final-walk",
  component: function FinalWalkHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <FinalWalkPreview />
      </MarketProvider>
    );
  },
});

const aqaPracticeNavRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/aqa-practice-nav",
  validateSearch: (search: Record<string, unknown>) => ({
    shot: typeof search.shot === "string" ? search.shot : "after-nav",
    closed: search.closed === "1" || search.closed === 1 ? ("1" as const) : undefined,
  }),
  component: function AqaPracticeNavHarness() {
    const search = useSearch({ strict: false }) as { shot?: string; closed?: "1" };
    return (
      <AqaPracticePreview shot={search.shot ?? "after-nav"} closed={search.closed === "1"} />
    );
  },
});

const aqaFollowupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/aqa-followup",
  component: function AqaFollowupHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <AqaFollowupPreview />
      </MarketProvider>
    );
  },
});

const walkthroughRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/walkthrough",
  component: function WalkthroughHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <WalkthroughPreview />
      </MarketProvider>
    );
  },
});

const taxPackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tax-pack",
  validateSearch: (search: Record<string, unknown>) => ({
    view: search.view === "draft" ? ("draft" as const) : ("profile" as const),
  }),
  component: function TaxPackHarness() {
    const search = useSearch({ strict: false }) as { view?: "profile" | "draft" };
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <TaxPackPreview view={search.view ?? "profile"} />
      </MarketProvider>
    );
  },
});

const proofLandingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/proof-landing",
  component: ProofLandingPreview,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: function SettingsHarness() {
    return (
      <MarketProvider selection={{ country: "ZA", regionCode: null }}>
        <SettingsPage />
      </MarketProvider>
    );
  },
});

const routeTree = rootRoute.addChildren([
  clientRoute,
  ownerRoute,
  teamDeskRoute,
  agentStageRoute,
  inviteRoute,
  importLowsRoute,
  ownerDoorRoute,
  dashboardRoute,
  clientsIndexRoute,
  practiceOverviewRoute,
  deskRoute,
  reportsRoute,
  settingsRoute,
  settingsBrandRoute,
  settingsTeamRoute,
  proofLandingRoute,
  taxPackRoute,
  walkthroughRoute,
  personaCritRoute,
  retest560Route,
  fmBriefRoute,
  practiceTodayRoute,
  actionPlanRoute,
  cashSuggestRoute,
  cashOnceOffRoute,
  retest568Route,
  aqaFollowupRoute,
  aqaPracticeNavRoute,
  finalWalkRoute,
  retest578Route,
  aqaRetest573Route,
]);
const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
