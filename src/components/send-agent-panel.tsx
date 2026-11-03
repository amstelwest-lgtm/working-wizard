/**
 * Accountant action: pick an agent, then a mission on the next step, an
 * optional note, and send. The invite goes out only when Send is clicked.
 * Copy link copies the /a address. The address is not printed on the page.
 * The mission report letter stays off this surface.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AccountantSendFileList, type ShownFilePassword } from "@/components/accountant-send-files";
import { SilentAgentPortrait } from "@/components/silent-agent-portrait";
import { clientDocumentDownloadUrl } from "@/lib/client-documents-browser";
import { FILE_PASSWORD_HIDE_MS } from "@/lib/client-agent-file-password-reveal";
import {
  missionsForAgent,
  missionTitle,
  normalizeSendAgent,
  sendAgentFace,
  sendAgentJobLine,
  sendAgentsForMarket,
  sendAgentShortName,
  sendProgressSteps,
  type MissionKey,
  type SendAgentKey,
  type SendFeedEvent,
  type SendProgressStep,
} from "@/lib/client-agent-missions";
import { formatDate, type DateMarket } from "@/lib/market";
import {
  listClientAgentSends,
  mintClientAgentSend,
  reviewClientAgentSend,
  revealClientAgentFilePassword,
  revokeClientAgentSend,
  sealClientAgentFilePassword,
  type AgentSendRow,
} from "@/lib/client-agent-send.functions";

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-[#0B5FFF] px-4 text-sm font-semibold text-white hover:bg-[#2563EB] disabled:opacity-60";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-[#0B5FFF] bg-white px-4 text-sm font-semibold text-[#102A43] hover:bg-[#F4F8FF] disabled:opacity-60";

const LINK_STORAGE = "milon.send-agent-link.";

function readStoredLink(sendId: string): string | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const value = sessionStorage.getItem(LINK_STORAGE + sendId);
    if (!value || !value.includes("/a/")) return null;
    return value;
  } catch {
    return null;
  }
}

function storeLink(sendId: string, url: string) {
  try {
    sessionStorage.setItem(LINK_STORAGE + sendId, url);
  } catch {
    // The button still works until this page is left.
  }
}

function forgetLink(sendId: string) {
  try {
    sessionStorage.removeItem(LINK_STORAGE + sendId);
  } catch {
    // The in-memory copy is cleared either way.
  }
}

export function SendAgentPanel({
  clientId,
  market,
  country,
}: {
  clientId: string;
  market: DateMarket;
  country: string | null;
}) {
  const list = useServerFn(listClientAgentSends);
  const mint = useServerFn(mintClientAgentSend);
  const revoke = useServerFn(revokeClientAgentSend);
  const review = useServerFn(reviewClientAgentSend);
  const reveal = useServerFn(revealClientAgentFilePassword);
  const seal = useServerFn(sealClientAgentFilePassword);
  const [sends, setSends] = useState<AgentSendRow[]>([]);
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [agent, setAgent] = useState<SendAgentKey | null>(null);
  const [surface, setSurface] = useState<"pick" | "mission">("pick");
  const [missionKey, setMissionKey] = useState<MissionKey | null>(null);
  const [firmNote, setFirmNote] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [emailEdited, setEmailEdited] = useState(false);
  const [revealed, setRevealed] = useState<ShownFilePassword | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [passwordBusy, setPasswordBusy] = useState<string | null>(null);
  const [seenClientId, setSeenClientId] = useState(clientId);
  if (seenClientId !== clientId) {
    setSeenClientId(clientId);
    setRevealed(null);
    setSurface("pick");
    setAgent(null);
    setMissionKey(null);
  }
  const revealedFileId = revealed?.fileId ?? null;

  const applyList = useCallback(
    (result: {
      allowed: boolean;
      migrated: boolean;
      sends: AgentSendRow[];
      contactEmail?: string | null;
    }) => {
      setSends(result.allowed ? result.sends : []);
      setAllowed(result.allowed);
      setReady(result.migrated && result.allowed);
      setLoaded(true);
      if (!emailEdited && result.contactEmail) setEmail(result.contactEmail);
    },
    [emailEdited],
  );

  const reload = useCallback(async () => {
    const result = await list({ data: { clientId } });
    applyList(result);
  }, [applyList, clientId, list]);

  useEffect(() => {
    if (!revealedFileId) return undefined;
    const timer = window.setTimeout(() => {
      setRevealed(null);
    }, FILE_PASSWORD_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [revealedFileId]);

  useEffect(() => {
    const stored: Record<string, string> = {};
    for (const send of sends) {
      const url = readStoredLink(send.id);
      if (url) stored[send.id] = url;
    }
    if (Object.keys(stored).length === 0) return;
    setLinks((current) => ({ ...stored, ...current }));
  }, [sends]);

  const linkForSend = (sendId: string) => links[sendId] ?? readStoredLink(sendId);

  const onCopyLink = async (sendId: string) => {
    const url = linkForSend(sendId);
    if (!url) {
      setNotice("Resend the link, then copy it.");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Link copied.");
    } catch {
      setNotice("The link could not be copied. It is also in the email.");
    }
  };

  const onOpenLink = (sendId: string) => {
    const url = linkForSend(sendId);
    if (!url) {
      setNotice("Resend the link, then open it.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  useEffect(() => {
    let alive = true;
    void list({ data: { clientId } })
      .then((result) => {
        if (!alive) return;
        applyList(result);
      })
      .catch(() => {
        if (!alive) return;
        setReady(false);
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [applyList, clientId, list]);

  const open = sends.find((send) => send.open) ?? null;
  const agents = sendAgentsForMarket(country);
  const missions = agent ? missionsForAgent(agent, country) : [];

  const onMint = async (resendSendId?: string) => {
    const target = resendSendId ? sends.find((send) => send.id === resendSendId) : null;
    const nextAgent = target ? normalizeSendAgent(target.agent) : agent;
    const nextMission =
      target?.missionKey &&
      missionsForAgent(target.agent, country).includes(target.missionKey as MissionKey)
        ? (target.missionKey as MissionKey)
        : missionKey;
    if (!nextAgent || !nextMission) {
      setNotice("Choose an agent and a mission.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await mint({
        data: {
          clientId,
          recipientEmail: email,
          recipientFirstName: firstName,
          agent: nextAgent,
          missionKey: nextMission,
          firmNote,
          ...(resendSendId ? { resendSendId } : {}),
        },
      });
      if (!result.ok && result.reason === "not_allowed") {
        setAllowed(false);
        setReady(false);
        return;
      }
      if (!result.ok && result.reason === "address") {
        setNotice("Enter the email address, then send.");
        return;
      }
      if (!result.ok && result.reason === "name") {
        setNotice("Use a shorter first name.");
        return;
      }
      if (!result.ok && result.reason === "note") {
        setNotice("Keep the note to 500 characters.");
        return;
      }
      if (!result.ok && result.reason === "agent") {
        setNotice("Choose an agent for this client.");
        return;
      }
      if (!result.ok && result.reason === "mission") {
        setNotice("Choose a mission this agent can run.");
        return;
      }
      if (!result.ok && result.reason === "email") {
        setNotice("The invite could not be sent.");
        return;
      }
      if (!result.ok && result.reason === "already_open") {
        setNotice(
          `A link is already active until ${formatDate(result.expiresAt, market)}. Resend it, or cancel it, before sending another.`,
        );
        await reload();
        return;
      }
      if (!result.ok) {
        setNotice("The link could not be created.");
        return;
      }
      setNotice("Sent.");
      setFirmNote("");
      setSurface("pick");
      setAgent(null);
      setMissionKey(null);
      storeLink(result.sendId, result.url);
      setLinks((current) => ({ ...current, [result.sendId]: result.url }));
      await reload();
    } catch {
      setNotice("The link could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (sendId: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await revoke({ data: { clientId, sendId } });
      if (!result.ok) {
        setNotice("The link could not be revoked.");
        return;
      }
      forgetLink(sendId);
      setLinks((current) => {
        const next = { ...current };
        delete next[sendId];
        return next;
      });
      await reload();
    } catch {
      setNotice("The link could not be revoked.");
    } finally {
      setBusy(false);
    }
  };

  const onCancel = (sendId: string) => {
    const send = sends.find((row) => row.id === sendId);
    if (!send?.open) {
      setNotice("This link is already closed.");
      return;
    }
    void onRevoke(sendId);
  };

  const onShowPassword = async (fileId: string) => {
    setPasswordBusy(fileId);
    setNotice(null);
    try {
      const result = await reveal({ data: { clientId, fileId } });
      if (!result.ok || result.password == null || result.password === "") {
        setRevealed(null);
        setNotice(result.ok ? "No password on this file." : "The password could not be shown.");
        return;
      }
      setRevealed({ fileId, password: result.password, visible: false });
    } catch {
      setRevealed(null);
      setNotice("The password could not be shown.");
    } finally {
      setPasswordBusy(null);
    }
  };

  const onSealPassword = async (fileId: string, password: string) => {
    setPasswordBusy(fileId);
    setNotice(null);
    try {
      const result = await seal({ data: { clientId, fileId, password } });
      if (!result.ok) {
        setNotice(
          result.reason === "already"
            ? "This file already has a saved password."
            : "The password could not be saved.",
        );
        return;
      }
      setNotice("Password saved.");
      await reload();
    } catch {
      setNotice("The password could not be saved.");
    } finally {
      setPasswordBusy(null);
    }
  };

  const onCopyPassword = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.password);
      setNotice("Copied.");
    } catch {
      setNotice("Select the password and copy it.");
    }
  };

  const onTogglePassword = () => {
    setRevealed((current) => (current ? { ...current, visible: !current.visible } : current));
  };

  const onOpenDocument = async (path: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const url = await clientDocumentDownloadUrl(path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setNotice("That document could not be opened.");
    } finally {
      setBusy(false);
    }
  };

  const onReview = async (sendId: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await review({ data: { clientId, sendId } });
      if (!result.ok) {
        setNotice("That could not be saved.");
        return;
      }
      await reload();
    } catch {
      setNotice("That could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  if (!allowed && loaded) return null;

  return (
    <SendAgentCard
      country={country}
      market={market}
      agents={agents}
      missions={missions}
      agent={agent}
      missionKey={missionKey}
      firmNote={firmNote}
      firstName={firstName}
      email={email}
      sends={sends}
      open={open}
      busy={busy}
      ready={ready}
      loaded={loaded}
      notice={notice}
      surface={surface}
      onAgent={(next) => {
        if (next !== agent) setMissionKey(null);
        setAgent(next);
        setSurface("mission");
      }}
      onBack={() => setSurface("pick")}
      onMission={setMissionKey}
      onFirmNote={setFirmNote}
      onFirstName={setFirstName}
      onEmail={(value) => {
        setEmailEdited(true);
        setEmail(value);
      }}
      onMint={() => void onMint()}
      onResend={(sendId) => void onMint(sendId)}
      onRevoke={(sendId) => onCancel(sendId)}
      onOpenLink={onOpenLink}
      linkFor={(sendId) => links[sendId] ?? null}
      onCopyLink={(sendId) => void onCopyLink(sendId)}
      onReview={(sendId) => void onReview(sendId)}
      onOpenDocument={(path) => void onOpenDocument(path)}
      fileList={
        <AccountantSendFileList
          files={sends.flatMap((send) => send.files ?? [])}
          revealed={revealed}
          busyFileId={passwordBusy}
          onShow={(fileId) => void onShowPassword(fileId)}
          onToggleVisible={onTogglePassword}
          onCopy={() => void onCopyPassword()}
          onOpen={(documentPath) => void onOpenDocument(documentPath)}
          onSeal={(fileId, password) => void onSealPassword(fileId, password)}
        />
      }
    />
  );
}

function SendProgress({
  steps,
  when,
}: {
  steps: readonly SendProgressStep[];
  when: (id: SendProgressStep["id"]) => string | null;
}) {
  const current = steps.find((step) => step.state === "now");
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl border border-[#DBEAFE] bg-white p-3"
      data-send-progress=""
    >
      <h3 className="text-base font-semibold">Progress</h3>
      <p className="text-sm font-semibold" data-send-agent-status="">
        {current?.detail ?? "Reviewed. Nothing is waiting."}
      </p>
      <ol className="flex flex-col border-t border-[#DBEAFE]">
        {steps.map((step) => {
          const date = when(step.id);
          return (
            <li
              key={step.id}
              className="grid grid-cols-[0.75rem_minmax(0,1fr)] gap-3 border-b border-[#DBEAFE] py-3"
              data-send-progress-step={step.id}
              data-send-progress-state={step.state}
            >
              <span
                aria-hidden="true"
                className={
                  step.state === "done"
                    ? "mt-1 h-3 w-3 rounded-full bg-[#0B5FFF]"
                    : step.state === "now"
                      ? "mt-1 h-3 w-3 rounded-full border-2 border-[#0B5FFF] bg-[#0B5FFF]"
                      : "mt-1 h-3 w-3 rounded-full border-2 border-[#DBEAFE] bg-white"
                }
              />
              <span className="flex flex-col gap-1">
                <span
                  className={
                    step.state === "waiting"
                      ? "text-sm text-[#3D5270]"
                      : "text-sm font-semibold text-[#102A43]"
                  }
                >
                  {step.label}
                  {step.state === "done"
                    ? " · Done"
                    : step.state === "now"
                      ? " · Now"
                      : " · Waiting"}
                </span>
                <span className="text-sm leading-6 text-[#3D5270]">
                  {step.detail}
                  {date ? ` ${date}` : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function feedLine(event: SendFeedEvent, market: DateMarket): string {
  const when = event.at ? formatDate(event.at, market) : "";
  if (event.kind === "sent") return `Sent ${when}`;
  if (event.kind === "opened") return `Opened ${when}`;
  if (event.kind === "done") return `I'm done ${when}`;
  if (event.kind === "file") return `${event.label} (${event.mime || "file"}) ${when}`;
  const who = event.role === "client" ? "Client" : "Agent";
  return `${who}: ${event.body}`;
}

export function SendAgentCard({
  country,
  market,
  agents,
  missions,
  agent,
  missionKey,
  firmNote,
  firstName,
  email,
  sends,
  open,
  busy,
  ready,
  loaded,
  notice,
  onAgent,
  onMission,
  onFirmNote,
  onFirstName,
  onEmail,
  onMint,
  onResend,
  onRevoke,
  linkFor,
  onCopyLink,
  onReview,
  onOpenDocument,
  onOpenLink,
  onBack,
  surface: surfaceProp,
  fileList = null,
}: {
  country: string | null;
  market: DateMarket;
  agents: readonly SendAgentKey[];
  missions: readonly MissionKey[];
  agent: SendAgentKey | null;
  missionKey: MissionKey | null;
  firmNote: string;
  firstName: string;
  email: string;
  sends: readonly AgentSendRow[];
  open: { id: string; expiresAt: string } | null;
  busy: boolean;
  ready: boolean;
  loaded: boolean;
  notice: string | null;
  onAgent: (agent: SendAgentKey) => void;
  onMission: (mission: MissionKey) => void;
  onFirmNote: (value: string) => void;
  onFirstName: (value: string) => void;
  onEmail: (value: string) => void;
  onMint: () => void;
  onResend: (sendId: string) => void;
  onRevoke: (sendId: string) => void;
  linkFor: (sendId: string) => string | null;
  onCopyLink: (sendId: string) => void;
  onReview: (sendId: string) => void;
  onOpenDocument: (path: string) => void;
  onOpenLink?: (sendId: string) => void;
  onBack?: () => void;
  /** pick is the agent list. mission is the next step. */
  surface?: "pick" | "mission";
  fileList?: ReactNode;
}) {
  const [ownSurface, setOwnSurface] = useState<"pick" | "mission">("pick");
  const surface = surfaceProp ?? ownSurface;
  const showMission = surface === "mission" && agent != null;
  const chooseAgent = (key: SendAgentKey) => {
    onAgent(key);
    if (surfaceProp == null) setOwnSurface("mission");
  };
  const leaveMission = () => {
    onBack?.();
    if (surfaceProp == null) setOwnSurface("pick");
  };

  return (
    <section
      className="flex flex-col gap-4 bg-white text-[#102A43]"
      data-send-agent=""
      data-send-agent-step={showMission ? "mission" : "pick"}
      data-send-market={country ?? "unknown"}
    >
      {!loaded ? <p className="text-sm text-[#3D5270]">Opening Send an agent.</p> : null}
      {loaded && !ready ? (
        <p className="text-sm text-[#3D5270]">Send an agent is not available yet.</p>
      ) : null}
      {showMission && agent ? (
        <MissionStep
          agent={agent}
          missions={missions}
          missionKey={missionKey}
          firmNote={firmNote}
          firstName={firstName}
          email={email}
          busy={busy}
          ready={ready}
          blocked={Boolean(open)}
          notice={notice}
          onBack={leaveMission}
          onMission={onMission}
          onFirmNote={onFirmNote}
          onFirstName={onFirstName}
          onEmail={onEmail}
          onMint={onMint}
        />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">Choose who to send</h2>
            <p className="text-sm leading-6 text-[#3D5270]">
              Select one agent. The card you click is the person the client will see.
            </p>
          </div>
          <div className="flex flex-col gap-3" data-send-agent-picker="">
            {agents.map((key) => {
              const selected = agent === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={
                    selected
                      ? "flex min-h-11 flex-col items-start gap-2 rounded-2xl border-2 border-[#0B5FFF] bg-[#F4F8FF] p-3 text-left"
                      : "flex min-h-11 flex-col items-start gap-2 rounded-2xl border border-[#DBEAFE] bg-white p-3 text-left"
                  }
                  aria-pressed={selected}
                  data-send-agent-selected={selected ? "true" : "false"}
                  disabled={!ready || busy}
                  onClick={() => chooseAgent(key)}
                >
                  <span className="relative h-16 w-16 overflow-hidden rounded-2xl bg-[#DBEAFE] [&_img]:absolute [&_img]:inset-0 [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_video]:absolute [&_video]:inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover">
                    <SilentAgentPortrait
                      face={sendAgentFace(key)}
                      label={sendAgentShortName(key)}
                    />
                  </span>
                  <span className="text-sm font-semibold">{sendAgentShortName(key)}</span>
                  <span className="text-sm leading-6 text-[#3D5270]">{sendAgentJobLine(key)}</span>
                  <span
                    className={
                      selected ? "text-sm font-semibold text-[#0B5FFF]" : "text-sm text-[#3D5270]"
                    }
                  >
                    {selected ? "Selected" : "Select this agent"}
                  </span>
                </button>
              );
            })}
          </div>
          {notice ? <p className="text-sm text-[#3D5270]">{notice}</p> : null}
          {sends.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Sent missions</h2>
              {sends.map((send) => (
                <MissionCard
                  key={send.id}
                  send={send}
                  market={market}
                  busy={busy}
                  onOpen={() => {
                    const known = linkFor(send.id);
                    if (onOpenLink) onOpenLink(send.id);
                    else if (known) window.open(known, "_blank", "noopener,noreferrer");
                  }}
                  onCopy={() => onCopyLink(send.id)}
                  onResend={() => onResend(send.id)}
                  onCancel={() => onRevoke(send.id)}
                  onReview={() => onReview(send.id)}
                  onOpenDocument={onOpenDocument}
                />
              ))}
            </div>
          ) : null}
          {fileList}
        </>
      )}
    </section>
  );
}

const MENU =
  "inline-flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-semibold text-[#102A43] hover:bg-[#F4F8FF] disabled:opacity-60";

function MissionActionMenu({
  sendId,
  label,
  busy,
  onOpen,
  onCopy,
  onResend,
  onCancel,
}: {
  sendId: string;
  label: string;
  busy: boolean;
  onOpen: () => void;
  onCopy: () => void;
  onResend: () => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <div className="flex flex-col gap-2" data-send-mission-actions={sendId}>
      <button
        type="button"
        className={SECONDARY}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Actions for ${label}`}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        Actions
      </button>
      {open ? (
        <div
          role="menu"
          className="flex flex-col gap-1 rounded-2xl border border-[#DBEAFE] bg-white p-2"
        >
          <button
            type="button"
            role="menuitem"
            className={MENU}
            data-send-agent-open=""
            disabled={busy}
            onClick={() => run(onOpen)}
          >
            Open
          </button>
          <button
            type="button"
            role="menuitem"
            className={MENU}
            data-send-agent-copy=""
            disabled={busy}
            onClick={() => run(onCopy)}
          >
            Copy link
          </button>
          <button
            type="button"
            role="menuitem"
            className={MENU}
            data-send-agent-resend=""
            disabled={busy}
            onClick={() => run(onResend)}
          >
            Resend
          </button>
          <button
            type="button"
            role="menuitem"
            className={MENU}
            data-send-agent-revoke=""
            disabled={busy}
            onClick={() => run(onCancel)}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}

function missionStage(send: AgentSendRow): string {
  if (send.revokedAt) return "Cancelled";
  return send.statusLabel ?? "Sent";
}

function MissionCard({
  send,
  market,
  busy,
  onOpen,
  onCopy,
  onResend,
  onCancel,
  onReview,
  onOpenDocument,
}: {
  send: AgentSendRow;
  market: DateMarket;
  busy: boolean;
  onOpen: () => void;
  onCopy: () => void;
  onResend: () => void;
  onCancel: () => void;
  onReview: () => void;
  onOpenDocument: (path: string) => void;
}) {
  const agentKey = normalizeSendAgent(send.agent) ?? "tax_specialist";
  const sentOn = send.createdAt ? formatDate(send.createdAt, market) : null;
  return (
    <article
      className="flex flex-col gap-3 rounded-2xl border border-[#DBEAFE] bg-white p-4 text-[#102A43]"
      data-send-mission-card={send.id}
      data-send-agent-history={agentKey}
    >
      <p className="text-sm font-semibold text-[#0B5FFF]" data-send-mission-stage="">
        {missionStage(send)}
      </p>
      <h3 className="text-base font-semibold">{sendAgentShortName(send.agent)}</h3>
      <p className="text-sm font-semibold">{send.missionTitle ?? "Collect documents"}</p>
      <p className="text-sm text-[#3D5270]" data-send-mission-sent="">
        {sentOn ? `Sent ${sentOn}` : "Sent"}
      </p>
      <p className="text-sm text-[#3D5270]" data-send-link-state="">
        {send.revokedAt
          ? `Cancelled ${formatDate(send.revokedAt, market)}`
          : send.open
            ? `Open until ${formatDate(send.expiresAt, market)}`
            : "This link has expired"}
      </p>
      {send.files.length > 0 ? (
        <p className="text-sm text-[#3D5270]">
          {send.files.length === 1
            ? "1 document in Client library"
            : `${send.files.length} documents in Client library`}
        </p>
      ) : null}
      <MissionActionMenu
        sendId={send.id}
        label={`${sendAgentShortName(send.agent)}, ${send.missionTitle ?? "Collect documents"}`}
        busy={busy}
        onOpen={onOpen}
        onCopy={onCopy}
        onResend={onResend}
        onCancel={onCancel}
      />
      <SendProgress
        steps={sendProgressSteps({
          opened: Boolean(send.openedAt || send.consentAt),
          replied: Boolean(send.repliedAt),
          documents: Boolean(send.docsReceivedAt || send.completedAt),
          reviewed: Boolean(send.reviewedAt),
        })}
        when={(id) => {
          const at =
            id === "sent"
              ? send.createdAt
              : id === "opened"
                ? send.openedAt || send.consentAt
                : id === "replied"
                  ? send.repliedAt
                  : id === "documents"
                    ? send.docsReceivedAt || send.completedAt
                    : send.reviewedAt;
          return at ? formatDate(at, market) : null;
        }}
      />
      {send.viewerIsSender && send.feed ? (
        <div className="flex flex-col gap-2" data-send-agent-feed="">
          {send.feed.map((event, index) => (
            <div key={`${event.kind}-${index}`} className="flex flex-col gap-1">
              <p className="text-sm leading-6">{feedLine(event, market)}</p>
              {event.kind === "file" && event.documentPath ? (
                <button
                  type="button"
                  className={SECONDARY}
                  disabled={busy}
                  onClick={() => onOpenDocument(event.documentPath ?? "")}
                >
                  Open in Client library
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {send.completedAt ? (
        <div className="flex flex-col gap-2" data-send-agent-received="">
          {send.reviewedAt ? (
            <p className="text-sm text-[#3D5270]">Reviewed</p>
          ) : (
            <button
              type="button"
              className={PRIMARY}
              data-mark-reviewed=""
              disabled={busy}
              onClick={onReview}
            >
              Mark reviewed
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}

function MissionStep({
  agent,
  missions,
  missionKey,
  firmNote,
  firstName,
  email,
  busy,
  ready,
  blocked,
  notice,
  onBack,
  onMission,
  onFirmNote,
  onFirstName,
  onEmail,
  onMint,
}: {
  agent: SendAgentKey;
  missions: readonly MissionKey[];
  missionKey: MissionKey | null;
  firmNote: string;
  firstName: string;
  email: string;
  busy: boolean;
  ready: boolean;
  blocked: boolean;
  notice: string | null;
  onBack: () => void;
  onMission: (mission: MissionKey) => void;
  onFirmNote: (value: string) => void;
  onFirstName: (value: string) => void;
  onEmail: (value: string) => void;
  onMint: () => void;
}) {
  return (
    <div className="flex flex-col gap-4" data-send-mission="">
      <button
        type="button"
        className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-[#0B5FFF]"
        data-send-agent-back=""
        onClick={onBack}
      >
        Back
      </button>
      <span className="relative h-16 w-16 overflow-hidden rounded-2xl bg-[#DBEAFE] [&_img]:absolute [&_img]:inset-0 [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_video]:absolute [&_video]:inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover">
        <SilentAgentPortrait face={sendAgentFace(agent)} label={sendAgentShortName(agent)} />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">{sendAgentShortName(agent)}</h2>
        <p className="text-sm leading-6 text-[#3D5270]">{sendAgentJobLine(agent)}</p>
      </div>
      <h3 className="text-base font-semibold">Choose a mission</h3>
      <div className="flex flex-col gap-2">
        {missions.map((key) => {
          const selected = missionKey === key;
          return (
            <button
              key={key}
              type="button"
              className={
                selected
                  ? "flex min-h-11 flex-col items-start gap-1 rounded-2xl border-2 border-[#0B5FFF] bg-[#F4F8FF] p-3 text-left"
                  : "flex min-h-11 flex-col items-start gap-1 rounded-2xl border border-[#DBEAFE] bg-white p-3 text-left"
              }
              aria-pressed={selected}
              disabled={busy}
              onClick={() => onMission(key)}
            >
              <span className="text-sm font-semibold text-[#102A43]">{missionTitle(key)}</span>
            </button>
          );
        })}
      </div>
      {missionKey ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm" htmlFor="send-agent-note">
            Note for the agent (optional)
            <textarea
              id="send-agent-note"
              className="min-h-24 rounded-xl border border-[#DBEAFE] bg-white px-3 py-2"
              maxLength={500}
              value={firmNote}
              disabled={busy || blocked}
              onChange={(event) => onFirmNote(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="send-agent-first-name">
            Client first name
            <input
              id="send-agent-first-name"
              className="min-h-11 rounded-xl border border-[#DBEAFE] bg-white px-3"
              value={firstName}
              disabled={busy}
              onChange={(event) => onFirstName(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="send-agent-email">
            Confirm this address
            <input
              id="send-agent-email"
              type="email"
              className="min-h-11 rounded-xl border border-[#DBEAFE] bg-white px-3"
              value={email}
              disabled={busy}
              onChange={(event) => onEmail(event.target.value)}
            />
          </label>
          {blocked ? (
            <p className="text-sm text-[#3D5270]">
              A link is already open. Go back to resend it or cancel it before sending another.
            </p>
          ) : null}
          <button
            type="button"
            className={PRIMARY}
            disabled={!ready || busy || blocked}
            onClick={onMint}
          >
            Send
          </button>
        </div>
      ) : null}
      {notice ? <p className="text-sm text-[#3D5270]">{notice}</p> : null}
    </div>
  );
}
