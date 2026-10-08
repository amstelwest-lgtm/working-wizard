/**
 * Sent history — emails, shares, and PDF downloads for a client.
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
import { SENT_HISTORY_INTRO } from "@/lib/reports-drafter-copy";
import { scorecardDownloadShouldRenderLive } from "@/lib/scorecard-rows";

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
  statementPeriodLabel = null,
  liveScorecard = null,
  variant = "default",
}: {
  clientId: string;
  refreshToken?: number;
  /** Statement span. Shown in place of a calendar month stored on the row. */
  statementPeriodLabel?: string | null;
  /** Overview scorecard. A stored PDF is not re-opened. */
  liveScorecard?: (() => Promise<Blob | null>) | null;
  /**
   * Reports tab: solid rows and wrapping actions.
   * The drafter keeps the original sent-history row.
   */
  variant?: "default" | "reports";
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
    if (scorecardDownloadShouldRenderLive(row) && liveScorecard) {
      setDownloadingId(row.id);
      try {
        const blob = await liveScorecard();
        if (!blob) {
          toast.error("Could not build the scorecard");
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "scorecard.pdf";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success("Scorecard downloaded");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not build the scorecard");
      } finally {
        setDownloadingId(null);
      }
      return;
    }
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

  const reports = variant === "reports";

  return (
    <div
      id="sent-history"
      className={reports ? "sent-history sent-history--reports" : "card"}
      data-report-history={reports ? "open" : undefined}
      style={reports ? undefined : { marginTop: 16, padding: "14px 18px" }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>Sent history</div>
      <p style={{ margin: "6px 0 12px", fontSize: 13, color: "var(--ink-dim)" }}>{SENT_HISTORY_INTRO}</p>
      {loading ? (
        <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--ink-dim)" }}>
          Nothing logged yet. Copy, email, WhatsApp, or download a PDF to start the trail.
        </p>
      ) : (
        <div
          className={reports ? "sent-history__list" : undefined}
          style={reports ? undefined : { display: "grid", gap: 8 }}
        >
          {rows.map((r) => (
            <div
              key={r.id}
              className={reports ? "sent-history__row" : undefined}
              style={
                reports
                  ? undefined
                  : {
                      display: "flex",
                      flexWrap: "wrap",
                      justifyContent: "space-between",
                      gap: 8,
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid var(--line)",
                    }
              }
            >
              <div className={reports ? "sent-history__copy" : undefined}>
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
                    hour: "numeric",
                    minute: "2-digit",
                    timeZoneName: "shortGeneric",
                  })}
                  {statementPeriodLabel?.trim() || r.period_label
                    ? ` · figures ${statementPeriodLabel?.trim() || r.period_label}`
                    : ""}
                  {r.figures_hash ? ` · hash ${r.figures_hash}` : ""}
                  {r.recipient_email ? ` · ${r.recipient_email}` : ""}
                  {r.pdf_storage_path ? " · PDF archived" : ""}
                </div>
              </div>
              <div
                className={reports ? "sent-history__actions" : undefined}
                style={reports ? undefined : { display: "flex", alignItems: "center", gap: 8 }}
              >
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
                  className={`chip chip-sentence ${r.acknowledged_at ? "ok" : "warn"}`}
                  style={{ alignSelf: "center" }}
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
