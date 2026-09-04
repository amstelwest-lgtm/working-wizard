/**
 * Sent history — advisory / PDF / share events for a client.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useMarketFormat } from "@/contexts/market";
import {
  listDeliveries,
  channelHonestyLabel,
  ackUrlForToken,
  signedDeliveryPdfUrl,
  type AdvisoryDelivery,
} from "@/lib/advisory-deliveries";

function kindLabel(kind: AdvisoryDelivery["kind"]): string {
  if (kind === "advisory_draft") return "Advisory draft";
  if (kind === "health_summary") return "Health summary";
  if (kind === "report_pdf") return "Report PDF";
  if (kind === "meeting_agenda") return "Meeting agenda";
  if (kind === "exec_summary") return "Exec summary";
  return kind;
}

export function AdvisorySentHistory({
  clientId,
  refreshToken = 0,
}: {
  clientId: string;
  refreshToken?: number;
}) {
  const { dateTime } = useMarketFormat();
  const [rows, setRows] = useState<AdvisoryDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listDeliveries(clientId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, refreshToken]);

  const copyAckLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(ackUrlForToken(token));
      toast.success("Acknowledgement link copied");
    } catch {
      toast.error("Could not copy link");
    }
  };

  const redownloadPdf = async (row: AdvisoryDelivery) => {
    if (!row.pdf_storage_path) return;
    setDownloadingId(row.id);
    try {
      const { url, error } = await signedDeliveryPdfUrl(row.pdf_storage_path);
      if (error || !url) {
        toast.error(error ?? "Could not open archived PDF");
        return;
      }
      const a = document.createElement("a");
      a.href = url;
      a.download = `${row.report_key || row.kind || "report"}.pdf`;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success("Archived PDF opened");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16, padding: "14px 18px" }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--ink-dim)",
        }}
      >
        Sent history
      </div>
      <p style={{ margin: "6px 0 12px", fontSize: 13, color: "var(--ink-dim)" }}>
        Logged shares and PDF downloads with stamped figures. Mailto / WhatsApp rows mean the share
        sheet was opened — not postal proof — until the client acknowledges. Archived PDFs can be
        re-downloaded when a file was stored with the row.
      </p>
      {loading ? (
        <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>
          Nothing logged yet. Copy, email, WhatsApp, or download a PDF to start the trail.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--line)",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                  {kindLabel(r.kind)}
                  {r.report_key ? ` · ${r.report_key}` : ""}
                  {r.subject ? ` — ${r.subject}` : ""}
                </div>
                <div style={{ marginTop: 2, fontSize: 12, color: "var(--ink-dim)" }}>
                  {dateTime(r.created_at, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {r.period_label ? ` · figures ${r.period_label}` : ""}
                  {r.figures_hash ? ` · hash ${r.figures_hash}` : ""}
                  {r.recipient_email ? ` · ${r.recipient_email}` : ""}
                  {r.pdf_storage_path ? " · PDF archived" : ""}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {r.pdf_storage_path ? (
                  <button
                    type="button"
                    className="btn ghost mini"
                    style={{ fontSize: 11 }}
                    disabled={downloadingId === r.id}
                    onClick={() => void redownloadPdf(r)}
                  >
                    {downloadingId === r.id ? "Opening…" : "Re-download PDF"}
                  </button>
                ) : null}
                {!r.acknowledged_at && r.ack_token ? (
                  <button
                    type="button"
                    className="btn ghost mini"
                    style={{ fontSize: 11 }}
                    onClick={() => copyAckLink(r.ack_token!)}
                  >
                    Copy ack link
                  </button>
                ) : null}
                <span
                  className={`chip ${r.acknowledged_at ? "ok" : "warn"}`}
                  style={{ fontSize: 11, alignSelf: "center" }}
                >
                  {channelHonestyLabel(r.channel, !!r.acknowledged_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
