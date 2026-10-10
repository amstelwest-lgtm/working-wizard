/**
 * Live owner door. Figures come from the books, the forecast, action points,
 * and accountant sign-offs. Empty reads stay empty.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { InviteAccountantCard } from "@/components/invite-accountant-card";
import { useAgentActivity } from "@/hooks/use-agent-activity";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/lib/market/format";
import type { ResolvedMarket } from "@/lib/market/types";
import type { AgentKey } from "@/lib/milon-team-feed";
import { askOwnerAgent } from "@/lib/owner-ask";
import {
  ownerAnswerTiles,
  parseOwnerNumber,
  type OwnerBooks,
  type OwnerTile,
} from "@/lib/owner-answers";
import { ownerPresence, type OwnerTalk } from "@/lib/owner-presence";
import { resolvePriorSnapshot, type SnapshotRow } from "@/lib/prior-period";
import type { SavedCashflowLike } from "@/lib/cash-runway";
import { OwnerChat, type OwnerChatTurn } from "./owner-chat";
import { OwnerHome } from "./owner-home";
import { holdFor } from "./owner-sections";
import { OwnerHold, OwnerShell, type OwnerScreen } from "./owner-shell";

type Signoff = { signed_off_by_name: string; signed_off_at: string };

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
  workspaces,
  onSwitch,
  onConnect,
  onProfile,
  onSettings,
  onSignOut,
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
  workspaces: { clientId: string; name: string }[];
  onSwitch: (clientId: string) => void;
  onConnect: () => void;
  onProfile: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const activity = useAgentActivity(clientId ?? "");
  const [screen, setScreen] = useState<OwnerScreen>("home");
  const [agent, setAgent] = useState<AgentKey>("financial_manager");
  const [talk, setTalk] = useState<OwnerTalk>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<OwnerChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [ledger, setLedger] = useState<"QuickBooks" | "Xero" | null>(null);
  const [openAction, setOpenAction] = useState<string | null>(null);
  const [actionsReady, setActionsReady] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);

  useEffect(() => {
    setLedger(null);
    setOpenAction(null);
    setActionsReady(false);
    if (!clientId) {
      setActionsReady(true);
      return;
    }
    let cancelled = false;
    void Promise.all([
      supabase.from("qbo_connections").select("id").eq("client_id", clientId).limit(1),
      supabase.from("xero_connections").select("id").eq("client_id", clientId).limit(1),
      supabase
        .from("action_items")
        .select("title, status")
        .eq("client_id", clientId)
        .neq("status", "done")
        .order("seq", { ascending: true })
        .limit(1),
    ]).then(([qbo, xero, actions]) => {
      if (cancelled) return;
      if (!qbo.error && (qbo.data?.length ?? 0) > 0) setLedger("QuickBooks");
      else if (!xero.error && (xero.data?.length ?? 0) > 0) setLedger("Xero");
      else setLedger(null);
      if (actions.error) {
        setOpenAction(null);
        setActionsReady(true);
        return;
      }
      const title = actions.data?.[0]?.title?.trim() ?? "";
      setOpenAction(title || null);
      setActionsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

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
  const presence = ownerPresence(activity, talk);
  const active = presence.agents.find((item) => item.agent === agent) ?? presence.agents[0];

  function openChat(next: AgentKey) {
    setAgent(next);
    setError(null);
    setScreen("chat");
  }

  function onTile(tile: OwnerTile) {
    if (
      tile.empty &&
      !hasBooks &&
      (tile.id === "cash" || tile.id === "owes" || tile.id === "profit")
    ) {
      onConnect();
      return;
    }
    if (tile.id === "signed" && tile.empty) {
      setScreen("accountant");
      return;
    }
    if (tile.id === "signed") {
      setScreen("deliverables");
      return;
    }
    if (tile.id === "answer") {
      setScreen("actions");
      return;
    }
    if (tile.ask) openChat(tile.ask);
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

  const hold = holdFor(screen, tiles, {
    onConnect,
    onInvite: () => setScreen("accountant"),
    onHome: () => setScreen("home"),
  });

  return (
    <OwnerShell
      screen={screen}
      businessName={businessName}
      initials={initialsFrom(businessName)}
      workspaces={workspaces}
      activeClientId={clientId}
      onSwitch={onSwitch}
      onNavigate={setScreen}
      onSignOut={onSignOut}
      onSettings={onSettings}
      onProfile={onProfile}
    >
      {screen === "home" ? (
        <OwnerHome
          variant="character"
          presence={presence}
          tiles={tiles}
          onOpen={openChat}
          onAsk={openChat}
          onTile={onTile}
        />
      ) : null}
      {screen === "chat" && active ? (
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
          onBack={() => setScreen("home")}
        />
      ) : null}
      {screen === "accountant" ? (
        <section className="owner-hold">
          <h1 className="owner-title">Accountant</h1>
          <p className="owner-lede">{tiles.find((tile) => tile.id === "signed")?.sentence}</p>
          {clientId ? <InviteAccountantCard clientId={clientId} tone="settings" /> : null}
          <button type="button" className="owner-ask" onClick={onConnect}>
            Connect your books
          </button>
        </section>
      ) : null}
      {hold && screen !== "home" && screen !== "chat" && screen !== "accountant" ? (
        <OwnerHold title={hold.title} sentence={hold.sentence} action={hold.action} />
      ) : null}
    </OwnerShell>
  );
}
