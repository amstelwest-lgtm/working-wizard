/**
 * OwnerUploadsPanel — "Your uploads" inside the owner's Financial Data dialog.
 * Shows every archived file with its visibility, lets the owner flip a file
 * between Shared and Private, open it, or remove it. Reads through RLS as the
 * owner, so the list is complete for the owner side.
 */

import { useCallback, useEffect, useState } from "react";
import { Download, FileText, Loader2, Lock, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { useMarketFormat } from "@/contexts/market";
import {
  UPLOAD_VISIBILITY_COPY,
  formatBytes,
  parseDocumentMeta,
  uploadSourceLabel,
  type UploadVisibility,
} from "@/lib/client-documents";
import {
  clientDocumentDownloadUrl,
  deleteClientDocument,
  listClientDocuments,
  setClientDocumentVisibility,
  type ClientDocumentRow,
} from "@/lib/client-documents-browser";

type Props = {
  clientId: string;
  /** Any value change triggers a reload (e.g. the dialog opening). */
  refreshKey?: unknown;
  className?: string;
};

export function OwnerUploadsPanel({ clientId, refreshKey, className = "" }: Props) {
  const { dateTime } = useMarketFormat();
  const [rows, setRows] = useState<ClientDocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listClientDocuments(clientId));
      setError(null);
    } catch (e) {
      // Table or column not migrated yet — show nothing rather than an error wall.
      const msg = (e as Error).message ?? "";
      if (/visibility|client_artifacts|42703|42P01/.test(msg)) {
        setRows([]);
      } else {
        setError(msg);
      }
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const flip = async (row: ClientDocumentRow) => {
    const next: UploadVisibility = row.visibility === "shared" ? "private" : "shared";
    setBusyId(row.id);
    try {
      await setClientDocumentVisibility(row.id, next);
      setRows(
        (prev) => prev?.map((r) => (r.id === row.id ? { ...r, visibility: next } : r)) ?? null,
      );
      toast.success(
        next === "shared"
          ? "Shared with your accountant."
          : "Now private — your accountant can no longer see this file.",
      );
    } catch (e) {
      toast.error(`Could not change visibility: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const open = async (row: ClientDocumentRow) => {
    if (!row.storage_path) return;
    setBusyId(row.id);
    try {
      const url = await clientDocumentDownloadUrl(row.storage_path);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(`Could not open the file: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (row: ClientDocumentRow) => {
    const meta = parseDocumentMeta(row.meta);
    if (!window.confirm(`Remove "${meta.file_name ?? "this file"}" from your documents?`)) return;
    setBusyId(row.id);
    try {
      await deleteClientDocument(row);
      setRows((prev) => prev?.filter((r) => r.id !== row.id) ?? null);
    } catch (e) {
      toast.error(`Could not remove the file: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      data-owner-uploads
      className={`rounded-lg border border-amber-900/15 bg-amber-50/30 p-3 dark:border-slate-800 dark:bg-slate-900/40 ${className}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#b8860b]">
          Your uploads
        </p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Private files stay with you. Shared files are visible to your linked accountant.
        </p>
      </div>

      {rows === null && !error && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-700 dark:text-red-400">{error}</p>}
      {rows && rows.length === 0 && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          No files saved yet. Statements you upload from here are kept with the visibility you
          choose above.
        </p>
      )}

      {rows && rows.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {rows.map((row) => {
            const meta = parseDocumentMeta(row.meta);
            const shared = row.visibility === "shared";
            const busy = busyId === row.id;
            return (
              <li
                key={row.id}
                data-visibility={row.visibility}
                className="flex flex-col gap-1.5 rounded-md border border-amber-900/10 bg-white/80 px-2.5 py-2 text-xs dark:border-slate-800 dark:bg-slate-950/60 sm:flex-row sm:items-center sm:gap-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-[#b8860b]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-slate-900 dark:text-slate-100">
                      {meta.file_name ?? row.storage_path?.split("/").pop() ?? "File"}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {uploadSourceLabel(meta.source)}
                      {meta.account_label ? ` · ${meta.account_label}` : ""}
                      {meta.bytes != null ? ` · ${formatBytes(meta.bytes)}` : ""}
                      {` · ${dateTime(row.created_at)}`}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-1.5 sm:shrink-0">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                      shared
                        ? "border-emerald-700/30 bg-emerald-50 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-950/40 dark:text-emerald-300"
                        : "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    }`}
                  >
                    {shared ? <Users className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    {UPLOAD_VISIBILITY_COPY[row.visibility]?.badge ?? row.visibility}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => flip(row)}
                    className="rounded-md border border-amber-900/15 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-amber-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {shared ? "Make private" : "Share with accountant"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || !row.storage_path}
                    onClick={() => open(row)}
                    aria-label="Open file"
                    className="rounded-md p-1 text-slate-500 hover:text-slate-900 disabled:opacity-50 dark:hover:text-slate-100"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(row)}
                    aria-label="Remove file"
                    className="rounded-md p-1 text-slate-400 hover:text-rose-600 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
