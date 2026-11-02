/**
 * Client-file Settings. Practice billing and team stay on /settings.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClientSubpageFrame } from "@/components/client-subpage";
import { removeClientConfirm } from "@/lib/archive-client";
import type { ClientOwnerOnFile, PendingOwnerInvite } from "@/lib/client-owner-invites.functions";
import { formatDate, type ResolvedMarket } from "@/lib/market";

export function RemoveClientDialog({
  clientName,
  open,
  removing = false,
  onConfirm,
  onClose,
}: {
  clientName: string;
  open: boolean;
  removing?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const dialog = (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-client-title"
        aria-describedby="remove-client-copy"
        data-remove-client-dialog=""
        className="w-full max-w-md rounded-2xl border border-[#DBEAFE] bg-white p-5 text-[#102A43] shadow-lg dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="remove-client-title" className="text-base font-semibold">
          Remove client
        </h2>
        <p id="remove-client-copy" className="mt-2 text-sm" data-remove-client-copy="">
          {removeClientConfirm(clientName)}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn gold"
            data-remove-client-confirm=""
            disabled={removing}
            autoFocus
            onClick={onConfirm}
          >
            {removing ? "Removing…" : "Remove client"}
          </button>
          <button type="button" className="btn ghost" onClick={onClose} disabled={removing}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
  if (typeof document === "undefined") return dialog;
  return createPortal(dialog, document.body);
}

export function ClientFileSettings({
  clientName,
  market,
  owners = [],
  pending = [],
  onInvite,
  onPracticeSettings,
  onCopyPending,
  onRevokePending,
  onRemoveOwner,
  onRemoveClient,
  removingClient = false,
}: {
  clientName: string;
  market?: ResolvedMarket;
  owners?: readonly ClientOwnerOnFile[];
  pending?: readonly PendingOwnerInvite[];
  onInvite: () => void;
  onPracticeSettings: () => void;
  onCopyPending?: (row: PendingOwnerInvite) => void;
  onRevokePending?: (row: PendingOwnerInvite) => void;
  onRemoveOwner?: (owner: ClientOwnerOnFile) => void;
  onRemoveClient?: () => void;
  removingClient?: boolean;
}) {
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [confirmClient, setConfirmClient] = useState(false);
  const hasOwner = owners.length > 0;
  const date = (value: string) => (market ? formatDate(value, market) : value);

  return (
    <ClientSubpageFrame
      id="settings"
      eyebrow="File"
      title="Settings"
      subtitle={`Owner access for ${clientName}. Practice billing, brand, and team stay in practice settings.`}
    >
      <section
        className="rounded-2xl border border-[#DBEAFE] bg-white p-4 shadow-sm dark:border-[#1e3a5f] dark:bg-[#102A43]"
        data-client-settings=""
      >
        <h2 className="text-sm font-semibold text-[#102A43] dark:text-[#F4F7FB]">Owner</h2>
        {hasOwner ? (
          <ul className="mt-3 space-y-3">
            {owners.map((owner) => (
              <li
                key={owner.membershipId}
                className="rounded-xl border border-[#DBEAFE] p-3 text-sm dark:border-[#1e3a5f]"
                data-client-owner-row={owner.membershipId}
              >
                <p className="font-semibold" data-client-owner-name="">
                  {owner.name}
                </p>
                {owner.email ? (
                  <p className="text-[#3D5270] dark:text-[#C5D4E4]">{owner.email}</p>
                ) : null}
                <p className="text-xs text-[#3D5270] dark:text-[#C5D4E4]">
                  Joined {date(owner.joinedAt)}
                </p>
                {confirmRemove === owner.membershipId ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs">
                      Remove this owner? This only takes away their owner access on this client. It
                      does not delete their account or this client&apos;s data.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn ghost"
                        data-remove-owner-confirm=""
                        onClick={() => onRemoveOwner?.(owner)}
                      >
                        Remove owner
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => setConfirmRemove(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn ghost mt-2"
                    data-remove-owner=""
                    onClick={() => setConfirmRemove(owner.membershipId)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-[#3D5270] dark:text-[#C5D4E4]">
            Invite the owner of this client. Copy a link, or email it.
          </p>
        )}
        {pending.length > 0 ? (
          <ul className="mt-3 space-y-3">
            {pending.map((row) => (
              <li
                key={row.id}
                className="rounded-xl border border-[#DBEAFE] p-3 text-sm dark:border-[#1e3a5f]"
                data-pending-invite={row.id}
              >
                {row.ownerName ? <p className="font-semibold">{row.ownerName}</p> : null}
                <p>{row.email || "No email on this invite"}</p>
                <p
                  className="text-xs text-[#3D5270] dark:text-[#C5D4E4]"
                  data-pending-invite-status=""
                >
                  Invite sent {date(row.createdAt)}, not joined yet
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="btn ghost" onClick={() => onCopyPending?.(row)}>
                    Copy link
                  </button>
                  {confirmRevoke === row.id ? (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => onRevokePending?.(row)}
                    >
                      Revoke this invite
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setConfirmRevoke(row.id)}
                    >
                      Revoke
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className={hasOwner ? "btn ghost" : "btn gold"}
            data-invite-owner-entry=""
            data-invite-owner-secondary={hasOwner ? "" : undefined}
            onClick={onInvite}
          >
            Invite owner
          </button>
          <button type="button" className="btn ghost" onClick={onPracticeSettings}>
            Practice settings
          </button>
        </div>
        <div className="mt-6 border-t border-[#DBEAFE] pt-4 dark:border-[#1e3a5f]">
          <button
            type="button"
            className="btn ghost"
            data-remove-client=""
            onClick={() => setConfirmClient(true)}
          >
            Remove client
          </button>
        </div>
        <RemoveClientDialog
          clientName={clientName}
          open={confirmClient}
          removing={removingClient}
          onConfirm={() => onRemoveClient?.()}
          onClose={() => {
            if (!removingClient) setConfirmClient(false);
          }}
        />
      </section>
    </ClientSubpageFrame>
  );
}
