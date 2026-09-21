/**
 * ClientBriefing — the accountant Overview tab only.
 *
 * Status (identity, health, financial snapshot) → what matters → this month's
 * Milōn workflow. One card, no duplicated metrics, no unexplained numbers.
 */

import { useState, type ReactNode } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ClientOperatingProfile } from "@/lib/client-profile";
import { profileDisplayRows } from "@/lib/profile-signals";
import { healthHeadline, type SnapshotMetric } from "@/lib/client-briefing";
import type { BriefingWorkflow } from "@/lib/client-briefing.functions";
import { useMarketFormat } from "@/contexts/market";
import { AddPastPeriodLink } from "@/components/add-past-period-link";
import { yearToDateTitle } from "@/lib/statement-period";

export type XeroLinkProof = {
  tenantName: string | null;
  lastSyncedAt: string | null;
  syncStatus: string;
  periodLabel: string | null;
  revenue: number | null;
  ytdPeriodLabel?: string | null;
  ytdRevenue?: number | null;
  ytdBasis?: "financial" | "calendar" | null;
};

function fmtProofWhen(iso: string | null) {
  if (!iso) return "not yet";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "not yet";
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtProofMoney(n: number | null) {
  if (n == null || !Number.isFinite(n)) return null;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type ClientBriefingProps = {
  clientName: string;
  clientCode?: string | null;
  industryLabel: string;
  /** Health ring rendered by the page (keeps the shared ring styling). */
  ring: ReactNode;
  healthScore: number | null;
  healthLabel: string;
  healthStatus: "healthy" | "at_risk" | "critical" | null;
  onViewBreakdown?: () => void;
  snapshot: SnapshotMetric[];
  about: string | null;
  profile: ClientOperatingProfile | null;
  onEditProfile?: () => void;
  whatMatters: string | null;
  workflow: BriefingWorkflow | null;
  workflowLoading: boolean;
  onRefreshWorkflow?: () => void;
  openQueries: number;
  onOpenQueries?: () => void;
  reportsIssued: number;
  movementReportAvailable: boolean;
  onOpenMovementReport?: () => void;
  onOpenReports?: () => void;
  onAddPastPeriod?: () => void;
  hasFigures: boolean;
  /** Primary upload — always in the briefing, not behind a tab. */
  onUpload?: () => void;
  onConnectQuickBooks?: () => void;
  onConnectXero?: () => void;
  /** Present when this client has a Xero connection. Revenue only after a dated sync. */
  xeroLink?: XeroLinkProof | null;
};

export function ClientBriefing(p: ClientBriefingProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const { market } = useMarketFormat();
  const statusTone =
    p.healthStatus === "critical" ? "risk" : p.healthStatus === "at_risk" ? "warn" : "ok";

  return (
    <section className="card briefing" aria-label="Client briefing">
      <div className="briefing-status">
        <div className="briefing-id">
          <div className="briefing-id-row">
            <div className="ring big-ring">{p.ring}</div>
            <div>
              <h1>{p.clientName}</h1>
              <div className="briefing-type">
                {p.clientCode ? <code>{p.clientCode}</code> : null}
                <span>{p.industryLabel}</span>
              </div>
            </div>
          </div>
          <div className="briefing-health">
            <span className={`briefing-dot ${statusTone}`} aria-hidden="true" />
            <div>
              <span className="briefing-kicker">Financial Health</span>
              <b>{healthHeadline(p.healthScore, p.healthLabel)}</b>
              {p.healthScore != null && p.onViewBreakdown ? (
                <button type="button" className="btn gold mini" onClick={p.onViewBreakdown}>
                  View breakdown
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="briefing-snapshot">
          <span className="briefing-kicker">Financial snapshot</span>
          {p.snapshot.length === 0 ? (
            <p className="briefing-muted">No figures yet — upload statements to populate.</p>
          ) : (
            <dl>
              {p.snapshot.map((m) => (
                <div key={m.key} className="briefing-metric">
                  <dt>{m.label}</dt>
                  <dd>
                    <span className="briefing-value">{m.value}</span>
                    {m.delta ? (
                      <span
                        className={`briefing-delta ${m.delta.direction === "flat" ? "flat" : m.delta.good ? "good" : "bad"}`}
                        title={m.hint ?? "vs prior period"}
                      >
                        {m.delta.direction === "up"
                          ? "↑"
                          : m.delta.direction === "down"
                            ? "↓"
                            : "→"}{" "}
                        {m.delta.text}
                      </span>
                    ) : m.hint ? (
                      <span className="briefing-hint">{m.hint}</span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {p.xeroLink ? (
            <p className="briefing-muted" id="xero-link-proof" style={{ marginTop: 10 }}>
              <span className="briefing-kicker">Xero linked</span>
              <br />
              <b>{p.xeroLink.tenantName?.trim() || "Organisation connected"}</b>
              {" · "}
              {p.xeroLink.syncStatus === "error"
                ? "Last sync needs attention"
                : `Last sync ${fmtProofWhen(p.xeroLink.lastSyncedAt)}`}
              {p.xeroLink.periodLabel ? (
                <>
                  <br />
                  Month to date · {p.xeroLink.periodLabel}
                  {fmtProofMoney(p.xeroLink.revenue)
                    ? ` · Revenue ${fmtProofMoney(p.xeroLink.revenue)}`
                    : ""}
                </>
              ) : (
                <>
                  <br />
                  Sync again — the stored total has no period dates, so it is not this month.
                </>
              )}
              {p.xeroLink.ytdPeriodLabel ? (
                <>
                  <br />
                  {yearToDateTitle(p.xeroLink.ytdBasis ?? null)}
                  {" · "}
                  {p.xeroLink.ytdPeriodLabel}
                  {fmtProofMoney(p.xeroLink.ytdRevenue ?? null)
                    ? ` · Revenue ${fmtProofMoney(p.xeroLink.ytdRevenue ?? null)}`
                    : ""}
                </>
              ) : null}
            </p>
          ) : null}
          <div className="briefing-actions">
            {p.onUpload ? (
              <button
                type="button"
                id="client-upload-cta"
                className="btn gold"
                onClick={p.onUpload}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 15V3M7 8l5-5 5 5M5 21h14" />
                </svg>
                Upload
              </button>
            ) : null}
            {p.onConnectQuickBooks ? (
              <button
                type="button"
                id="client-connect-qbo"
                className="btn ghost mini"
                onClick={p.onConnectQuickBooks}
              >
                Connect QuickBooks
              </button>
            ) : null}
            {p.onConnectXero ? (
              <button
                type="button"
                id="client-connect-xero"
                className="btn ghost mini"
                onClick={p.onConnectXero}
              >
                Connect Xero
              </button>
            ) : null}
            {p.openQueries > 0 ? (
              <button
                type="button"
                id="wizard-open-queries"
                className="btn gold mini"
                onClick={p.onOpenQueries}
              >
                {p.openQueries} open {p.openQueries === 1 ? "query" : "queries"}
              </button>
            ) : (
              <button
                type="button"
                id="wizard-open-queries"
                className="btn ghost mini"
                onClick={p.onOpenQueries}
              >
                No open queries
              </button>
            )}
            {p.hasFigures && p.movementReportAvailable ? (
              <button type="button" className="btn gold mini" onClick={p.onOpenMovementReport}>
                Open movement report
              </button>
            ) : null}
            {p.onOpenReports ? (
              <button type="button" className="btn gold mini" onClick={p.onOpenReports}>
                {p.reportsIssued > 0 ? "Open Reports" : "Create report"}
              </button>
            ) : p.reportsIssued > 0 ? (
              <span className="briefing-muted">
                {p.reportsIssued} {p.reportsIssued === 1 ? "report" : "reports"} issued
              </span>
            ) : null}
            {p.hasFigures && !p.movementReportAvailable ? (
              <span className="briefing-muted">
                Movement needs another period.{" "}
                {p.onAddPastPeriod ? <AddPastPeriodLink onOpen={p.onAddPastPeriod} /> : null}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {(p.about || p.onEditProfile) && (
        <div className="briefing-about">
          <span className="briefing-kicker">About this business</span>
          {p.about ? (
            <p>{p.about}</p>
          ) : (
            <p className="briefing-muted">
              No business profile yet — ten questions tune the score, budget and advice.
            </p>
          )}
          <div className="briefing-actions">
            {p.profile ? (
              <button type="button" className="btn gold mini" onClick={() => setProfileOpen(true)}>
                View full profile
              </button>
            ) : null}
            {p.onEditProfile ? (
              <button
                type="button"
                className="btn gold mini"
                onClick={p.onEditProfile}
              >
                {p.profile ? "Edit profile" : "Fill profile now"}
              </button>
            ) : null}
          </div>
        </div>
      )}

      {p.hasFigures && (
        <div className="briefing-brief">
          {p.whatMatters ? (
            <div>
              <span className="briefing-kicker">What matters</span>
              <p>{p.whatMatters}</p>
            </div>
          ) : null}
          <div>
            <span className="briefing-kicker gold">This month&apos;s Milōn workflow</span>
            {p.workflow ? (
              <p>{p.workflow.text}</p>
            ) : p.workflowLoading ? (
              <p className="briefing-muted">
                <Loader2 className="briefing-spin" /> Reading this client&apos;s position…
              </p>
            ) : (
              <p className="briefing-muted">Not available right now.</p>
            )}
            {p.onRefreshWorkflow && p.workflow ? (
              <button
                type="button"
                className="btn ghost mini"
                onClick={p.onRefreshWorkflow}
                disabled={p.workflowLoading}
                title="Redraft from the current figures"
              >
                <RefreshCw className="briefing-icon" /> Refresh
              </button>
            ) : null}
          </div>
        </div>
      )}

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="briefing-profile-dialog max-w-xl border-[#d4a550]/35 bg-[linear-gradient(180deg,#fffdf8,#f7f1e3)] text-[#1b1300] shadow-[0_28px_80px_rgba(109,79,22,0.18)] dark:bg-[linear-gradient(180deg,#121826,#0b1220)] dark:text-slate-100">
          <DialogHeader>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#b8860b]">
              Business profile
            </p>
            <DialogTitle className="font-serif text-[22px] font-semibold tracking-tight">
              {p.clientName}
            </DialogTitle>
            <DialogDescription className="text-[13px] text-[#6b6354] dark:text-slate-400">
              The ten answers that tune Milōn for this business — score, budget and advice.
            </DialogDescription>
          </DialogHeader>
          {p.profile ? (
            <dl className="mt-2 grid gap-x-8 gap-y-3 border-t border-[#d4a550]/20 pt-4 text-sm sm:grid-cols-[minmax(0,11rem)_1fr]">
              {profileDisplayRows(p.profile, market).map((r) => (
                <div key={r.label} className="contents">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#b8860b] sm:pt-0.5">
                    {r.label}
                  </dt>
                  <dd className="text-[14px] leading-snug">{r.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {p.onEditProfile ? (
            <button
              type="button"
              className="btn gold mini mt-5 self-start"
              onClick={() => {
                setProfileOpen(false);
                p.onEditProfile?.();
              }}
            >
              Edit answers
            </button>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
