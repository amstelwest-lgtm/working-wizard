/**
 * Live owner door. Figures come from the books, the forecast, action points,
 * and accountant sign-offs. Empty reads stay empty.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DataRequestsPanel } from "@/components/data-requests-panel";
import { InviteAccountantCard } from "@/components/invite-accountant-card";
import { OwnerUploadsPanel } from "@/components/owner-uploads-panel";
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
  ownerAnswerTiles,
  ownerCardStatuses,
  ownerHomeLines,
  parseOwnerNumber,
  type OwnerBooks,
} from "@/lib/owner-answers";
import { ownerPresence, type OwnerTalk } from "@/lib/owner-presence";
import { resolvePriorSnapshot, type SnapshotRow } from "@/lib/prior-period";
import type { SavedCashflowLike } from "@/lib/cash-runway";
import { runBotTransition, ownerBotKey } from "./owner-bot-motion";
import { OwnerChat, type OwnerChatTurn } from "./owner-chat";
import {
  advisoryDeliverableTitles,
  ownerDraftTitles,
  ownerNeedsView,
  type BooksLink,
  type OwnerActionRow,
} from "@/lib/owner-needs";
import { OwnerHome } from "./owner-home";
import { canonicalOwnerScreen, OWNER_SIGNED_SECTION_ID } from "@/lib/owner-nav";
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
  focusSigned = false,
  onSignOut,
  topMove = null,
  boards,
  bot = null,
  onBotChange,
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
  /** Scroll the signed-deliverables section into view. */
  focusSigned?: boolean;
  onSignOut: () => void;
  /** Top ranked next move. Empty stays an honest line under the advisor. */
  topMove?: string | null;
  boards?: (
    go: (screen: OwnerScreen) => void,
  ) => Partial<Record<"health" | "cash" | "budget" | "tasks" | "profit" | "moves", ReactNode>>;
  bot?: AgentKey | null;
  onBotChange?: (agent: AgentKey | null, mode: "push" | "replace") => void;
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
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<OwnerChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const [actionsReady, setActionsReady] = useState(false);
  const [firmName, setFirmName] = useState<string | null>(null);
  const [visitor, setVisitor] = useState<"za" | "us" | null>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const screenRef = useRef(screen);
  const agentRef = useRef(agent);
  const pushedRef = useRef(false);
  const botHydrated = useRef(false);
  const signedFocused = useRef(false);
  screenRef.current = screen;
  agentRef.current = agent;

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
  }, []);

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
    setLedger(null);
    setOpenAction(null);
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
    ]).then(([qbo, xero, actions, drafts]) => {
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
        setActionRows([]);
        setActionsUnavailable(true);
        setActionsReady(true);
        return;
      }
      const rows = (actions.data ?? []).flatMap((row) => {
        const title = row.title?.trim() ?? "";
        if (!title || !row.id) return [];
        return [{ title, email: row.owner_email }];
      });
      setActionRows(rows);
      setOpenAction(rows[0]?.title ?? null);
      setActionsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId, market]);

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
      receivables: parseOwnerNumber(receivables),
      cashflow,
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
  const presence = ownerPresence(activity, talk);
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
        setAgent(next);
        setError(null);
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
      setAgent(next);
      setError(null);
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

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    if (!clientId) {
      setError("Your business is still linking.");
      return;
    }
    setDraft("");
    setError(null);
    setMessages((current) => [...current, { role: "owner", text: question }]);
    setBusy(true);
    setTalk({ agent, mode: "working" });
    const result = await askOwnerAgent({ clientId, agent, question });
    setBusy(false);
    if (!result.ok) {
      setTalk(null);
      setError(result.error);
      return;
    }
    setMessages((current) => [...current, { role: "agent", text: result.answer }]);
    speak(result.answer);
  }

  function speak(answer: string) {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) {
      setTalk(null);
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(answer);
    utterance.onstart = () => setTalk({ agent, mode: "speaking" });
    utterance.onend = () => setTalk(null);
    utterance.onerror = () => setTalk(null);
    setTalk({ agent, mode: "speaking" });
    synth.speak(utterance);
  }

  function listen() {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      setTalk(null);
      return;
    }
    const rec = speechRecognition();
    if (!rec) {
      setError("Voice is not available in this browser.");
      return;
    }
    rec.lang = market.locale || "en";
    rec.interimResults = false;
    rec.onresult = (event) => {
      const said = event.results[0]?.[0]?.transcript?.trim() ?? "";
      if (said) setDraft(said);
    };
    rec.onerror = () => {
      setListening(false);
      setTalk(null);
      setError("Voice did not catch that.");
    };
    rec.onend = () => {
      setListening(false);
      setTalk((current) => (current?.mode === "listening" ? null : current));
    };
    recRef.current = rec;
    setError(null);
    setListening(true);
    setTalk({ agent, mode: "listening" });
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
          lines={ownerHomeLines(tiles, topMove)}
          status={ownerCardStatuses(books)}
          onOpen={openChat}
          onAsk={openChat}
          runState={runState}
          needs={needs}
          onMoves={() => go("moves")}
          onDeliverables={() => go("deliverables")}
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
          sentence={active.sentence}
          messages={messages}
          draft={draft}
          listening={listening}
          busy={busy}
          error={error}
          onDraft={setDraft}
          onSend={() => void send(draft)}
          onListen={listen}
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
        <OwnerPlan visitor={visitor} accountantOnMilon={Boolean(firmId)} firmName={firmName} />
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
          accountantOnMilon={Boolean(firmId)}
          firmName={firmName}
          onProfile={onProfile}
          onQuickBooks={onQuickBooks}
          onXero={onXero}
          onBack={leaveSettings}
          onAccount={onAccount}
        />
      ) : null}
    </OwnerShell>
  );
}
