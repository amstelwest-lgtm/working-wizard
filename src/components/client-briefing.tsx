/**
 * ClientBriefing — the top of the accountant client page.
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
  hasFigures: boolean;
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
          <div className="briefing-actions">
            {p.openQueries > 0 ? (
              <button type="button" className="btn gold mini" onClick={p.onOpenQueries}>
                {p.openQueries} open {p.openQueries === 1 ? "query" : "queries"}
              </button>
            ) : (
              <button type="button" className="btn ghost mini" onClick={p.onOpenQueries}>
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
              <span className="briefing-muted" title="Save a second period snapshot to compare">
                Movement report needs a prior period
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
                className={p.profile ? "btn ghost mini" : "btn gold mini"}
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
        <DialogContent className="max-w-lg border-[var(--line)] bg-[var(--bg-2)] text-[var(--ink)]">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-semibold uppercase tracking-[0.15em]">
              Business profile
            </DialogTitle>
            <DialogDescription className="text-xs text-[var(--ink-dim)]">
              The ten answers that tune Milōn for {p.clientName}.
            </DialogDescription>
          </DialogHeader>
          {p.profile ? (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(0,9rem)_1fr]">
              {profileDisplayRows(p.profile, market).map((r) => (
                <div key={r.label} className="contents">
                  <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-dim)] sm:pt-0.5">
                    {r.label}
                  </dt>
                  <dd>{r.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {p.onEditProfile ? (
            <button
              type="button"
              className="btn gold mini mt-3 self-start"
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
