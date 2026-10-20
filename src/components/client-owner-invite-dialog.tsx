/**
 * Shared owner-invite dialog for an existing client.
 * Copy invite link uses inviteClientOwner with sendEmail: false (no email).
 * Email invite sends. Pending rows reuse copy / resend / revoke.
 * practice-board.tsx still has a dead openOwnerInvite; switch that to this dialog later.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ClientFileSettings } from "@/components/client-file-settings";
import { inviteClientOwner } from "@/lib/client-invite.functions";
import { guardedOwnerInvite } from "@/lib/client-owner-invite";
import {
  assertClientOwnerInvite,
  listClientOwnerInvites,
  removeClientOwner,
  resendClientOwnerInvite,
  revokeClientOwnerInvite,
  type ClientOwnerOnFile,
  type PendingOwnerInvite,
} from "@/lib/client-owner-invites.functions";
import { formatDate, t, type ResolvedMarket } from "@/lib/market";
import { openPracticeSettings } from "@/lib/user-roles";
import { useNavigate } from "@tanstack/react-router";

export function ClientOwnerInviteDialog({
  open,
  clientName,
  market,
  email,
  onEmailChange,
  ownerName,
  onOwnerNameChange,
  pending,
  pendingLoading,
  ownerOnFile,
  busy,
  error,
  linkUrl,
  onClose,
  onCopyLink,
  onEmailInvite,
  onCopyPending,
  onResend,
  onRevoke,
}: {
  open: boolean;
  clientName: string;
  market: ResolvedMarket;
  email: string;
  onEmailChange: (email: string) => void;
  ownerName: string;
  onOwnerNameChange: (name: string) => void;
  pending: readonly PendingOwnerInvite[];
  pendingLoading: boolean;
  ownerOnFile: boolean;
  busy: boolean;
  error: string | null;
  linkUrl: string | null;
  onClose: () => void;
  onCopyLink: () => void;
  onEmailInvite: () => void;
  onCopyPending: (row: PendingOwnerInvite) => void;
  onResend: (row: PendingOwnerInvite) => void;
  onRevoke: (row: PendingOwnerInvite) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="owner-invite-title"
        data-owner-invite-dialog=""
        className="max-h-[min(90vh,40rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#DBEAFE] bg-white p-5 text-[#102A43] shadow-lg dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#3D5270] dark:text-[#C5D4E4]">
              {clientName}
            </p>
            <h2 id="owner-invite-title" className="mt-1 text-lg font-semibold">
              Invite owner
            </h2>
          </div>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <p className="mt-3 text-sm text-[#3D5270] dark:text-[#C5D4E4]">
          Send the owner a link to this client, or copy the link and send it yourself. Copy invite
          link does not email.
        </p>
        {ownerOnFile ? (
          <p className="mt-3 text-sm" data-owner-on-file="">
            An owner already has this file. A new invite still works if you need to hand it to
            someone else.
          </p>
        ) : null}
        <label
          className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.14em]"
          htmlFor="owner-invite-name"
        >
          Owner name <span className="normal-case tracking-normal">(optional)</span>
        </label>
        <input
          id="owner-invite-name"
          type="text"
          value={ownerName}
          placeholder={t("nameExample", market)}
          autoComplete="off"
          maxLength={80}
          onChange={(event) => onOwnerNameChange(event.target.value)}
          className="mt-1 w-full rounded-xl border border-[#DBEAFE] bg-white px-3 py-2 text-sm dark:border-[#1e3a5f] dark:bg-[#0B1B2B]"
        />
        <label
          className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.14em]"
          htmlFor="owner-invite-email"
        >
          Owner email
        </label>
        <input
          id="owner-invite-email"
          type="email"
          value={email}
          placeholder={t("emailExample", market)}
          autoComplete="off"
          onChange={(event) => onEmailChange(event.target.value)}
          className="mt-1 w-full rounded-xl border border-[#DBEAFE] bg-white px-3 py-2 text-sm dark:border-[#1e3a5f] dark:bg-[#0B1B2B]"
        />
        {linkUrl ? (
          <p className="mt-3 break-all text-xs" data-owner-invite-link="">
            {linkUrl}
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 text-sm text-[#9b2c2c]" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn ghost"
            data-owner-invite="link"
            disabled={busy}
            onClick={onCopyLink}
          >
            {busy ? "Working…" : "Copy invite link"}
          </button>
          <button
            type="button"
            className="btn gold"
            data-owner-invite="email"
            disabled={busy || !email.trim()}
            onClick={onEmailInvite}
          >
            Email invite
          </button>
        </div>
        <h3 className="mt-6 text-xs font-semibold uppercase tracking-[0.14em]">Pending invites</h3>
        {pendingLoading ? <p className="mt-2 text-sm">Loading invites…</p> : null}
        {!pendingLoading && pending.length === 0 ? (
          <p className="mt-2 text-sm text-[#3D5270] dark:text-[#C5D4E4]">
            No pending owner invite.
          </p>
        ) : null}
        {pending.length > 0 ? (
          <ul className="mt-2 space-y-3">
            {pending.map((row) => (
              <li
                key={row.id}
                className="rounded-xl border border-[#DBEAFE] p-3 text-sm dark:border-[#1e3a5f]"
                data-pending-invite={row.id}
              >
                {row.ownerName ? <p className="font-semibold">{row.ownerName}</p> : null}
                <p>{row.email || "No email on this invite"}</p>
                <p className="text-xs text-[#3D5270] dark:text-[#C5D4E4]" data-pending-invite-status="">
                  Invite sent {formatDate(row.createdAt, market)}, not joined yet
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => onCopyPending(row)}
                  >
                    Copy link
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy || !row.email}
                    onClick={() => onResend(row)}
                  >
                    Resend
                  </button>
                  {confirmId === row.id ? (
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy}
                      onClick={() => onRevoke(row)}
                    >
                      Revoke this invite
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy}
                      onClick={() => setConfirmId(row.id)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function ClientOwnerInviteHost({
  clientId,
  clientName,
  market,
  open,
  onOpenChange,
  showEntry,
}: {
  clientId: string;
  clientName: string;
  market: ResolvedMarket;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showEntry: boolean;
}) {
  const navigate = useNavigate();
  const invite = useServerFn(inviteClientOwner);
  const assertAccess = useServerFn(assertClientOwnerInvite);
  const loadInvites = useServerFn(listClientOwnerInvites);
  const resendInvite = useServerFn(resendClientOwnerInvite);
  const revokeInvite = useServerFn(revokeClientOwnerInvite);
  const removeOwner = useServerFn(removeClientOwner);
  const [email, setEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [pending, setPending] = useState<PendingOwnerInvite[]>([]);
  const [owners, setOwners] = useState<ClientOwnerOnFile[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [ownerOnFile, setOwnerOnFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open && !showEntry) return;
    let cancelled = false;
    setPendingLoading(true);
    setError(null);
    void loadInvites({ data: { clientId } })
      .then((row) => {
        if (cancelled) return;
        setPending(row.pending);
        setOwners(row.owners);
        setOwnerOnFile(row.ownerOnFile);
        setEmail((current) => current || row.contactEmail || "");
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load invites");
      })
      .finally(() => {
        if (!cancelled) setPendingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, showEntry, clientId, loadInvites]);

  const refresh = async () => {
    const row = await loadInvites({ data: { clientId } });
    setPending(row.pending);
    setOwners(row.owners);
    setOwnerOnFile(row.ownerOnFile);
    setEmail((current) => current || row.contactEmail || "");
  };

  const copyText = async (url: string) => {
    await navigator.clipboard.writeText(url);
  };

  const onCopyLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await guardedOwnerInvite(
        () => assertAccess({ data: { clientId } }),
        (req) => invite({ data: req }),
        { clientId, toEmail: email, ownerName, mode: "link" },
      );
      setLinkUrl(result.url);
      setBusy(false);
      try {
        await copyText(result.url);
        toast.success("Invite link copied");
      } catch {
        toast.error("Could not copy the link. Select it and copy it yourself.");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not copy the invite link");
    } finally {
      setBusy(false);
    }
  };

  const onEmailInvite = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await guardedOwnerInvite(
        () => assertAccess({ data: { clientId } }),
        (req) => invite({ data: req }),
        { clientId, toEmail: email, ownerName, mode: "email" },
      );
      setLinkUrl(result.url);
      if (result.emailed) toast.success(`Invite emailed to ${result.email ?? email}`);
      else {
        const message = result.sendError
          ? `Email didn't send (${result.sendError}). The link is here to copy.`
          : "Email didn't send. The link is here to copy.";
        setError(message);
        toast.message(message);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not email the invite");
    } finally {
      setBusy(false);
    }
  };

  const onCopyPending = async (row: PendingOwnerInvite) => {
    try {
      await copyText(row.url);
      toast.success("Invite link copied");
    } catch {
      setLinkUrl(row.url);
      toast.error("Could not copy the link. Select it and copy it yourself.");
    }
  };

  const onResend = async (row: PendingOwnerInvite) => {
    setBusy(true);
    setError(null);
    try {
      const result = await resendInvite({ data: { clientId, inviteId: row.id } });
      if (result.emailed) toast.success(`Invite emailed to ${result.email}`);
      else {
        setLinkUrl(result.url);
        const message = result.sendError
          ? `Email didn't send (${result.sendError}). Copy the link instead.`
          : "Email didn't send. Copy the link instead.";
        setError(message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend the invite");
    } finally {
      setBusy(false);
    }
  };

  const onRemoveOwner = async (owner: ClientOwnerOnFile) => {
    setBusy(true);
    setError(null);
    try {
      await removeOwner({ data: { clientId, membershipId: owner.membershipId } });
      toast.success("Owner removed from this client");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the owner");
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (row: PendingOwnerInvite) => {
    setBusy(true);
    setError(null);
    try {
      await revokeInvite({ data: { clientId, inviteId: row.id } });
      toast.success("Invite revoked");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke the invite");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {showEntry ? (
        <ClientFileSettings
          clientName={clientName}
          market={market}
          owners={owners}
          pending={pending}
          onInvite={() => onOpenChange(true)}
          onPracticeSettings={() => {
            openPracticeSettings();
            void navigate({ to: "/settings" });
          }}
          onCopyPending={(row) => void onCopyPending(row)}
          onRevokePending={(row) => void onRevoke(row)}
          onRemoveOwner={(owner) => void onRemoveOwner(owner)}
        />
      ) : null}
      <ClientOwnerInviteDialog
        open={open}
        clientName={clientName}
        market={market}
        email={email}
        onEmailChange={setEmail}
        ownerName={ownerName}
        onOwnerNameChange={setOwnerName}
        pending={pending}
        pendingLoading={pendingLoading}
        ownerOnFile={ownerOnFile}
        busy={busy}
        error={error}
        linkUrl={linkUrl}
        onClose={() => onOpenChange(false)}
        onCopyLink={() => void onCopyLink()}
        onEmailInvite={() => void onEmailInvite()}
        onCopyPending={(row) => void onCopyPending(row)}
        onResend={(row) => void onResend(row)}
        onRevoke={(row) => void onRevoke(row)}
      />
    </>
  );
}
