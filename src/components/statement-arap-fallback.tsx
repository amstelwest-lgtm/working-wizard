/**
 * Shared empty surface for Collections and Payables.
 * Tiles are the Ratios Days AR / Days AP / AR $ / AP $ helper. The three
 * actions upload the aged report or connect the books.
 */
import {
  COLLECTIONS_QBO_CTA,
  COLLECTIONS_UPLOAD_CTA,
  COLLECTIONS_XERO_CTA,
  type StatementWorkingCapital,
} from "@/lib/collections";
import { t } from "@/lib/market/copy";
import { formatMoney, type MoneyMarket } from "@/lib/market/format";

export type StatementCopyMarket = MoneyMarket & { copyPack?: "za" | "us" };

function statementMoney(n: number, market?: MoneyMarket) {
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

export function StatementArApTiles({
  position,
  market,
  id,
}: {
  position: StatementWorkingCapital;
  market?: StatementCopyMarket;
  id: string;
}) {
  const copy = { copyPack: copyPackOf(market) } as const;
  const metrics: { key: string; label: string; value: string }[] = [];
  if (typeof position.debtorDays === "number" && Number.isFinite(position.debtorDays)) {
    metrics.push({ key: "dso", label: t("dso", copy), value: `${position.debtorDays} days` });
  }
  if (typeof position.receivables === "number" && Number.isFinite(position.receivables)) {
    metrics.push({
      key: "ar",
      label: t("receivables", copy),
      value: statementMoney(position.receivables, market),
    });
  }
  if (typeof position.creditorDays === "number" && Number.isFinite(position.creditorDays)) {
    metrics.push({ key: "dpo", label: t("dpo", copy), value: `${position.creditorDays} days` });
  }
  if (typeof position.payables === "number" && Number.isFinite(position.payables)) {
    metrics.push({
      key: "ap",
      label: t("payables", copy),
      value: statementMoney(position.payables, market),
    });
  }
  if (!metrics.length) return null;
  return (
    <dl className="statement-arap-position" id={id}>
      {metrics.map((metric) => (
        <div key={metric.key} data-metric={metric.key}>
          <dt>{metric.label}</dt>
          <dd>{metric.value}</dd>
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
}: {
  idPrefix: string;
  onUploadAged?: () => void;
  onConnectXero?: () => void;
  onConnectQbo?: () => void;
}) {
  if (!onUploadAged && !onConnectXero && !onConnectQbo) return null;
  return (
    <div className="statement-arap-actions">
      {onUploadAged ? (
        <button
          type="button"
          className="btn gold mini"
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
      <p className="collections-note" id={`${idPrefix}-fallback-lead`}>
        {loading ? loadingLead : lead}
      </p>
      {fromStatements && position ? (
        <StatementArApTiles
          position={position}
          market={market}
          id={`${idPrefix}-statement-position`}
        />
      ) : null}
      <StatementArApActions
        idPrefix={idPrefix}
        onUploadAged={onUploadAged}
        onConnectXero={onConnectXero}
        onConnectQbo={onConnectQbo}
      />
      <p className="collections-note">{footnote}</p>
    </div>
  );
}
