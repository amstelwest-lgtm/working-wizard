/**
 * SharedDocumentsList — files a business owner chose to share, as seen from
 * the accountant's Client Brain summary. Private uploads never reach this
 * component: Storage and table RLS filter them before the query returns.
 */

import { useState } from "react";
import { toast } from "sonner";
import { useMarketFormat } from "@/contexts/market";
import type { ClientArtifact } from "@/lib/client-brain";
import { formatBytes, parseDocumentMeta, uploadSourceLabel } from "@/lib/client-documents";
import { clientDocumentDownloadUrl } from "@/lib/client-documents-browser";

export function SharedDocumentsList({ docs }: { docs: ClientArtifact[] }) {
  const { dateTime } = useMarketFormat();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (docs.length === 0) {
    return (
      <p className="sub" style={{ margin: "8px 0 0" }}>
        No documents shared yet. Files the owner marks "Share with accountant" appear here; files
        they keep private do not.
      </p>
    );
  }

  const open = async (doc: ClientArtifact) => {
    if (!doc.storage_path) return;
    setBusyId(doc.id);
    try {
      const url = await clientDocumentDownloadUrl(doc.storage_path);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(`Could not open the document: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ul className="brain-list" style={{ marginTop: 10 }} data-shared-documents>
      {docs.map((doc) => {
        const meta = parseDocumentMeta(doc.meta);
        return (
          <li
            key={doc.id}
            className="brain-row-block"
            style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13.5 }}
          >
            <span style={{ minWidth: 0 }}>
              <span className="brain-row-title" style={{ display: "block" }}>
                {meta.file_name ?? doc.storage_path?.split("/").pop() ?? "Document"}
              </span>
              <span className="brain-meta" style={{ marginTop: 0 }}>
                {uploadSourceLabel(meta.source)}
                {meta.account_label ? ` · ${meta.account_label}` : ""}
                {meta.bytes != null ? ` · ${formatBytes(meta.bytes)}` : ""}
                {` · ${dateTime(doc.created_at)}`}
              </span>
            </span>
            <button
              type="button"
              className="btn ghost mini"
              disabled={busyId === doc.id}
              onClick={() => open(doc)}
            >
              {busyId === doc.id ? "Opening…" : "Open"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
