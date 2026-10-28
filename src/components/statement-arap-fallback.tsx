/**
 * Shared empty surface for Collections and Payables.
 * Tiles are the statement debtor days, creditor days, and the debtors and
 * creditors totals. Upload and connect can sit here or on the answer strip.
 */
import {
  COLLECTIONS_QBO_CTA,
  COLLECTIONS_SAGE_CTA,
  COLLECTIONS_UPLOAD_CTA,
  COLLECTIONS_XERO_CTA,
  type StatementWorkingCapital,
} from "@/lib/collections";
import { scoreCreditorDays, scoreLowerIsBetterDays } from "@/lib/client-metrics";
import { SAGE_NOT_SYNCED_HINT } from "@/lib/connect-books-copy";
import { t } from "@/lib/market/copy";
import { formatMoney, type MoneyMarket } from "@/lib/market/format";
import { healthBandLabel, scoreTier, type HealthTier } from "@/lib/ratios";

export type StatementCopyMarket = MoneyMarket & { copyPack?: "za" | "us" };

export function statementArApMoney(n: number, market?: MoneyMarket) {
  const cents = Math.abs(n - Math.round(n)) >= 0.005;
  return formatMoney(
    n,
    market,
    cents
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      : { maximumFractionDigits: 0, minimumFractionDigits: 0 },
  );
}

function copyPackOf(market?: StatementCopyMarket): "za" | "us" {
  return market?.copyPack === "us" ? "us" : "za";
}

export function statementArApMetricOrder(lead: "debtors" | "creditors" = "debtors") {
  return lead === "creditors"
    ? (["dpo", "ap", "dso", "ar"] as const)
    : (["dso", "ar", "dpo", "ap"] as const);
}

export function StatementArApTiles({
  position,
  market,
  id,
  lead = "debtors",
}: {
  position: StatementWorkingCapital;
  market?: StatementCopyMarket;
  id: string;
  /** Creditor cards lead on Payables. Collections keeps debtor cards first. */
  lead?: "debtors" | "creditors";
}) {
  const copy = { copyPack: copyPackOf(market) } as const;
  const byKey = new Map<string, { key: string; label: string; value: string; tier?: HealthTier }>();
  if (typeof position.debtorDays === "number" && Number.isFinite(position.debtorDays)) {
    byKey.set("dso", {
      key: "dso",
      label: t("dso", copy),
      value: `${position.debtorDays} days`,
      tier: scoreTier(scoreLowerIsBetterDays(position.debtorDays)),
    });
  }
  if (typeof position.receivables === "number" && Number.isFinite(position.receivables)) {
    byKey.set("ar", {
      key: "ar",
      label: t("receivables", copy),
      value: statementArApMoney(position.receivables, market),
    });
  }
  if (typeof position.creditorDays === "number" && Number.isFinite(position.creditorDays)) {
    byKey.set("dpo", {
      key: "dpo",
      label: t("dpo", copy),
      value: `${position.creditorDays} days`,
      tier: scoreTier(scoreCreditorDays(position.creditorDays)),
    });
  }
  if (typeof position.payables === "number" && Number.isFinite(position.payables)) {
    byKey.set("ap", {
      key: "ap",
      label: t("payables", copy),
      value: statementArApMoney(position.payables, market),
    });
  }
  const metrics = statementArApMetricOrder(lead).flatMap((key) => {
    const metric = byKey.get(key);
    return metric ? [metric] : [];
  });
  if (!metrics.length) return null;
  return (
    <dl className="statement-arap-position" id={id}>
      {metrics.map((metric) => (
        <div key={metric.key} data-metric={metric.key} data-tone={metric.tier ?? "neutral"}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
          {metric.tier ? (
            <dd className="statement-arap-band">
              <i aria-hidden="true" />
              {healthBandLabel(metric.tier)}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

export function StatementArApActions({
  idPrefix,
  onUploadAged,
  onConnectXero,
  onConnectQbo,
  onConnectSage,
  uploadClassName = "btn gold mini",
}: {
  idPrefix: string;
  onUploadAged?: () => void;
  onConnectXero?: () => void;
  onConnectQbo?: () => void;
  /** Non-US only. Sage checks the login; it does not pull figures yet. */
  onConnectSage?: () => void;
  uploadClassName?: string;
}) {
  if (!onUploadAged && !onConnectXero && !onConnectQbo && !onConnectSage) return null;
  return (
    <div className="statement-arap-actions">
      {onUploadAged ? (
        <button
          type="button"
          className={uploadClassName}
          id={`${idPrefix}-upload-aged`}
          onClick={onUploadAged}
        >
          {COLLECTIONS_UPLOAD_CTA}
        </button>
      ) : null}
      {onConnectXero ? (
        <button
          type="button"
          className="btn ghost mini"
          id={`${idPrefix}-connect-xero`}
          onClick={onConnectXero}
        >
          {COLLECTIONS_XERO_CTA}
        </button>
      ) : null}
      {onConnectQbo ? (
        <button
          type="button"
          className="btn ghost mini"
          id={`${idPrefix}-connect-qbo`}
          onClick={onConnectQbo}
        >
          {COLLECTIONS_QBO_CTA}
        </button>
      ) : null}
      {onConnectSage ? (
        <button
          type="button"
          className="btn ghost mini"
          id={`${idPrefix}-connect-sage`}
          title={SAGE_NOT_SYNCED_HINT}
          onClick={onConnectSage}
        >
          {COLLECTIONS_SAGE_CTA}
        </button>
      ) : null}
    </div>
  );
}

export function StatementArApFallback({
  idPrefix,
  position,
  market,
  periodLabel,
  fromStatements,
  lead,
  loading,
  loadingLead,
  booksNote,
  booksNoteId,
  footnote,
  kickerWhenEmpty,
  onUploadAged,
  onConnectXero,
  onConnectQbo,
  onConnectSage,
  omitLead = false,
  hideActions = false,
  cardLead = "debtors",
}: {
  idPrefix: string;
  position?: StatementWorkingCapital | null;
  market?: StatementCopyMarket;
  periodLabel?: string | null;
  fromStatements: boolean;
  lead: string;
  loading?: boolean;
  loadingLead: string;
  booksNote?: string | null;
  booksNoteId?: string;
  footnote: string;
  kickerWhenEmpty: string;
  onUploadAged?: () => void;
  onConnectXero?: () => void;
  onConnectQbo?: () => void;
  onConnectSage?: () => void;
  /** The answer strip owns the sentence. The long lead stays in the drawer. */
  omitLead?: boolean;
  /** The strip or the drawer owns upload and connect. */
  hideActions?: boolean;
  cardLead?: "debtors" | "creditors";
}) {
  return (
    <div className="collections" id={`${idPrefix}-from-statements`}>
      {booksNote ? (
        <p className="collections-note" id={booksNoteId}>
          {booksNote}
        </p>
      ) : null}
      <p className="collections-kicker">
        {fromStatements ? "From the statements" : kickerWhenEmpty}
        {fromStatements && periodLabel ? ` · ${periodLabel}` : ""}
      </p>
      {omitLead ? null : (
        <p className="collections-note" id={`${idPrefix}-fallback-lead`}>
          {loading ? loadingLead : lead}
        </p>
      )}
      {fromStatements && position ? (
        <StatementArApTiles
          position={position}
          market={market}
          id={`${idPrefix}-statement-position`}
          lead={cardLead}
        />
      ) : null}
      {hideActions ? null : (
        <StatementArApActions
          idPrefix={idPrefix}
          onUploadAged={onUploadAged}
          onConnectXero={onConnectXero}
          onConnectQbo={onConnectQbo}
          onConnectSage={onConnectSage}
        />
      )}
      <p className="collections-note">{footnote}</p>
    </div>
  );
}
