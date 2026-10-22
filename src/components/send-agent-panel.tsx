/**
 * Accountant action: mint a Tax Specialist link and email the invite.
 * The invite goes out only when Send is clicked. Revoke sits with the link.
 */
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { SilentAgentPortrait } from "@/components/silent-agent-portrait";
import { receivedItemStatus } from "@/lib/client-agent-done";
import { itemLabel } from "@/lib/client-agent-link";
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
import { clientDocumentDownloadUrl } from "@/lib/client-documents-browser";
import { formatDate, type DateMarket } from "@/lib/market";
import {
  listClientAgentSends,
  mintClientAgentSend,
  reviewClientAgentSend,
  revokeClientAgentSend,
  type AgentSendItem,
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
  const review = useServerFn(reviewClientAgentSend);
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
  const receivedSend =
    sends.find((send) => send.completedAt && !send.reviewedAt) ??
    sends.find((send) => send.completedAt) ??
    null;

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

  const onReview = async () => {
    if (!receivedSend) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await review({ data: { clientId, sendId: receivedSend.id } });
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
      received={receivedSend}
      onOpenDocument={(path) => void onOpenDocument(path)}
      onReview={() => void onReview()}
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
  received = null,
  onOpenDocument,
  onReview,
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
  received?: AgentSendRow | null;
  onOpenDocument?: (path: string) => void;
  onReview?: () => void;
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
      {received?.completedAt ? (
        <div className="flex flex-col gap-3" data-send-agent-received="">
          <h3 className="text-sm font-semibold">Documents received</h3>
          <ul className="flex flex-col gap-3">
            {received.items.map((item: AgentSendItem) => {
              const path = item.documentPath;
              return (
                <li
                  key={item.itemKey}
                  className="flex flex-col gap-2 rounded-xl border border-[#DBEAFE] p-3"
                  data-received-item={item.itemKey}
                >
                  <p className="text-sm font-semibold">{itemLabel(item.itemKey, item.label)}</p>
                  <p className="text-sm text-[#3D5270]">
                    {receivedItemStatus({
                      storagePath: path ?? (item.status === "received" ? "stored" : null),
                      status: item.status,
                      quality: item.quality,
                    })}
                  </p>
                  {item.explanation ? (
                    <p className="text-sm text-[#3D5270]">{item.explanation}</p>
                  ) : null}
                  {path ? (
                    <button
                      type="button"
                      className={`${SECONDARY} w-full`}
                      data-open-document={item.itemKey}
                      disabled={busy}
                      onClick={() => onOpenDocument?.(path)}
                    >
                      Open in Documents
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {received.reviewedAt ? (
            <p className="text-sm text-[#3D5270]">Reviewed</p>
          ) : (
            <button
              type="button"
              className={`${PRIMARY} w-full`}
              data-mark-reviewed=""
              disabled={busy}
              onClick={onReview}
            >
              Mark reviewed
            </button>
          )}
        </div>
      ) : null}
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
