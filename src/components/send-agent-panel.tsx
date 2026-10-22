/**
 * Accountant action: mint a Tax Specialist link and email the invite.
 * The invite goes out only when Send is clicked. Revoke sits with the link.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AccountantSendFileList,
  type ShownFilePassword,
} from "@/components/accountant-send-files";
import { SilentAgentPortrait } from "@/components/silent-agent-portrait";
import {
  SEND_AGENT_BODY,
  SEND_AGENT_ONCE,
  SEND_DEFAULT_ITEM_KEYS,
  SEND_ITEM_KEYS,
  SEND_ITEM_LABELS,
  SEND_OTHER_LABEL_MAX,
  chooseSendItems,
  recipientEmail,
} from "@/lib/client-agent-send";
import { formatDate, type DateMarket } from "@/lib/market";
import { FILE_PASSWORD_HIDE_MS } from "@/lib/client-agent-file-password-reveal";
import {
  listClientAgentSends,
  mintClientAgentSend,
  revealClientAgentFilePassword,
  revokeClientAgentSend,
  type AgentSendRow,
} from "@/lib/client-agent-send.functions";

type FreshLink = { sendId: string; url: string; expiresAt: string };

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-full bg-[#0B5FFF] px-4 text-sm font-semibold text-white hover:bg-[#2563EB] disabled:opacity-60";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-full border border-[#0B5FFF] bg-white px-4 text-sm font-semibold text-[#102A43] hover:bg-[#F4F8FF] disabled:opacity-60";

export function SendAgentPanel({ clientId, market }: { clientId: string; market: DateMarket }) {
  const list = useServerFn(listClientAgentSends);
  const mint = useServerFn(mintClientAgentSend);
  const revoke = useServerFn(revokeClientAgentSend);
  const reveal = useServerFn(revealClientAgentFilePassword);
  const [sends, setSends] = useState<AgentSendRow[]>([]);
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [fresh, setFresh] = useState<FreshLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [emailEdited, setEmailEdited] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([...SEND_DEFAULT_ITEM_KEYS]);
  const [otherLabel, setOtherLabel] = useState("");
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
  const shownId = fresh?.sendId ?? open?.id ?? null;

  const onToggleItem = (itemKey: string) => {
    setSelectedKeys((current) =>
      current.includes(itemKey) ? current.filter((key) => key !== itemKey) : [...current, itemKey],
    );
  };

  const onMint = async () => {
    const chosen = chooseSendItems(
      SEND_ITEM_KEYS.filter((itemKey) => selectedKeys.includes(itemKey)).map((itemKey) => ({
        itemKey,
        label: itemKey === "other" ? otherLabel : undefined,
      })),
    );
    if (!chosen.ok) {
      setNotice(
        chosen.reason === "empty"
          ? "Choose at least one document."
          : chosen.reason === "other"
            ? "Name the other document."
            : "Choose documents from the list.",
      );
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
          items: chosen.items.map((item) => ({ itemKey: item.itemKey, label: item.label })),
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
      if (!result.ok && result.reason === "empty") {
        setNotice("Choose at least one document.");
        return;
      }
      if (!result.ok && result.reason === "other") {
        setNotice("Name the other document.");
        return;
      }
      if (!result.ok && result.reason === "items") {
        setNotice("Choose documents from the list.");
        return;
      }
      if (!result.ok && result.reason === "email") {
        setNotice("The invite could not be sent.");
        return;
      }
      if (!result.ok && result.reason === "already_open") {
        setNotice(
          `A link is already active until ${formatDate(result.expiresAt, market)}. Revoke it before creating another.`,
        );
        await reload();
        return;
      }
      if (!result.ok) {
        setNotice("The link could not be created.");
        return;
      }
      setFresh({ sendId: result.sendId, url: result.url, expiresAt: result.expiresAt });
      await reload();
    } catch {
      setNotice("The link could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async () => {
    if (!shownId) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await revoke({ data: { clientId, sendId: shownId } });
      if (!result.ok) {
        setNotice("The link could not be revoked.");
        return;
      }
      setFresh(null);
      await reload();
    } catch {
      setNotice("The link could not be revoked.");
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.url);
      setNotice("Link copied.");
    } catch {
      setNotice("Select the link and copy it.");
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

  const onCopyPassword = async () => {
    if (!revealed) return;
    const value = revealed.password;
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Copied.");
    } catch {
      setNotice("Select the password and copy it.");
    }
  };

  const onTogglePassword = () => {
    setRevealed((current) => (current ? { ...current, visible: !current.visible } : current));
  };

  if (!allowed) return null;

  return (
    <SendAgentCard
      market={market}
      fresh={fresh}
      open={open}
      busy={busy}
      ready={ready}
      loaded={loaded}
      notice={notice}
      firstName={firstName}
      email={email}
      selectedKeys={selectedKeys}
      otherLabel={otherLabel}
      onFirstName={setFirstName}
      onEmail={(value) => {
        setEmailEdited(true);
        setEmail(value);
      }}
      onToggleItem={onToggleItem}
      onOtherLabel={setOtherLabel}
      onMint={() => void onMint()}
      onCopy={() => void onCopy()}
      onRevoke={() => void onRevoke()}
      fileList={
        <AccountantSendFileList
          files={sends.flatMap((send) => send.files ?? [])}
          revealed={revealed}
          busyFileId={passwordBusy}
          onShow={(fileId) => void onShowPassword(fileId)}
          onToggleVisible={onTogglePassword}
          onCopy={() => void onCopyPassword()}
        />
      }
    />
  );
}

export function SendAgentCard({
  market,
  fresh,
  open,
  busy,
  ready,
  loaded,
  notice,
  firstName,
  email,
  selectedKeys,
  otherLabel,
  onFirstName,
  onEmail,
  onToggleItem,
  onOtherLabel,
  onMint,
  onCopy,
  onRevoke,
  fileList = null,
}: {
  market: DateMarket;
  fresh: FreshLink | null;
  open: { expiresAt: string } | null;
  busy: boolean;
  ready: boolean;
  loaded: boolean;
  notice: string | null;
  firstName: string;
  email: string;
  selectedKeys: readonly string[];
  otherLabel: string;
  onFirstName: (value: string) => void;
  onEmail: (value: string) => void;
  onToggleItem: (itemKey: string) => void;
  onOtherLabel: (value: string) => void;
  onMint: () => void;
  onCopy: () => void;
  onRevoke: () => void;
  fileList?: ReactNode;
}) {
  const chosen = chooseSendItems(
    SEND_ITEM_KEYS.filter((itemKey) => selectedKeys.includes(itemKey)).map((itemKey) => ({
      itemKey,
      label: itemKey === "other" ? otherLabel : undefined,
    })),
  );
  return (
    <section
      className="flex flex-col gap-4 rounded-2xl border border-[#DBEAFE] bg-white p-4 text-[#102A43]"
      data-send-agent=""
      aria-labelledby="send-agent-title"
    >
      <div
        className="relative h-24 w-24 shrink-0 self-start overflow-hidden rounded-[28px] bg-[#DBEAFE] [&_img]:absolute [&_img]:inset-0 [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_video]:absolute [&_video]:inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover"
        data-send-agent-portrait=""
      >
        <SilentAgentPortrait face="tax_specialist" label="Tax Specialist" />
      </div>
      <div className="flex flex-col gap-2">
        <h2 id="send-agent-title" className="text-lg font-semibold">
          Tax Specialist
        </h2>
        <p className="text-sm leading-6 text-[#3D5270]">{SEND_AGENT_BODY}</p>
      </div>
      {fresh ? (
        <div className="flex flex-col gap-3" data-send-agent-link="">
          <p className="text-sm leading-6 text-[#3D5270]">{SEND_AGENT_ONCE}</p>
          <p className="text-sm">Active until {formatDate(fresh.expiresAt, market)}.</p>
          <input
            readOnly
            value={fresh.url}
            aria-label="Agent link"
            className="w-full rounded-xl border border-[#DBEAFE] bg-white px-3 py-2 text-sm text-[#102A43]"
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="flex flex-col gap-2">
            <button type="button" className={SECONDARY} onClick={() => void onCopy()}>
              Copy link
            </button>
            <button
              type="button"
              className={SECONDARY}
              data-send-agent-revoke=""
              disabled={busy}
              onClick={onRevoke}
            >
              Revoke
            </button>
          </div>
        </div>
      ) : open ? (
        <div className="flex flex-col gap-3" data-send-agent-open="">
          <p className="text-sm leading-6">
            A link is active until {formatDate(open.expiresAt, market)}. The address was shown once
            when it was created.
          </p>
          <button
            type="button"
            className={SECONDARY}
            data-send-agent-revoke=""
            disabled={busy}
            onClick={() => void onRevoke()}
          >
            Revoke
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2" data-send-agent-items="">
            <legend className="text-sm font-semibold">Documents</legend>
            <p className="text-sm leading-6 text-[#3D5270]">
              Choose what the client should send. At least one.
            </p>
            {SEND_ITEM_KEYS.map((itemKey) => {
              const checked = selectedKeys.includes(itemKey);
              return (
                <div key={itemKey} className="flex flex-col gap-2">
                  <label
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm font-normal ${checked ? "border-[#0B5FFF]" : "border-[#DBEAFE]"}`}
                    data-send-item={itemKey}
                  >
                    <input
                      id={`send-agent-item-${itemKey}`}
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-[#0B5FFF]"
                      checked={checked}
                      onChange={() => onToggleItem(itemKey)}
                    />
                    <span>{SEND_ITEM_LABELS[itemKey]}</span>
                  </label>
                  {itemKey === "other" && checked ? (
                    <label
                      className="flex flex-col text-sm font-semibold"
                      htmlFor="send-agent-other-label"
                    >
                      Name for the client
                      <span className="mt-1 font-normal text-[#3D5270]">
                        Required. This is the line they see.
                      </span>
                      <input
                        id="send-agent-other-label"
                        className="mt-1 min-h-11 w-full rounded-xl border border-[#DBEAFE] px-3 text-sm font-normal text-[#102A43]"
                        value={otherLabel}
                        maxLength={SEND_OTHER_LABEL_MAX}
                        onChange={(event) => onOtherLabel(event.target.value)}
                      />
                    </label>
                  ) : null}
                </div>
              );
            })}
          </fieldset>
          <label className="flex flex-col text-sm font-semibold" htmlFor="send-agent-first-name">
            Client first name
            <span className="mt-1 font-normal text-[#3D5270]">Optional.</span>
            <input
              id="send-agent-first-name"
              className="mt-1 min-h-11 w-full rounded-xl border border-[#DBEAFE] px-3 text-sm font-normal text-[#102A43]"
              value={firstName}
              maxLength={60}
              autoComplete="off"
              onChange={(event) => onFirstName(event.target.value)}
            />
          </label>
          <label className="flex flex-col text-sm font-semibold" htmlFor="send-agent-email">
            Email
            <span className="mt-1 font-normal text-[#3D5270]">
              Confirm this address. The invite is sent only when you click Send.
            </span>
            <input
              id="send-agent-email"
              type="email"
              required
              className="mt-1 min-h-11 w-full rounded-xl border border-[#DBEAFE] px-3 text-sm font-normal text-[#102A43]"
              value={email}
              autoComplete="email"
              onChange={(event) => onEmail(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={PRIMARY}
            disabled={!ready || busy || !recipientEmail(email) || !chosen.ok}
            onClick={onMint}
          >
            Send
          </button>
        </div>
      )}
      {fileList}
      {loaded && !ready ? (
        <p className="text-sm text-[#3D5270]">This is not available on this file yet.</p>
      ) : null}
      {notice ? (
        <p className="text-sm" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
