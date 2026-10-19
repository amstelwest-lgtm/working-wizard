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
import { formatDate } from "@/lib/market/format";
import { visitorCopyPack } from "@/lib/market/marketing";
import { readVisitorDraft } from "@/lib/market/storage";
import type { ResolvedMarket } from "@/lib/market/types";
import { AGENT_KEYS, type AgentKey } from "@/lib/milon-team-feed";
import { latestRunByAgent } from "@/lib/milon-team-activity";
import { askOwnerAgent } from "@/lib/owner-ask";
import {
  browserThreadStore,
  emptyOwnerThreads,
  historyFromThread,
  readOwnerThreads,
  writeOwnerThread,
  type OwnerAgentThread,
} from "@/lib/owner-chat-thread";
import {
  ownerAnswerTiles,
  ownerCardStatuses,
  ownerHomeLines,
  parseOwnerNumber,
  type OwnerBooks,
} from "@/lib/owner-answers";
import { ownerPresence, steerAssignedWork, type OwnerTalk } from "@/lib/owner-presence";
import {
  ACTION_PLAN_REFRESH_EVENT,
  loadActionHandoffRuns,
  loadLatestHandoffAgents,
  type ActionPlanRefreshDetail,
} from "@/lib/owner-handoff-client";
import { handedHomeAction, openPlanTitles, preferPendingHandoff } from "@/lib/open-plan-home";
import { resolvePriorSnapshot, type SnapshotRow } from "@/lib/prior-period";
import type { SavedCashflowLike } from "@/lib/cash-runway";
import { runBotTransition, ownerBotKey } from "./owner-bot-motion";
import { OwnerChat } from "./owner-chat";
import {
  advisoryDeliverableTitles,
  ownerDraftTitles,
  ownerNeedsView,
  type BooksLink,
  type OwnerActionRow,
} from "@/lib/owner-needs";
import { OwnerHome } from "./owner-home";
import { canonicalOwnerScreen, OWNER_SIGNED_SECTION_ID } from "@/lib/owner-nav";
import { ownerCheckoutHref, ownerSubscribeView, type OwnerSubscribeView } from "@/lib/owner-subscribe";
import { readSaPricingCopy } from "@/lib/pricing/za-pricing.functions";
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
  periodEnd,
  history,
  cashflow,
  cashOutlook = null,
  openingMissing = false,
  cashPillarStatus = null,
  market,
  signoffs,
  firmId,
  workspaces,
  onSwitch,
  onConnect,
  onQuickBooks,
  onXero,
  onProfile,
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
  sampleNotice = null,
  planTick = 0,
}: {
  clientId: string | null;
  businessName: string;
  hasBooks: boolean;
  revenue: string;
  priorRevenue: string;
  cogs: string;
  receivables: string;
  netIncome: string;
  periodEnd: string | null;
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
  market: ResolvedMarket;
  signoffs: Signoff[];
  firmId: string | null;
  workspaces: { clientId: string; name: string }[];
  onSwitch: (clientId: string) => void;
  onConnect: () => void;
  onQuickBooks: () => void;
  onXero: () => void;
  onProfile: () => void;
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
  /** clients.is_demo. The sample tax card stays off a real business. */
  sampleClient?: boolean;
  boards?: (
    go: (screen: OwnerScreen) => void,
  ) => Partial<Record<"health" | "cash" | "budget" | "tasks" | "profit" | "moves", ReactNode>>;
  bot?: AgentKey | null;
  onBotChange?: (agent: AgentKey | null, mode: "push" | "replace") => void;
  /** Implausible sample figures. Shown on Home, same note as the client file. */
  sampleNotice?: string | null;
  /** Bumps when an action is handed off, so Home refetches without a reload. */
  planTick?: number;
}) {
  const activity = useAgentActivity(clientId ?? "");
  const openedBot = ownerBotKey(bot);
  const [screen, setScreen] = useState<OwnerScreen>(
    openedBot
      ? "chat"
      : settingsOpen
        ? "settings"
        : openPlan
          ? "plan"
          : openAccountant
            ? "accountant"
            : "home",
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
  const [listening, setListening] = useState(false);
  const [ledger, setLedger] = useState<"QuickBooks" | "Xero" | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [actionRows, setActionRows] = useState<OwnerActionRow[]>([]);
  const [actionsUnavailable, setActionsUnavailable] = useState(false);
  const [deliverableCount, setDeliverableCount] = useState(0);
  const [deliverablesUnavailable, setDeliverablesUnavailable] = useState(false);
  const [quickBooks, setQuickBooks] = useState<BooksLink>({ state: "unknown" });
  const [xeroLink, setXeroLink] = useState<BooksLink>({ state: "unknown" });
  const [openAction, setOpenAction] = useState<string | null>(null);
  const [handedTitle, setHandedTitle] = useState<string | null>(null);
  const [assignedAgent, setAssignedAgent] = useState<AgentKey | null>(null);
  const [assignedRun, setAssignedRun] = useState<{ agent: AgentKey; status: string } | null>(null);
  const pendingHandoff = useRef<ActionPlanRefreshDetail | null>(null);
  const [actionsReady, setActionsReady] = useState(false);
  const [firmName, setFirmName] = useState<string | null>(null);
  const [visitor, setVisitor] = useState<"za" | "us" | null>(null);
  const [zaMonthly, setZaMonthly] = useState<string | null>(null);
  const [billing, setBilling] = useState<OwnerSubscribeView>({ kind: "pending" });
  const [subscribeBusy, setSubscribeBusy] = useState(false);
  const loadEntitlement = useServerFn(getOwnerEntitlement);
  const loadSaPricing = useServerFn(readSaPricingCopy);
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
    pendingHandoff.current = null;
    setHandedTitle(null);
    setAssignedAgent(null);
    setAssignedRun(null);
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
    if (signedFocused.current || !focusSigned || screen !== "accountant") return;
    signedFocused.current = true;
    document.getElementById(OWNER_SIGNED_SECTION_ID)?.scrollIntoView({ block: "start" });
  }, [focusSigned, screen]);

  useEffect(() => {
    setVisitor(visitorCopyPack(readVisitorDraft()));
    let cancelled = false;
    void loadSaPricing()
      .then((copy) => {
        if (!cancelled) setZaMonthly(copy?.ownerMonthly ?? null);
      })
      .catch(() => {
        if (!cancelled) setZaMonthly(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loadSaPricing]);

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
    void supabase.auth.getUser().then(({ data }) => {
      if (!cancelled) setOwnerEmail(data.user?.email ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onRefresh = (event: Event) => {
      const detail = (event as CustomEvent<ActionPlanRefreshDetail | undefined>).detail;
      if (!detail?.actionItemId || !detail.title || detail.agent === "financial_manager") return;
      pendingHandoff.current = detail;
      setHandedTitle(detail.title);
      setAssignedAgent(detail.agent);
      setAssignedRun({ agent: detail.agent, status: "queued" });
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
    setDeliverableCount(0);
    setDeliverablesUnavailable(false);
    setQuickBooks({ state: "unknown" });
    setXeroLink({ state: "unknown" });
    if (!clientId) {
      setActionsReady(true);
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
        .select("id, title, status, owner_email, seq")
        .eq("client_id", clientId)
        .neq("status", "done")
        .order("seq", { ascending: true })
        .limit(20),
      supabase
        .from("deliverable_drafts")
        .select("id")
        .eq("client_id", clientId)
        .in("status", ["draft", "ready"])
        .limit(20),
    ]).then(async ([qbo, xero, actions, drafts]) => {
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
      if (drafts.error) {
        setDeliverablesUnavailable(true);
        setDeliverableCount(0);
      } else {
        setDeliverablesUnavailable(false);
        setDeliverableCount(drafts.data?.length ?? 0);
      }
      if (actions.error) {
        setOpenAction(null);
        setAssignedAgent(null);
        setAssignedRun(null);
        setActionRows([]);
        setActionsUnavailable(true);
        setActionsReady(true);
        return;
      }
      const openRows = (actions.data ?? []).flatMap((row) => {
        const title = row.title?.trim() ?? "";
        if (!title || !row.id) return [];
        return [{ id: row.id, title, email: row.owner_email }];
      });
      const ids = openRows.map((row) => row.id);
      const [notes, runs] = ids.length
        ? await Promise.all([loadLatestHandoffAgents(ids), loadActionHandoffRuns(ids)])
        : [new Map(), new Map()];
      if (cancelled) return;
      const pending = pendingHandoff.current;
      const handed = preferPendingHandoff(
        handedHomeAction(openRows, notes, runs),
        pending
          ? { id: pending.actionItemId, title: pending.title, agent: pending.agent }
          : null,
        notes,
      );
      if (pending && notes.get(pending.actionItemId)?.agent === pending.agent) {
        pendingHandoff.current = null;
      }
      const titles = openPlanTitles(openRows);
      if (pending && !titles.includes(pending.title)) titles.push(pending.title);
      setActionRows(titles.map((title) => ({ title, email: null })));
      setOpenAction(openRows[0]?.title ?? null);
      setHandedTitle(handed?.title ?? null);
      setAssignedAgent(handed?.agent ?? null);
      // The run status is the stored row. Finished work must not come back as Working.
      setAssignedRun(handed?.run ?? null);
      setActionsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, market, planTick]);

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
      financials: { revenue, netIncome, cogs },
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
      receivables: parseOwnerNumber(receivables),
      cashflow,
      cashOutlook: cashOutlook ?? undefined,
      openingMissing,
      cashPillarStatus,
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
    netIncome,
    periodEnd,
    history,
    cashflow,
    openAction,
    actionsReady,
    signoffs,
    market,
  ]);

  const tiles = useMemo(() => ownerAnswerTiles(books), [books]);
  const needs = useMemo(
    () =>
      ownerNeedsView({
        ownerEmail,
        actionsReady,
        actionsUnavailable,
        actions: actionRows,
        draftsReady: !activity.loading,
        draftsUnavailable: Boolean(activity.error),
        draftTitles: ownerDraftTitles(activity.findings),
        deliverablesReady: actionsReady,
        deliverablesUnavailable,
        deliverableCount,
        advisoryTitles: advisoryDeliverableTitles(activity.findings),
        quickBooks,
        xero: xeroLink,
        when: (iso) => formatDate(iso, market),
      }),
    [
      ownerEmail,
      actionsReady,
      actionsUnavailable,
      actionRows,
      activity.loading,
      activity.error,
      activity.findings,
      deliverablesUnavailable,
      deliverableCount,
      quickBooks,
      xeroLink,
      market,
    ],
  );
  const presence = steerAssignedWork(ownerPresence(activity, talk), assignedAgent, assignedRun);
  const runState = useMemo(() => {
    const latest = latestRunByAgent(activity.runs);
    const out: Partial<Record<AgentKey, OwnerRunPhase>> = {};
    for (const key of AGENT_KEYS) {
      const phase = ownerRunPhase(latest[key], activity.findings);
      if (phase) out[key] = phase;
    }
    return out;
  }, [activity]);
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
    if (screenRef.current === "settings" && target !== "settings") {
      leavingSettings.current = true;
      onLeaveSettings?.();
    }
    if (screenRef.current === "chat") {
      if (target === "home") {
        closeChat();
        return;
      }
      pushedRef.current = false;
      void runBotTransition(() => setScreen(target)).then(() => {
        onBotChange?.(null, "replace");
        if (next === "deliverables") focusSignedDeliverables();
      });
      return;
    }
    setScreen(target);
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

  function setAgentError(which: AgentKey, message: string | null) {
    setErrors((current) => ({ ...current, [which]: message ?? undefined }));
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
      setTalk((current) => (current?.agent === asked && current.mode === "working" ? null : current));
      setAgentError(asked, result.error);
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
  const restored = boards?.(setScreen);

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
    >
      {railScreen === "home" ? (
        <OwnerHome
          variant="character"
          presence={presence}
          lines={ownerHomeLines(tiles, topMove, assignedAgent, handedTitle)}
          status={ownerCardStatuses(books)}
          marketCountry={market.country}
          audience="owner"
          sampleClient={sampleClient}
          onOpen={openChat}
          onAsk={openChat}
          runState={runState}
          needs={needs}
          onMoves={() => go("moves")}
          onDeliverables={() => go("deliverables")}
          inviteClientId={clientId}
          firmId={firmId}
          notice={sampleNotice}
        />
      ) : null}
      {railScreen === "health" ? restored?.health : null}
      {railScreen === "cash" ? restored?.cash : null}
      {railScreen === "budget" ? restored?.budget : null}
      {railScreen === "profit" ? restored?.profit : null}
      {railScreen === "moves" ? restored?.moves : null}
      {railScreen === "chat" && active ? (
        <OwnerChat
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
