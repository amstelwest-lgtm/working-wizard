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
import { BrandConnectButton } from "@/components/brand-connect-button";
import { portalButtonClass } from "@/lib/client-chrome";
import { formatIsoDateUTC } from "@/lib/statement-period";
import {
  describeLedgerLink,
  type BoardFigures,
  type LedgerProvider,
  type LedgerSyncFigures,
} from "@/lib/ledger-link-copy";

export type LedgerLinkProof = {
  tenantName: string | null;
  lastSyncedAt: string | null;
  syncStatus: string;
  periodLabel: string | null;
  revenue: number | null;
  ytdPeriodLabel?: string | null;
  ytdRevenue?: number | null;
  ytdBasis?: "financial" | "calendar" | null;
  bsAsOf?: string | null;
  bankCount?: number | null;
  bankTotal?: number | null;
  bankWarning?: string | null;
  bankFrom?: string | null;
  bankTo?: string | null;
  openingCashNote?: string | null;
  forecastLinesNote?: string | null;
  /** True when last_synced_at is set and the live blob was written by this link. */
  figuresFromThisSync?: boolean;
  /** This connection's own sync. Null when the link has not synced. */
  syncFigures?: LedgerSyncFigures | null;
  /** Figures the overview is showing, including upload / snapshot / the other ledger. */
  boardFigures?: BoardFigures | null;
};

export type XeroLinkProof = LedgerLinkProof;

function fmtProofWhen(
  iso: string | null,
  dateTime: (d: Date | string | number) => string,
) {
  if (!iso) return "not yet";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "not yet";
  const label = dateTime(d);
  return label === "—" ? "not yet" : label;
}

function fmtProofMoney(n: number | null) {
  if (n == null || !Number.isFinite(n)) return null;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function LedgerProof({
  id,
  title,
  provider,
  link,
  fallbackName,
}: {
  id: string;
  title: string;
  provider: LedgerProvider;
  link: LedgerLinkProof;
  fallbackName: string;
}) {
  const { dateTime, market } = useMarketFormat();
  const copy =
    link.syncStatus === "error"
      ? null
      : describeLedgerLink(
          {
            provider,
            lastSyncedAt: link.lastSyncedAt,
            syncStatus: link.syncStatus,
            figuresFromThisSync:
              link.figuresFromThisSync ?? Boolean(link.lastSyncedAt && link.periodLabel),
            own:
              link.syncFigures !== undefined
                ? link.syncFigures
                : link.periodLabel
                  ? {
                      periodLabel: link.periodLabel,
                      revenue: link.revenue,
                      ytdPeriodLabel: link.ytdPeriodLabel ?? null,
                      ytdRevenue: link.ytdRevenue ?? null,
                      ytdBasis: link.ytdBasis ?? null,
                      cash: null,
                    }
                  : null,
            board: link.boardFigures ?? null,
          },
          (iso) => fmtProofWhen(iso, dateTime),
        );
  return (
    <p className="briefing-muted" id={id} style={{ marginTop: 10 }}>
      <span className="briefing-kicker">{title}</span>
      <br />
      <b>{link.tenantName?.trim() || fallbackName}</b>
      {" · "}
      {link.syncStatus === "error" ? "Last sync needs attention" : copy?.statusLine}
      {copy?.figuresLine ? (
        <>
          <br />
          {copy.figuresLine}
        </>
      ) : null}
      {link.bsAsOf ? (
        <>
          <br />
          Balance sheet as of {formatIsoDateUTC(link.bsAsOf, market)}
        </>
      ) : null}
      {link.bankFrom && link.bankTo ? (
        <>
          <br />
          Bank Summary {formatIsoDateUTC(link.bankFrom, market)} – {formatIsoDateUTC(link.bankTo, market)}
        </>
      ) : null}
      {link.bankCount != null ? (
        <>
          <br />
          Bank accounts · {link.bankCount}
          {fmtProofMoney(link.bankTotal ?? null)
            ? ` · ${fmtProofMoney(link.bankTotal ?? null)}`
            : ""}
        </>
      ) : link.bankWarning ? (
        <>
          <br />
          {link.bankWarning}
        </>
      ) : null}
      {link.openingCashNote ? (
        <>
          <br />
          {link.openingCashNote}
        </>
      ) : null}
      {link.forecastLinesNote ? (
        <>
          <br />
          {link.forecastLinesNote}
        </>
      ) : null}
    </p>
  );
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
  /** Debtor days from the ratios. The profile default is not a substitute. */
  debtorDays?: number | null;
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
  /**
   * Dated statement range for the figures on the board. When it is missing,
   * the workflow kicker does not call the work "this month".
   */
  figuresPeriodLabel?: string | null;
  /** When the answer strip shows this line, the briefing does not repeat it. */
  hideWhatMatters?: boolean;
  /** Score has its own page. The ring and the health headline stay off this briefing. */
  hideScore?: boolean;
  /** Revenue, margins, cash, and ledger proof live on Profit, Cash, and Books. */
  hideFigures?: boolean;
  /** Upload, connect, and the other secondary links live in Review inputs. */
  hideConnectionActions?: boolean;
  /** Primary upload — always in the briefing, not behind a tab. */
  onUpload?: () => void;
  onConnectQuickBooks?: () => void;
  onConnectXero?: () => void;
  onConnectSage?: () => void;
  /** Present when this client has a QuickBooks connection. Revenue only after a dated sync. */
  qboLink?: LedgerLinkProof | null;
  /** Present when this client has a Xero connection. Revenue only after a dated sync. */
  xeroLink?: XeroLinkProof | null;
};

export function ClientBriefing(p: ClientBriefingProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const { market } = useMarketFormat();
  const syncOwnsFigures = Boolean(
    p.qboLink?.figuresFromThisSync || p.xeroLink?.figuresFromThisSync,
  );
  const statusTone =
    p.healthStatus === "critical" ? "risk" : p.healthStatus === "at_risk" ? "warn" : "ok";

  return (
    <section className="card briefing" aria-label="Client briefing">
      <div className="briefing-status">
        <div className="briefing-id">
          <div className="briefing-id-row">
            {p.hideScore ? null : <div className="ring big-ring">{p.ring}</div>}
            <div>
              <h1>{p.clientName}</h1>
              <div className="briefing-type">
                {p.clientCode ? <code>{p.clientCode}</code> : null}
                <span>{p.industryLabel}</span>
              </div>
            </div>
          </div>
          {p.hideScore ? null : (
          <div className="briefing-health">
            <span className={`briefing-dot ${statusTone}`} aria-hidden="true" />
            <div>
              <span className="briefing-kicker">Financial Health</span>
              <b>{healthHeadline(p.healthScore, p.healthLabel)}</b>
              {p.healthScore != null && p.onViewBreakdown ? (
                <button type="button" className={portalButtonClass("secondary")} onClick={p.onViewBreakdown}>
                  View breakdown
                </button>
              ) : null}
            </div>
          </div>
          )}
        </div>

        {p.hideFigures && p.hideConnectionActions ? null : (
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
          {p.qboLink ? (
            <LedgerProof
              id="qbo-link-proof"
              title="QuickBooks linked"
              provider="qbo"
              link={p.qboLink}
              fallbackName="Company connected"
            />
          ) : null}
          {p.xeroLink ? (
            <LedgerProof
              id="xero-link-proof"
              title="Xero linked"
              provider="xero"
              link={p.xeroLink}
              fallbackName="Organisation connected"
            />
          ) : null}
          {p.hideConnectionActions ? null : (
          <div className="briefing-actions">
            {p.onUpload ? (
              <button
                type="button"
                id="client-upload-cta"
                className={portalButtonClass("secondary")}
                onClick={p.onUpload}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 15V3M7 8l5-5 5 5M5 21h14" />
                </svg>
                {syncOwnsFigures ? "Upload a statement instead" : "Upload"}
              </button>
            ) : null}
            {syncOwnsFigures ? null : (
              <>
                {p.onConnectQuickBooks ? (
                  <BrandConnectButton
                    id="client-connect-qbo"
                    brand="quickbooks"
                    onClick={p.onConnectQuickBooks}
                  />
                ) : null}
                {p.onConnectXero ? (
                  <BrandConnectButton
                    id="client-connect-xero"
                    brand="xero"
                    onClick={p.onConnectXero}
                  />
                ) : null}
                {p.onConnectSage ? (
                  <BrandConnectButton
                    id="client-connect-sage"
                    brand="sage"
                    onClick={p.onConnectSage}
                  />
                ) : null}
              </>
            )}
            {p.openQueries > 0 ? (
              <button
                type="button"
                id="wizard-open-queries"
                className={portalButtonClass("secondary")}
                onClick={p.onOpenQueries}
              >
                {p.openQueries} open {p.openQueries === 1 ? "query" : "queries"}
              </button>
            ) : (
              <button
                type="button"
                id="wizard-open-queries"
                className={portalButtonClass("secondary")}
                onClick={p.onOpenQueries}
              >
                No open queries
              </button>
            )}
            {p.hasFigures && p.movementReportAvailable ? (
              <button type="button" className={portalButtonClass("secondary")} onClick={p.onOpenMovementReport}>
                Open movement report
              </button>
            ) : null}
            {p.onOpenReports ? (
              <button type="button" className={portalButtonClass("secondary")} onClick={p.onOpenReports}>
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
          )}
        </div>
        )}
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
              <button type="button" className={portalButtonClass("secondary")} onClick={() => setProfileOpen(true)}>
                View full profile
              </button>
            ) : null}
            {p.onEditProfile ? (
              <button type="button" className={portalButtonClass("secondary")} onClick={p.onEditProfile}>
                {p.profile ? "Edit profile" : "Fill profile now"}
              </button>
            ) : null}
          </div>
        </div>
      )}

      {p.hasFigures && (
        <div className="briefing-brief">
          {p.whatMatters && !p.hideWhatMatters ? (
            <div>
              <span className="briefing-kicker">What matters</span>
              <p>{p.whatMatters}</p>
            </div>
          ) : null}
          <div>
            <span className="briefing-kicker gold">
              {p.figuresPeriodLabel ? "This month's Milōn workflow" : "Milōn workflow"}
            </span>
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
        <DialogContent className="briefing-profile-dialog max-w-xl border-[#DBEAFE] bg-white text-[#102A43] shadow-[0_16px_40px_rgba(16,42,67,0.12)] dark:border-[#1e3a5f] dark:bg-[#0B1B2B] dark:text-[#F4F7FB]">
          <DialogHeader>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#102A43]">
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
            <dl className="mt-2 grid gap-x-8 gap-y-3 border-t border-[#0B5FFF]/20 pt-4 text-sm sm:grid-cols-[minmax(0,11rem)_1fr]">
              {profileDisplayRows(p.profile, market, p.debtorDays, p.industryLabel).map((r) => (
                <div key={r.label} className="contents">
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#102A43] sm:pt-0.5">
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
