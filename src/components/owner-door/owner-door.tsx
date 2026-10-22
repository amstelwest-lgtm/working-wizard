/**
 * Live owner door. Figures come from the books, the forecast, action points,
 * and accountant sign-offs. Empty reads stay empty.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { DataRequestsPanel } from "@/components/data-requests-panel";
import { InviteAccountantCard } from "@/components/invite-accountant-card";
import { OwnerUploadsPanel } from "@/components/owner-uploads-panel";
import { SourceDocumentsPanel } from "@/components/source-documents-panel";
import { useAgentActivity } from "@/hooks/use-agent-activity";
import { ownerRunPhase, type OwnerRunPhase } from "@/hooks/owner-agent-ui";
import { supabase } from "@/integrations/supabase/client";
import { bootSelect } from "@/lib/boot-read";
import { formatDate } from "@/lib/market/format";
import { readRequestGeoCountry } from "@/lib/geo-country.functions";
import { resolveOwnerMarket } from "@/lib/pricing/market-resolution";
import type { ResolvedMarket } from "@/lib/market/types";
import type { FiscalStatementSlice } from "@/lib/budget-period-types";
import { AGENT_KEYS, type AgentKey } from "@/lib/milon-team-feed";
import { askOwnerAgent } from "@/lib/owner-ask";
import {
  browserThreadStore,
  emptyOwnerThreads,
  historyFromThread,
  readOwnerThreads,
  writeOwnerThread,
  type OwnerAgentThread,
} from "@/lib/owner-chat-thread";
import { latestFiguresStamp } from "@/lib/draft-figures";
import { booksPeriodPillLabel } from "@/lib/statement-period";
import { earlierStatementNote } from "@/lib/statement-import-plan";
import {
  ownerAnswerTiles,
  ownerCardStatuses,
  ownerHomeLines,
  parseOwnerNumber,
  type OwnerBooks,
} from "@/lib/owner-answers";
import { agentDisplayName, agentShortName } from "@/lib/milon-team";
import { toast } from "sonner";
import { handoffRowStillWorking } from "@/lib/agent-activity-poll";
import {
  cardRunsByAgent,
  ownerPresence,
  steerOpenHandoffs,
  withCardHandoffRuns,
  type OwnerTalk,
} from "@/lib/owner-presence";
import {
  ACTION_PLAN_REFRESH_EVENT,
  clearOptimisticHandoff,
  commitActionHandoff,
  handoffPaintBlocked,
  HANDOFF_FAILED_COPY,
  loadActionHandoffRuns,
  loadLatestAssignments,
  type ActionPlanRefreshDetail,
} from "@/lib/owner-handoff-client";
import {
  applyLiveRuns,
  openHandoffAgents,
  openPlanTitles,
  pendingAssignmentLanded,
  personOwnedActionIds,
  rowAssignment,
  visibleHandedAction,
  withPendingAssignment,
  withoutPersonQueuedRuns,
  type RowAssignment,
} from "@/lib/open-plan-home";
import { resolvePriorSnapshot, type SnapshotRow } from "@/lib/prior-period";
import type { SavedCashflowLike } from "@/lib/cash-runway";
import { runBotTransition, ownerBotKey } from "./owner-bot-motion";
import { OwnerChat } from "./owner-chat";
import { scorecardRatiosFromFinancials } from "@/lib/scorecard-rows";
import { renderHealthNarrative } from "@/lib/health-snapshot";
import {
  advisoryDeliverableTitles,
  ownerDraftPresentations,
  ownerNeedsView,
  type BooksLink,
  type OwnerActionRow,
} from "@/lib/owner-needs";
import { financialsHomeSignoffLine } from "@/components/owner-signoff-mark";
import { OwnerHome } from "./owner-home";
import { canonicalOwnerScreen, OWNER_SIGNED_SECTION_ID } from "@/lib/owner-nav";
import {
  ownerCheckoutHref,
  ownerSubscribeView,
  type OwnerSubscribeView,
} from "@/lib/owner-subscribe";
import { readPriceQuote } from "@/lib/pricing/price-quote.functions";
import { getOwnerEntitlement, startOwnerCheckout } from "@/lib/stripe-checkout.functions";
import { OwnerAccountant, OwnerFirst, OwnerPlan, OwnerSettings } from "./owner-pages";
import { OwnerShell, type OwnerScreen } from "./owner-shell";

type Signoff = {
  id?: string;
  scope?: string;
  signed_off_by_name: string;
  signed_off_at: string;
  firm_name?: string | null;
};

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function speechRecognition(): SpeechRec | null {
  if (typeof window === "undefined") return null;
  const host = window as Window & {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  const Ctor = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0] ?? "");
  return letters.join("").toUpperCase() || "OW";
}

export function OwnerDoor({
  clientId,
  businessName,
  hasBooks,
  revenue,
  priorRevenue,
  cogs,
  receivables,
  netIncome,
  profitPeriod = null,
  periodEnd,
  statementSpan = null,
  history,
  cashflow,
  cashOutlook = null,
  openingMissing = false,
  cashPillarStatus = null,
  hasEvidence,
  cashOnFile,
  cashRunwayWeeks = null,
  cashDebtorScore = null,
  cashBurnScore = null,
  liveHealth = null,
  market,
  marketCountry = null,
  signoffs,
  firmId,
  workspaces,
  onSwitch,
  onConnect,
  onQuickBooks,
  onXero,
  onProfile,
  profileResume = false,
  onResumeProfile,
  onSettings,
  onLeaveSettings,
  onAccount,
  settingsOpen = false,
  openAccountant = false,
  openPlan = false,
  checkoutNotice = null,
  focusSigned = false,
  onSignOut,
  topMove = null,
  sampleClient = false,
  boards,
  bot = null,
  onBotChange,
  routeScreen,
  onOpenScreen,
  sampleNotice = null,
  planTick = 0,
  financials = null,
}: {
  clientId: string | null;
  businessName: string;
  hasBooks: boolean;
  revenue: string;
  priorRevenue: string;
  cogs: string;
  receivables: string;
  netIncome: string;
  /** Firm-year slice the owner Waterfall quotes. The Analyst card uses it when it is pro-rated. */
  profitPeriod?: FiscalStatementSlice | null;
  periodEnd: string | null;
  /** Market-formatted statement span. Home keeps this sentence when ledger status arrives later. */
  statementSpan?: string | null;
  history: SnapshotRow[];
  cashflow: SavedCashflowLike | null;
  /** Same opening and floor as Health and the 13-week forecast. */
  cashOutlook?: {
    opening: number;
    closing: number[];
    floor: number;
    dipsBelowFloorWeek: number | null;
  } | null;
  /** Blank opening. Not cash under the floor. */
  openingMissing?: boolean;
  /** Same cash pillar band as Health. Watch does not say below the minimum. */
  cashPillarStatus?: "healthy" | "at_risk" | "critical" | null;
  /** False when nothing is synced or parsed. Home shows one connect line. */
  hasEvidence?: boolean;
  /** False when the cash balance was not read. Home asks for a balance sheet. */
  cashOnFile?: boolean;
  /** Weeks scored into the cash pillar. Names a Critical chip that is not the floor. */
  cashRunwayWeeks?: number | null;
  /** Scored debtor days. Names a Critical chip that is receivables. */
  cashDebtorScore?: number | null;
  /** Scored operating cash. Names a Critical chip that is burn. */
  cashBurnScore?: number | null;
  /** Live floor-applied score. Home cards quote this instead of a stored finding. */
  liveHealth?: import("@/lib/health-snapshot").HealthScoreSnapshot | null;
  market: ResolvedMarket;
  /** Stored country. Null stays off the ZA tax card even if `market` was coerced for dates. */
  marketCountry?: string | null;
  signoffs: Signoff[];
  firmId: string | null;
  workspaces: { clientId: string; name: string }[];
  onSwitch: (clientId: string) => void;
  onConnect: () => void;
  onQuickBooks: () => void;
  onXero: () => void;
  onProfile: () => void;
  /** First-run profile was closed. Home offers to open it again. */
  profileResume?: boolean;
  onResumeProfile?: () => void;
  onSettings: () => void;
  onLeaveSettings?: () => void;
  onAccount?: () => void;
  settingsOpen?: boolean;
  /** Deep link: /app?screen=accountant, including old deliverables URLs. */
  openAccountant?: boolean;
  /** Deep link: /app?screen=plan from Plan & billing. */
  openPlan?: boolean;
  /** Checkout return: /app?screen=plan&checkout=success|cancel. */
  checkoutNotice?: "success" | "cancel" | null;
  /** Scroll the signed-deliverables section into view. */
  focusSigned?: boolean;
  onSignOut: () => void;
  /** Top ranked next move. Empty stays an honest line under the advisor. */
  topMove?: string | null;
  /** clients.is_demo. A demo client gets the sample card. A real client gets the preview card. */
  sampleClient?: boolean;
  boards?: (
    go: (screen: OwnerScreen) => void,
  ) => Partial<Record<"health" | "cash" | "budget" | "tasks" | "profit" | "moves", ReactNode>>;
  bot?: AgentKey | null;
  onBotChange?: (agent: AgentKey | null, mode: "push" | "replace") => void;
  /** URL screen. Back and forward change this, and the door follows. */
  routeScreen?: OwnerScreen;
  /** Push `/app?tab=` (or the settings/plan screen) so the tab can be shared. */
  onOpenScreen?: (screen: OwnerScreen) => void;
  /** Implausible sample figures. Shown on Home, same note as the client file. */
  sampleNotice?: string | null;
  /** Bumps when an action is handed off, so Home refetches without a reload. */
  planTick?: number;
  /** Live books. Home drafts quote the same ratios as the scorecard. */
  financials?: Record<string, unknown> | null;
}) {
  const openedBot = ownerBotKey(bot);
  const [screen, setScreen] = useState<OwnerScreen>(
    routeScreen ??
      (openedBot
        ? "chat"
        : settingsOpen
          ? "settings"
          : openPlan
            ? "plan"
            : openAccountant
              ? "accountant"
              : "home"),
  );
  const beforeSettings = useRef<OwnerScreen>("home");
  const leavingSettings = useRef(false);
  const [agent, setAgent] = useState<AgentKey>(openedBot ?? "financial_manager");
  const [talk, setTalk] = useState<OwnerTalk>(null);
  const [threads, setThreads] = useState<Record<AgentKey, OwnerAgentThread>>(() =>
    clientId ? readOwnerThreads(browserThreadStore(), clientId) : emptyOwnerThreads(),
  );
  const [busyAgent, setBusyAgent] = useState<AgentKey | null>(null);
  const [errors, setErrors] = useState<Partial<Record<AgentKey, string>>>({});
  const [errorCodes, setErrorCodes] = useState<Partial<Record<AgentKey, string>>>({});
  const [listening, setListening] = useState(false);
  const [ledger, setLedger] = useState<"QuickBooks" | "Xero" | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [actionRows, setActionRows] = useState<OwnerActionRow[]>([]);
  const [actionsUnavailable, setActionsUnavailable] = useState(false);
  const [deliverableCount, setDeliverableCount] = useState<number | null>(null);
  const [deliverablesUnavailable, setDeliverablesUnavailable] = useState(false);
  const [deliverableAttempt, setDeliverableAttempt] = useState(0);
  const [quickBooks, setQuickBooks] = useState<BooksLink>({ state: "unknown" });
  const [xeroLink, setXeroLink] = useState<BooksLink>({ state: "unknown" });
  const [openAction, setOpenAction] = useState<string | null>(null);
  const [handedTitle, setHandedTitle] = useState<string | null>(null);
  const [assignedAgent, setAssignedAgent] = useState<AgentKey | null>(null);
  const [assignmentRows, setAssignmentRows] = useState<RowAssignment[]>([]);
  const awaitingRun = assignmentRows
    .filter((row) => row.open)
    .map((row) => ({ openedAt: row.openedAt }));
  const activity = useAgentActivity(clientId ?? "", awaitingRun);
  const pendingHandoffs = useRef(new Map<string, ActionPlanRefreshDetail>());
  const [handoffErrors, setHandoffErrors] = useState<
    { actionItemId: string; title: string; agent: AgentKey; message: string }[]
  >([]);
  const assignmentRowsRef = useRef(assignmentRows);
  assignmentRowsRef.current = assignmentRows;
  const priorRows = useRef(new Map<string, { since: string; row: RowAssignment | null }>());
  const [actionsReady, setActionsReady] = useState(false);
  const [firmName, setFirmName] = useState<string | null>(null);
  const [visitor, setVisitor] = useState<"za" | "us" | null>(null);
  const [zaMonthly, setZaMonthly] = useState<string | null>(null);
  const [billing, setBilling] = useState<OwnerSubscribeView>({ kind: "pending" });
  const [subscribeBusy, setSubscribeBusy] = useState(false);
  const loadEntitlement = useServerFn(getOwnerEntitlement);
  const readQuote = useServerFn(readPriceQuote);
  const readGeo = useServerFn(readRequestGeoCountry);
  const beginCheckout = useServerFn(startOwnerCheckout);
  const recRef = useRef<SpeechRec | null>(null);
  const listenGen = useRef(0);
  const threadsRef = useRef(threads);
  const screenRef = useRef(screen);
  const agentRef = useRef(agent);
  const pushedRef = useRef(false);
  const botHydrated = useRef(false);
  const loadedClient = useRef(clientId);
  const signedFocused = useRef(false);
  screenRef.current = screen;
  agentRef.current = agent;
  threadsRef.current = threads;

  useEffect(() => {
    if (loadedClient.current === clientId) return;
    loadedClient.current = clientId;
    listenGen.current += 1;
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
    pendingHandoffs.current.clear();
    setHandoffErrors([]);
    setHandedTitle(null);
    setAssignedAgent(null);
    setAssignmentRows([]);
    setThreads(clientId ? readOwnerThreads(browserThreadStore(), clientId) : emptyOwnerThreads());
    setErrors({});
  }, [clientId]);

  useEffect(() => {
    if (settingsOpen) {
      setScreen((current) => {
        if (current !== "settings") beforeSettings.current = current;
        return "settings";
      });
      return;
    }
    if (openPlan) {
      setScreen("plan");
      return;
    }
    if (leavingSettings.current) {
      leavingSettings.current = false;
      return;
    }
    setScreen((current) => (current === "settings" ? beforeSettings.current : current));
  }, [settingsOpen, openPlan]);

  useEffect(() => {
    if (!routeScreen) return;
    setScreen(routeScreen);
  }, [routeScreen]);

  useEffect(() => {
    if (signedFocused.current || !focusSigned || screen !== "accountant") return;
    signedFocused.current = true;
    document.getElementById(OWNER_SIGNED_SECTION_ID)?.scrollIntoView({ block: "start" });
  }, [focusSigned, screen]);

  useEffect(() => {
    let cancelled = false;
    const storedCountry = marketCountry === "ZA" || marketCountry === "US" ? marketCountry : "";
    const storedMarket = storedCountry ? { country: storedCountry } : null;
    void readGeo()
      .then((geo) => {
        if (!cancelled) setVisitor(resolveOwnerMarket({ storedMarket, geoCountry: geo }));
      })
      .catch(() => {
        if (!cancelled) setVisitor(resolveOwnerMarket({ storedMarket, geoCountry: null }));
      });
    void readQuote({
      data: { surface: "owner", plan: "owner", interval: "month", storedCountry },
    })
      .then((quote) => {
        if (!cancelled) setZaMonthly(quote?.label ?? null);
      })
      .catch(() => {
        if (!cancelled) setZaMonthly(null);
      });
    return () => {
      cancelled = true;
    };
  }, [marketCountry, readGeo, readQuote]);

  useEffect(() => {
    let cancelled = false;
    void loadEntitlement({ data: {} })
      .then((entitlement) => {
        if (!cancelled) setBilling(ownerSubscribeView({ entitlement, checkout: null }));
      })
      .catch(() => {
        if (!cancelled) setBilling({ kind: "subscribe" });
      });
    return () => {
      cancelled = true;
    };
  }, [loadEntitlement]);

  async function subscribe() {
    if (subscribeBusy) return;
    setSubscribeBusy(true);
    try {
      const result = await beginCheckout({ data: { interval: "month" } });
      const href = ownerCheckoutHref(result);
      if (href) {
        window.location.assign(href);
        return;
      }
      setBilling(ownerSubscribeView({ entitlement: null, checkout: result }));
    } catch {
      setBilling({ kind: "unavailable" });
    } finally {
      setSubscribeBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    // Display only. The session user is not an authorization check.
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setOwnerEmail(data.session?.user?.email ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onRefresh = (event: Event) => {
      const detail = (event as CustomEvent<ActionPlanRefreshDetail | undefined>).detail;
      if (!detail?.actionItemId) return;
      if (detail.failed) {
        const id = detail.actionItemId;
        const prior = priorRows.current.get(id);
        pendingHandoffs.current.delete(id);
        if (prior) {
          setAssignmentRows((current) =>
            prior.row
              ? current.map((row) =>
                  row.id === id ? { ...prior.row!, open: false, runId: undefined } : row,
                )
              : current.filter((row) => row.id !== id),
          );
        }
        if (detail.error && detail.agent && detail.title) {
          setHandoffErrors((current) => [
            ...current.filter((row) => row.actionItemId !== id),
            {
              actionItemId: id,
              title: detail.title,
              agent: detail.agent as AgentKey,
              message: detail.error ?? HANDOFF_FAILED_COPY,
            },
          ]);
        }
        return;
      }
      if (detail.reused) {
        pendingHandoffs.current.set(detail.actionItemId, {
          ...detail,
          note: undefined,
          reused: true,
        });
        setHandoffErrors((current) =>
          current.filter((row) => row.actionItemId !== detail.actionItemId),
        );
        setAssignmentRows((current) =>
          current.map((row) =>
            row.id === detail.actionItemId
              ? {
                  ...row,
                  open: row.agent != null,
                  openedAt: row.openedAt ?? detail.since,
                  runId: detail.runId ?? row.runId,
                }
              : row,
          ),
        );
        return;
      }
      if (!detail.title) return;
      const agent = detail.agent ?? null;
      const name = detail.assigneeName ?? (agent ? agentDisplayName(agent) : null);
      if (!name) return;
      if (detail.since && priorRows.current.get(detail.actionItemId)?.since !== detail.since) {
        priorRows.current.set(detail.actionItemId, {
          since: detail.since,
          row: assignmentRowsRef.current.find((row) => row.id === detail.actionItemId) ?? null,
        });
      }
      pendingHandoffs.current.set(detail.actionItemId, { ...detail, agent, assigneeName: name });
      setHandoffErrors((current) =>
        current.filter((row) => row.actionItemId !== detail.actionItemId),
      );
      setAssignmentRows((current) => {
        const existing = current.find((row) => row.id === detail.actionItemId);
        const sameWorking =
          !detail.runId &&
          existing?.open === true &&
          existing.agent === agent &&
          Boolean(existing.runId);
        const next: RowAssignment = {
          id: detail.actionItemId,
          assigneeName: name,
          agent,
          open: agent != null,
          openedAt: sameWorking ? existing?.openedAt : agent ? detail.since : undefined,
          runId: detail.runId ?? (sameWorking ? existing?.runId : undefined),
        };
        return current.some((row) => row.id === next.id)
          ? current.map((row) => (row.id === next.id ? next : row))
          : [...current, next];
      });
      if (agent) {
        setHandedTitle(detail.title);
        setAssignedAgent(agent);
      }
      setActionRows((rows) =>
        rows.some((row) => row.title === detail.title)
          ? rows
          : [...rows, { title: detail.title, email: null }],
      );
      setActionsReady(true);
    };
    window.addEventListener(ACTION_PLAN_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(ACTION_PLAN_REFRESH_EVENT, onRefresh);
  }, []);

  useEffect(() => {
    setLedger(null);
    setActionsReady(false);
    setActionRows([]);
    setActionsUnavailable(false);
    setDeliverableCount(null);
    setQuickBooks({ state: "unknown" });
    setXeroLink({ state: "unknown" });
    if (!clientId) {
      setActionsReady(true);
      setDeliverableCount(0);
      setQuickBooks({ state: "absent" });
      setXeroLink({ state: "absent" });
      return;
    }
    let cancelled = false;
    void Promise.all([
      supabase
        .from("qbo_connections")
        .select("id, last_synced_at")
        .eq("client_id", clientId)
        .limit(1),
      supabase
        .from("xero_connections")
        .select("id, last_synced_at")
        .eq("client_id", clientId)
        .limit(1),
      supabase
        .from("action_items_v")
        .select("id, title, status, owner_email, owner_name, seq")
        .eq("client_id", clientId)
        .neq("status", "done")
        .order("seq", { ascending: true })
        .limit(20),
    ]).then(async ([qbo, xero, actions]) => {
      if (cancelled) return;
      const qboRow = qbo.error ? null : (qbo.data?.[0] ?? null);
      const xeroRow = xero.error ? null : (xero.data?.[0] ?? null);
      if (qboRow) setLedger("QuickBooks");
      else if (xeroRow) setLedger("Xero");
      else setLedger(null);
      setQuickBooks(
        qbo.error
          ? { state: "unknown" }
          : qboRow
            ? { state: "linked", at: qboRow.last_synced_at }
            : { state: "absent" },
      );
      setXeroLink(
        xero.error
          ? { state: "unknown" }
          : xeroRow
            ? { state: "linked", at: xeroRow.last_synced_at }
            : { state: "absent" },
      );
      if (actions.error) {
        setOpenAction(null);
        setAssignedAgent(null);
        setAssignmentRows([]);
        setActionRows([]);
        setActionsUnavailable(true);
        setActionsReady(true);
        return;
      }
      const openRows = (actions.data ?? []).flatMap((row) => {
        const title = row.title?.trim() ?? "";
        if (!title || !row.id) return [];
        return [
          { id: row.id, title, email: row.owner_email, ownerName: row.owner_name?.trim() || null },
        ];
      });
      const ids = openRows.map((row) => row.id);
      const earlyTitles = openPlanTitles(openRows);
      setActionRows(earlyTitles.map((title) => ({ title, email: null })));
      setOpenAction(earlyTitles[0] ?? openRows[0]?.title ?? null);
      setActionsReady(true);
      const [assignments, runs] = ids.length
        ? await Promise.all([loadLatestAssignments(ids), loadActionHandoffRuns(ids)])
        : [new Map(), new Map()];
      if (cancelled) return;
      const pendings = [...pendingHandoffs.current.values()].filter(
        (pending) =>
          pending.assigneeName && !handoffPaintBlocked(pending.actionItemId, pending.since),
      );
      const assigned = openRows.map((row) => {
        const stored = assignments.get(row.id) ?? null;
        return rowAssignment({
          id: row.id,
          ownerName: row.ownerName,
          notes: stored
            ? [
                {
                  note:
                    stored.kind === "bot"
                      ? `Handed to ${stored.name}.`
                      : `Assigned to ${stored.name}.`,
                  at: stored.at,
                },
              ]
            : [],
          run: runs.get(row.id) ?? null,
        });
      });
      let merged = assigned;
      const titles = openPlanTitles(openRows);
      for (const pending of pendings) {
        const pendingStored = assignments.get(pending.actionItemId) ?? null;
        const pendingView = {
          id: pending.actionItemId,
          agent: pending.agent ?? null,
          assigneeName: pending.assigneeName ?? "",
          since: pending.since,
          runId: pending.runId,
        };
        const serverRun = runs.get(pending.actionItemId) ?? null;
        const reusedLanded = Boolean(
          pending.reused && pending.runId && serverRun?.id === pending.runId,
        );
        const pendingLanded =
          reusedLanded || (!pending.reused && pendingAssignmentLanded(pendingStored, pendingView));
        if (pendingLanded) {
          pendingHandoffs.current.delete(pending.actionItemId);
          clearOptimisticHandoff(pending.actionItemId);
          continue;
        }
        merged = withPendingAssignment(merged, pendingView, pendingStored);
        if (pending.title && !titles.includes(pending.title)) titles.push(pending.title);
      }
      const handed = visibleHandedAction(
        merged,
        Object.fromEntries(openRows.map((row) => [row.id, row.title])),
      );
      setActionRows(titles.map((title) => ({ title, email: null })));
      setOpenAction(openRows[0]?.title ?? null);
      setHandedTitle(handed?.title ?? null);
      setAssignedAgent(handed?.agent ?? null);
      setAssignmentRows(merged);
      setActionsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, market, planTick]);

  const storedDeliverablesOpen = canonicalOwnerScreen(screen) === "accountant";
  useEffect(() => {
    if (!clientId || !storedDeliverablesOpen) return;
    let cancelled = false;
    void (async () => {
      const read = await bootSelect(
        (signal) =>
          supabase
            .from("deliverable_drafts")
            .select("id")
            .eq("client_id", clientId)
            .in("status", ["draft", "ready"])
            .limit(20)
            .abortSignal(signal),
        { critical: false },
      );
      if (cancelled) return;
      if (!read.ok || read.value.error) {
        setDeliverablesUnavailable(true);
        setDeliverableCount(0);
        return;
      }
      setDeliverablesUnavailable(false);
      setDeliverableCount(read.value.data?.length ?? 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, storedDeliverablesOpen, deliverableAttempt]);

  useEffect(() => {
    setFirmName(null);
    if (!firmId) return;
    let cancelled = false;
    void supabase
      .from("firms")
      .select("name")
      .eq("id", firmId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setFirmName(data?.name?.trim() || null);
      });
    return () => {
      cancelled = true;
    };
  }, [firmId]);

  const books = useMemo<OwnerBooks>(() => {
    const prior = resolvePriorSnapshot(history, new Date(), {
      periodEnd,
      financials: financials ?? { revenue, netIncome, cogs },
    });
    const priorFin = prior?.financials ?? null;
    const latest =
      [...signoffs].sort((a, b) => b.signed_off_at.localeCompare(a.signed_off_at))[0] ?? null;
    return {
      hasBooks,
      ledger,
      revenue: parseOwnerNumber(revenue),
      priorRevenue: parseOwnerNumber(priorRevenue) ?? parseOwnerNumber(priorFin?.revenue),
      cogs: parseOwnerNumber(cogs),
      priorCogs: parseOwnerNumber(priorFin?.cogs),
      priorGrossProfit: parseOwnerNumber(priorFin?.grossProfit),
      netIncome: parseOwnerNumber(netIncome),
      profitPeriod,
      receivables: parseOwnerNumber(receivables),
      cashflow,
      cashOutlook: cashOutlook ?? undefined,
      openingMissing,
      cashPillarStatus,
      hasEvidence,
      cashOnFile,
      cashRunwayWeeks,
      cashDebtorScore,
      cashBurnScore,
      balanceSheetNote: earlierStatementNote(financials, market),
      openAction,
      actionsReady,
      signedBy: latest?.signed_off_by_name ?? null,
      signedOn: latest ? formatDate(latest.signed_off_at, market) : null,
      market,
    };
  }, [
    hasBooks,
    ledger,
    revenue,
    priorRevenue,
    cogs,
    receivables,
    cashOutlook,
    openingMissing,
    cashPillarStatus,
    hasEvidence,
    cashOnFile,
    cashRunwayWeeks,
    cashDebtorScore,
    cashBurnScore,
    netIncome,
    profitPeriod,
    periodEnd,
    financials,
    history,
    cashflow,
    openAction,
    actionsReady,
    signoffs,
    market,
  ]);

  const homeSignoffLine = useMemo(
    () => financialsHomeSignoffLine(signoffs, market),
    [signoffs, market],
  );
  const tiles = useMemo(() => ownerAnswerTiles(books), [books]);
  const canonicalRatios = useMemo(
    () => (financials ? scorecardRatiosFromFinancials(financials, { fyStartMonth: market.fyStartMonthDefault }) : null),
    [financials, market.fyStartMonthDefault],
  );
  const figuresUpdatedAt = useMemo(
    () => latestFiguresStamp(history.map((row) => ({ at: row.created_at, source: row.source }))),
    [history],
  );
  const draftPresentations = useMemo(
    () =>
      ownerDraftPresentations(activity.findings, canonicalRatios, {
        overall: liveHealth?.overall ?? null,
        health: liveHealth,
        figuresUpdatedAt,
      }),
    [activity.findings, canonicalRatios, liveHealth, figuresUpdatedAt],
  );
  const needs = useMemo(
    () =>
      ownerNeedsView({
        ownerEmail,
        actionsReady,
        actionsUnavailable,
        actions: actionRows,
        draftsReady: !activity.loading,
        draftsUnavailable: Boolean(activity.error),
        draftTitles: draftPresentations.map((row) => row.text),
        draftStale: draftPresentations.map((row) => row.stale),
        draftLiveSentence: liveHealth ? renderHealthNarrative(liveHealth) : null,
        deliverablesReady: actionsReady,
        deliverablesUnavailable,
        deliverableCount,
        advisoryTitles: advisoryDeliverableTitles(activity.findings, canonicalRatios, {
          overall: liveHealth?.overall ?? null,
          health: liveHealth,
        }),
        quickBooks,
        xero: xeroLink,
        when: (iso) => formatDate(iso, market),
        statementSpan,
        signedLine: homeSignoffLine,
      }),
    [
      ownerEmail,
      actionsReady,
      actionsUnavailable,
      actionRows,
      activity.loading,
      activity.error,
      activity.findings,
      draftPresentations,
      liveHealth,
      canonicalRatios,
      deliverablesUnavailable,
      deliverableCount,
      quickBooks,
      xeroLink,
      market,
      statementSpan,
      homeSignoffLine,
    ],
  );
  const settledRows = applyLiveRuns(
    assignmentRows,
    activity.runs.map((run) => ({
      id: run.id,
      actionItemId: run.action_item_id,
      agent: run.agent,
      status: run.status,
      at: run.finished_at || run.queued_at,
    })),
  );
  const workingRows = settledRows.map((row) =>
    handoffRowStillWorking(row, activity.runs) ? row : { ...row, open: false },
  );
  const openAgents = openHandoffAgents(workingRows);
  const cardRuns = withCardHandoffRuns(
    withoutPersonQueuedRuns(activity.runs, personOwnedActionIds(settledRows)),
    workingRows,
  );
  const presence = steerOpenHandoffs(
    ownerPresence({ ...activity, runs: cardRuns }, talk, liveHealth, figuresUpdatedAt, clientId),
    openAgents,
  );
  const runState = useMemo(() => {
    const latest = cardRunsByAgent(cardRuns);
    const out: Partial<Record<AgentKey, OwnerRunPhase>> = {};
    for (const key of AGENT_KEYS) {
      const phase = ownerRunPhase(latest[key], activity.findings);
      if (phase) out[key] = phase;
    }
    return out;
  }, [activity.findings, cardRuns]);
  const active = presence.agents.find((item) => item.agent === agent) ?? presence.agents[0];

  useEffect(() => {
    const next = ownerBotKey(bot);
    if (!botHydrated.current) {
      botHydrated.current = true;
      return;
    }
    if (next) {
      if (screenRef.current === "chat" && agentRef.current === next) return;
      void runBotTransition(() => {
        focusAgent(next);
        setScreen("chat");
      });
      return;
    }
    if (screenRef.current !== "chat") return;
    void runBotTransition(() => setScreen("home"));
  }, [bot]);

  function openChat(next: AgentKey) {
    pushedRef.current = true;
    void runBotTransition(() => {
      focusAgent(next);
      setScreen("chat");
      onBotChange?.(next, "push");
    });
  }

  function closeChat() {
    const popped = pushedRef.current;
    pushedRef.current = false;
    void runBotTransition(() => setScreen("home")).then(() => {
      if (popped && new URLSearchParams(window.location.search).has("bot")) {
        window.history.back();
        return;
      }
      onBotChange?.(null, "replace");
    });
  }

  function leaveSettings() {
    leavingSettings.current = true;
    setScreen(beforeSettings.current);
    onLeaveSettings?.();
  }

  function focusSignedDeliverables() {
    queueMicrotask(() => {
      document.getElementById(OWNER_SIGNED_SECTION_ID)?.scrollIntoView({ block: "start" });
    });
  }

  function go(next: OwnerScreen) {
    const target = canonicalOwnerScreen(next);
    if (target === "chat") return;
    if (target === screenRef.current && next !== "deliverables") return;
    const open = next === "deliverables" ? "deliverables" : target;
    if (screenRef.current === "settings" && target !== "settings") {
      leavingSettings.current = true;
    }
    if (screenRef.current === "chat") {
      if (target === "home") {
        closeChat();
        return;
      }
      pushedRef.current = false;
      void runBotTransition(() => setScreen(target)).then(() => {
        onOpenScreen?.(open);
        if (next === "deliverables") focusSignedDeliverables();
      });
      return;
    }
    setScreen(target);
    onOpenScreen?.(open);
    if (next === "deliverables") focusSignedDeliverables();
  }

  function updateThread(
    which: AgentKey,
    forClient: string,
    recipe: (thread: OwnerAgentThread) => OwnerAgentThread,
  ) {
    const base =
      loadedClient.current === forClient
        ? threadsRef.current[which]
        : readOwnerThreads(browserThreadStore(), forClient)[which];
    const nextThread = recipe(base);
    writeOwnerThread(browserThreadStore(), forClient, which, nextThread);
    if (loadedClient.current !== forClient) return;
    const updated = { ...threadsRef.current, [which]: nextThread };
    threadsRef.current = updated;
    setThreads(updated);
  }

  function stopRecording() {
    listenGen.current += 1;
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
    setTalk((current) => (current?.mode === "listening" ? null : current));
  }

  function focusAgent(next: AgentKey) {
    if (agentRef.current !== next) stopRecording();
    setAgent(next);
  }

  function setAgentError(which: AgentKey, message: string | null, code?: string | null) {
    setErrors((current) => ({ ...current, [which]: message ?? undefined }));
    setErrorCodes((current) => ({
      ...current,
      [which]: message && code ? code : undefined,
    }));
  }

  async function send(text: string) {
    const question = text.trim();
    const asked = agentRef.current;
    if (!question || busyAgent === asked) return;
    if (!clientId) {
      setAgentError(asked, "Your business is still linking.");
      return;
    }
    const askedClient = clientId;
    const prior = threadsRef.current[asked].messages;
    setAgentError(asked, null);
    updateThread(asked, askedClient, (thread) => ({
      messages: [...thread.messages, { role: "owner", text: question }],
      draft: "",
    }));
    setBusyAgent(asked);
    setTalk({ agent: asked, mode: "working" });
    const result = await askOwnerAgent({
      clientId: askedClient,
      agent: asked,
      question,
      history: historyFromThread(prior),
    });
    setBusyAgent((current) => (current === asked ? null : current));
    if (!result.ok) {
      setTalk((current) =>
        current?.agent === asked && current.mode === "working" ? null : current,
      );
      setAgentError(asked, result.error, result.code);
      return;
    }
    updateThread(asked, askedClient, (thread) => ({
      ...thread,
      messages: [...thread.messages, { role: "agent", text: result.answer }],
    }));
    setTalk((current) => (current?.agent === asked && current.mode === "working" ? null : current));
  }

  function listen() {
    const heardFor = agentRef.current;
    if (listening) {
      stopRecording();
      return;
    }
    const rec = speechRecognition();
    if (!rec) {
      setAgentError(heardFor, "Voice is not available in this browser.");
      return;
    }
    const gen = ++listenGen.current;
    rec.lang = market.locale || "en";
    rec.interimResults = false;
    rec.onresult = (event) => {
      if (gen !== listenGen.current) return;
      if (agentRef.current !== heardFor) return;
      const said = event.results[0]?.[0]?.transcript?.trim() ?? "";
      if (!said || !clientId) return;
      updateThread(heardFor, clientId, (thread) => ({ ...thread, draft: said }));
    };
    rec.onerror = () => {
      if (gen !== listenGen.current) return;
      setListening(false);
      setTalk((current) => (current?.mode === "listening" ? null : current));
      setAgentError(heardFor, "Voice did not catch that.");
    };
    rec.onend = () => {
      if (gen !== listenGen.current) return;
      setListening(false);
      setTalk((current) => (current?.mode === "listening" ? null : current));
    };
    recRef.current = rec;
    setAgentError(heardFor, null);
    setListening(true);
    setTalk({ agent: heardFor, mode: "listening" });
    rec.start();
  }

  const shown = canonicalOwnerScreen(screen);
  const railScreen = shown === "tasks" || shown === "actions" ? "moves" : shown;
  const restored = boards?.(go);

  return (
    <OwnerShell
      screen={railScreen}
      businessName={businessName}
      initials={initialsFrom(businessName)}
      workspaces={workspaces}
      activeClientId={clientId}
      onSwitch={onSwitch}
      onNavigate={go}
      onSignOut={onSignOut}
      onSettings={onSettings}
      onProfile={onProfile}
      periodLabel={booksPeriodPillLabel(periodEnd, statementSpan)}
    >
      {railScreen === "home" ? (
        <OwnerHome
          variant="character"
          presence={presence}
          lines={ownerHomeLines(tiles, topMove, assignedAgent, handedTitle)}
          signoffLine={homeSignoffLine}
          status={ownerCardStatuses(books)}
          marketCountry={marketCountry}
          audience="owner"
          sampleClient={sampleClient}
          cardPhase="ready"
          onOpen={openChat}
          onAsk={openChat}
          runState={runState}
          needs={needs}
          handoffErrors={handoffErrors}
          onRetryHandoff={(actionItemId) => {
            const failed = handoffErrors.find((row) => row.actionItemId === actionItemId);
            if (!failed || !clientId) return;
            const toastId = toast.success(`Handed to ${agentShortName(failed.agent)}`);
            void commitActionHandoff({
              clientId,
              actionItemId: failed.actionItemId,
              title: failed.title,
              agent: failed.agent,
            }).then((result) => {
              if (!result.ok) toast.error(result.error, { id: toastId });
            });
          }}
          onMoves={() => go("moves")}
          onDeliverables={() => go("deliverables")}
          inviteClientId={clientId}
          firmId={firmId}
          notice={sampleNotice}
          profileResume={profileResume}
          onResumeProfile={onResumeProfile}
        />
      ) : null}
      {railScreen === "health" ? restored?.health : null}
      {railScreen === "cash" ? restored?.cash : null}
      {railScreen === "budget" ? restored?.budget : null}
      {railScreen === "profit" ? restored?.profit : null}
      {railScreen === "moves" ? restored?.moves : null}
      {railScreen === "chat" && active ? (
        <OwnerChat
          market={market}
          agent={agent}
          variant="character"
          motion={active.motion}
          fmClip={active.fmClip}
          sentence={active.sentence}
          messages={threads[agent].messages}
          draft={threads[agent].draft}
          listening={listening && talk?.agent === agent}
          busy={busyAgent === agent}
          error={errors[agent] ?? null}
          errorCode={errorCodes[agent] ?? null}
          plan={{
            accountantFirm: Boolean(firmId),
            visitor,
            zaMonthly,
            firmName,
            billing,
            subscribeBusy,
            onSubscribe: () => void subscribe(),
          }}
          onDraft={(value) => {
            const which = agentRef.current;
            const nextThread = { ...threadsRef.current[which], draft: value };
            const updated = { ...threadsRef.current, [which]: nextThread };
            threadsRef.current = updated;
            setThreads(updated);
            if (clientId) writeOwnerThread(browserThreadStore(), clientId, which, nextThread);
          }}
          onSend={() => void send(threadsRef.current[agent].draft)}
          onListen={listen}
          onSpeech={(speaking) => {
            setTalk((current) => {
              if (speaking) return { agent, mode: "speaking" };
              if (current?.mode === "speaking") return null;
              return current;
            });
          }}
          onBack={closeChat}
        />
      ) : null}
      {railScreen === "accountant" && deliverablesUnavailable ? (
        <button
          type="button"
          data-section-retry="deliverables"
          onClick={() => setDeliverableAttempt((n) => n + 1)}
        >
          Retry
        </button>
      ) : null}
      {railScreen === "accountant" ? (
        <OwnerAccountant
          joined={Boolean(firmId)}
          firmName={firmName}
          invite={
            clientId && !firmId ? (
              <InviteAccountantCard clientId={clientId} tone="settings" />
            ) : null
          }
          documents={
            clientId ? (
              <SourceDocumentsPanel
                clientId={clientId}
                surface="upload"
                viewer={{
                  clientHasFirm: Boolean(firmId),
                  isOwner: true,
                  isFirmMemberWithAccess: false,
                }}
              />
            ) : null
          }
          uploads={clientId ? <OwnerUploadsPanel clientId={clientId} /> : null}
          requests={
            clientId ? (
              <DataRequestsPanel
                clientId={clientId}
                audience="owner"
                onUpload={onConnect}
                onOpenForecast={() => setScreen("cash")}
              />
            ) : null
          }
          signed={signoffs.map((row, index) => ({
            id: row.id ?? `${row.scope ?? "sign"}-${index}`,
            scope: row.scope ?? "advisory",
            name: row.signed_off_by_name,
            when: formatDate(row.signed_off_at, market),
          }))}
          onConnect={onConnect}
          onHome={() => go("home")}
        />
      ) : null}
      {railScreen === "plan" ? (
        <OwnerPlan
          visitor={visitor}
          zaMonthly={zaMonthly}
          accountantOnMilon={Boolean(firmId)}
          firmName={firmName}
          billing={billing}
          subscribeBusy={subscribeBusy}
          onSubscribe={() => void subscribe()}
          onInvite={() => go("accountant")}
          checkoutNotice={checkoutNotice}
        />
      ) : null}
      {railScreen === "first" ? (
        <OwnerFirst
          joined={Boolean(firmId)}
          onQuickBooks={onQuickBooks}
          onXero={onXero}
          onInvite={() => setScreen("accountant")}
        />
      ) : null}
      {railScreen === "settings" ? (
        <OwnerSettings
          visitor={visitor}
          zaMonthly={zaMonthly}
          accountantOnMilon={Boolean(firmId)}
          firmName={firmName}
          onProfile={onProfile}
          onQuickBooks={onQuickBooks}
          onXero={onXero}
          onBack={leaveSettings}
          onAccount={onAccount}
          billing={billing}
          subscribeBusy={subscribeBusy}
          onSubscribe={() => void subscribe()}
        />
      ) : null}
    </OwnerShell>
  );
}
