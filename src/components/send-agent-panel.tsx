/**
 * Accountant action: pick an agent, a mission, an optional note, and send.
 * The invite goes out only when Send is clicked. The raw link is not shown.
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
  type MissionKey,
  type SendAgentKey,
  type SendFeedEvent,
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
  const [missionKey, setMissionKey] = useState<MissionKey | null>(null);
  const [firmNote, setFirmNote] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [emailEdited, setEmailEdited] = useState(false);
  const [revealed, setRevealed] = useState<ShownFilePassword | null>(null);
  const [passwordBusy, setPasswordBusy] = useState<string | null>(null);
  const [seenClientId, setSeenClientId] = useState(clientId);
  if (seenClientId !== clientId) {
    setSeenClientId(clientId);
    setRevealed(null);
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
          `A link is already active until ${formatDate(result.expiresAt, market)}. Resend it, or revoke it, before sending another.`,
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
      await reload();
    } catch {
      setNotice("The link could not be revoked.");
    } finally {
      setBusy(false);
    }
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
      onAgent={(next) => {
        setAgent(next);
        setMissionKey(null);
      }}
      onMission={setMissionKey}
      onFirmNote={setFirmNote}
      onFirstName={setFirstName}
      onEmail={(value) => {
        setEmailEdited(true);
        setEmail(value);
      }}
      onMint={() => void onMint()}
      onResend={(sendId) => void onMint(sendId)}
      onRevoke={(sendId) => void onRevoke(sendId)}
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
  onReview,
  onOpenDocument,
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
  onReview: (sendId: string) => void;
  onOpenDocument: (path: string) => void;
  fileList?: ReactNode;
}) {
  const grouped = agents
    .map((key) => ({
      key,
      rows: sends.filter((send) => normalizeSendAgent(send.agent) === key),
    }))
    .filter((group) => group.rows.length > 0);
  const shownIds = new Set(grouped.flatMap((group) => group.rows.map((send) => send.id)));
  const leftover = sends.filter((send) => !shownIds.has(send.id));
  if (leftover.length > 0) {
    const key = normalizeSendAgent(leftover[0]?.agent) ?? "tax_specialist";
    const existing = grouped.find((group) => group.key === key);
    if (existing) existing.rows.push(...leftover);
    else grouped.push({ key, rows: leftover });
  }

  return (
    <section
      className="flex flex-col gap-4 text-[#102A43]"
      data-send-agent=""
      data-send-market={country ?? "unknown"}
    >
      {!loaded ? <p className="text-sm text-[#3D5270]">Opening Send an agent.</p> : null}
      {loaded && !ready ? (
        <p className="text-sm text-[#3D5270]">Send an agent is not available yet.</p>
      ) : null}
      <div className="flex flex-col gap-3" data-send-agent-picker="">
        {agents.map((key) => (
          <button
            key={key}
            type="button"
            className="flex min-h-11 flex-col items-start gap-2 rounded-2xl border border-[#DBEAFE] bg-white p-3 text-left"
            aria-pressed={agent === key}
            disabled={!ready || busy}
            onClick={() => onAgent(key)}
          >
            <span className="relative h-16 w-16 overflow-hidden rounded-2xl bg-[#DBEAFE] [&_img]:absolute [&_img]:inset-0 [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_video]:absolute [&_video]:inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover">
              <SilentAgentPortrait face={sendAgentFace(key)} label={sendAgentShortName(key)} />
            </span>
            <span className="text-sm font-semibold">{sendAgentShortName(key)}</span>
            <span className="text-sm leading-6 text-[#3D5270]">{sendAgentJobLine(key)}</span>
          </button>
        ))}
      </div>
      {agent ? (
        <div className="flex flex-col gap-2" data-send-mission="">
          {missions.map((key) => (
            <button
              key={key}
              type="button"
              className={missionKey === key ? PRIMARY : SECONDARY}
              aria-pressed={missionKey === key}
              disabled={busy}
              onClick={() => onMission(key)}
            >
              {missionTitle(key)}
            </button>
          ))}
        </div>
      ) : null}
      {agent && missionKey ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm" htmlFor="send-agent-note">
            Note for the agent (optional)
            <textarea
              id="send-agent-note"
              className="min-h-24 rounded-xl border border-[#DBEAFE] px-3 py-2"
              maxLength={500}
              value={firmNote}
              disabled={busy || Boolean(open)}
              onChange={(event) => onFirmNote(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="send-agent-first-name">
            Client first name
            <input
              id="send-agent-first-name"
              className="min-h-11 rounded-xl border border-[#DBEAFE] px-3"
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
              className="min-h-11 rounded-xl border border-[#DBEAFE] px-3"
              value={email}
              disabled={busy}
              onChange={(event) => onEmail(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={PRIMARY}
            disabled={!ready || busy || Boolean(open)}
            onClick={onMint}
          >
            Send
          </button>
        </div>
      ) : null}
      {notice ? <p className="text-sm text-[#3D5270]">{notice}</p> : null}
      {grouped.map((group) => {
        const latest = group.rows[0];
        if (!latest) return null;
        const older = group.rows.slice(1);
        return (
          <section
            key={group.key}
            className="flex flex-col gap-3"
            data-send-agent-history={group.key}
          >
            <h2 className="text-sm font-semibold">{sendAgentShortName(group.key)}</h2>
            <p className="text-sm" data-send-agent-status="">
              {latest.statusLabel ?? "Sent"}
              {latest.createdAt ? ` · ${formatDate(latest.createdAt, market)}` : ""}
            </p>
            <p className="text-sm text-[#3D5270]">{latest.missionTitle ?? "Collect documents"}</p>
            {latest.missionKey ? (
              <button
                type="button"
                className={SECONDARY}
                data-send-agent-resend=""
                disabled={busy}
                onClick={() => onResend(latest.id)}
              >
                Resend
              </button>
            ) : null}
            {latest.open ? (
              <button
                type="button"
                className={SECONDARY}
                data-send-agent-revoke=""
                disabled={busy}
                onClick={() => onRevoke(latest.id)}
              >
                Revoke
              </button>
            ) : null}
            {latest.viewerIsSender && latest.feed ? (
              <div className="flex flex-col gap-2" data-send-agent-feed="">
                {latest.feed.map((event, index) => (
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
                {latest.reportSummary ? (
                  <p className="text-sm leading-6">{latest.reportSummary}</p>
                ) : null}
              </div>
            ) : null}
            {latest.completedAt ? (
              <div className="flex flex-col gap-2" data-send-agent-received="">
                {latest.reviewedAt ? (
                  <p className="text-sm text-[#3D5270]">Reviewed</p>
                ) : (
                  <button
                    type="button"
                    className={PRIMARY}
                    data-mark-reviewed=""
                    disabled={busy}
                    onClick={() => onReview(latest.id)}
                  >
                    Mark reviewed
                  </button>
                )}
              </div>
            ) : null}
            {older.map((send) => (
              <p key={send.id} className="text-sm text-[#3D5270]">
                {send.missionTitle ?? "Collect documents"} · {send.statusLabel ?? "Sent"}
                {send.createdAt ? ` · ${formatDate(send.createdAt, market)}` : ""}
              </p>
            ))}
          </section>
        );
      })}
      {fileList}
    </section>
  );
}
