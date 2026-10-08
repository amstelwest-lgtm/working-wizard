/**
 * Honest ledger-link copy for the client Overview.
 *
 * A connected Xero or QuickBooks row is not the same thing as the figures
 * on the board. Uploads, trial balances, and an earlier snapshot can fill
 * the overview while last_synced_at is still empty — or while another
 * ledger's sync is the one that actually ran.
 */

import { readStatementMeta, yearToDateTitle, type YearBasis } from "@/lib/statement-period";

export type LedgerProvider = "xero" | "qbo" | "sage";

export type LedgerSyncFigures = {
  periodLabel: string | null;
  revenue: number | null;
  ytdPeriodLabel: string | null;
  ytdRevenue: number | null;
  ytdBasis: YearBasis | null;
  cash: number | null;
};

export type BoardFigures = LedgerSyncFigures & {
  source: string | null;
  savedAt: string | null;
};

export type LedgerLinkCopy = {
  /** First line under the organisation name. */
  statusLine: string;
  /** Where the overview figures came from, when this link did not write them. */
  figuresLine: string | null;
  /** Month-to-date / year / cash grid belongs to this sync. */
  showOwnStats: boolean;
};

const moneyFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(n: number | null): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return moneyFormat.format(n);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function providerName(provider: LedgerProvider): string {
  if (provider === "xero") return "Xero";
  if (provider === "sage") return "Sage";
  return "QuickBooks";
}

export function figureSourcePhrase(source: string | null | undefined): string {
  switch (source) {
    case "xero":
      return "a saved Xero statement";
    case "qbo":
      return "a saved QuickBooks statement";
    case "sage":
      return "a saved Sage statement";
    case "upload":
    case "pdf_upload":
      return "an uploaded statement";
    case "financial_statement":
      return "an imported statement";
    case "bank_pack":
      return "a bank import";
    case "manual":
      return "figures entered by hand";
    case "autosave":
      return "figures saved in Milōn";
    case "lighthouse_import":
      return "an import";
    default: {
      const raw = source?.trim() ?? "";
      if (!raw) return "figures already on file";
      if (/trial|tb/i.test(raw)) return "a trial balance import";
      if (/import/i.test(raw)) return "an import";
      return "figures already on file";
    }
  }
}

/** A blank source is not a chip. The phrase stays for callers that still want the words. */
export function showFigureSourceChip(source: string | null | undefined): boolean {
  return Boolean(source?.trim());
}

/**
 * Short title-case chip, same shape as Cash's "Bank".
 * Sentences keep figureSourcePhrase ("an uploaded statement").
 */
export function figureSourceChipLabel(source: string | null | undefined): string | null {
  if (!showFigureSourceChip(source)) return null;
  switch (source) {
    case "xero":
      return "Xero";
    case "qbo":
      return "QuickBooks";
    case "sage":
      return "Sage";
    case "upload":
    case "pdf_upload":
      return "Uploaded statement";
    case "financial_statement":
      return "Imported statement";
    case "bank_pack":
      return "Bank";
    case "manual":
      return "Manual";
    case "autosave":
      return "Saved figures";
    case "lighthouse_import":
      return "Import";
    case "assumption":
      return "Assumption";
    default: {
      const raw = source?.trim() ?? "";
      if (/trial|tb/i.test(raw)) return "Trial balance";
      if (/import/i.test(raw)) return "Import";
      return "Statement";
    }
  }
}

function hasSyncTimestamp(iso: string | null | undefined): iso is string {
  return Boolean(iso) && Number.isFinite(Date.parse(iso as string));
}

/** Newest snapshot that matches the live statement source, else the newest row. */
export function pickIngestSnapshot<T extends { source?: string | null }>(
  rows: readonly T[] | null | undefined,
  statementSource: string | null,
): T | null {
  const list = rows ?? [];
  if (!list.length) return null;
  if (statementSource) {
    const match = list.find((row) => row.source === statementSource);
    if (match) return match;
  }
  return list[0] ?? null;
}

/**
 * Figures the overview is actually showing, plus when they were last written.
 * `savedAt` is the later of the matching snapshot and financials_updated_at.
 */
export function boardFiguresFrom(input: {
  financials: unknown;
  snapshotSource?: string | null;
  snapshotCreatedAt?: string | null;
  financialsUpdatedAt?: string | null;
}): BoardFigures | null {
  const fields =
    input.financials && typeof input.financials === "object" && !Array.isArray(input.financials)
      ? (input.financials as Record<string, unknown>)
      : null;
  const meta = readStatementMeta(fields);
  const source = meta.statementSource || input.snapshotSource?.trim() || null;
  const revenue = fields ? num(fields.revenue) : null;
  const cash = fields ? num(fields.cash) : null;
  if (!source && !meta.periodLabel && revenue == null && cash == null) return null;
  const stamps = [input.snapshotCreatedAt, input.financialsUpdatedAt].filter((iso): iso is string =>
    hasSyncTimestamp(iso),
  );
  stamps.sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    source,
    savedAt: stamps.at(-1) ?? null,
    periodLabel: meta.periodLabel,
    revenue,
    ytdPeriodLabel: meta.ytdPeriodLabel,
    ytdRevenue: meta.ytdRevenue,
    ytdBasis: meta.ytdBasis,
    cash,
  };
}

/** Period and totals stored on a QuickBooks P&L / balance-sheet cache row. */
export function readCachedQboSync(pl: unknown, bs?: unknown): LedgerSyncFigures | null {
  if (!pl || typeof pl !== "object" || Array.isArray(pl)) return null;
  const row = pl as Record<string, unknown>;
  const periodLabel = typeof row.periodLabel === "string" ? row.periodLabel.trim() : "";
  if (!periodLabel) return null;
  const year =
    row.year && typeof row.year === "object" && !Array.isArray(row.year)
      ? (row.year as Record<string, unknown>)
      : null;
  const basis = year?.basis === "financial" || year?.basis === "calendar" ? year.basis : null;
  const ytdLabel = typeof year?.periodLabel === "string" ? year.periodLabel.trim() : "";
  const sheet =
    bs && typeof bs === "object" && !Array.isArray(bs) ? (bs as Record<string, unknown>) : null;
  return {
    periodLabel,
    revenue: num(row.revenue),
    ytdPeriodLabel: ytdLabel || null,
    ytdRevenue: year ? num(year.revenue) : null,
    ytdBasis: basis,
    cash: sheet ? num(sheet.cash) : null,
  };
}

function boardLine(
  board: BoardFigures,
  formatWhen: (iso: string) => string,
  trailing: string | null,
): string {
  const parts = [`Overview figures are from ${figureSourcePhrase(board.source)}`];
  if (board.periodLabel) parts.push(board.periodLabel);
  const revenue = money(board.revenue);
  if (revenue) parts.push(`Revenue ${revenue}`);
  if (board.ytdPeriodLabel) {
    const yearBits = [yearToDateTitle(board.ytdBasis), board.ytdPeriodLabel];
    const yearRevenue = money(board.ytdRevenue);
    if (yearRevenue) yearBits.push(`Revenue ${yearRevenue}`);
    parts.push(yearBits.join(" "));
  }
  const cash = money(board.cash);
  if (cash) parts.push(`Cash ${cash}`);
  let line = parts.join(" · ");
  if (hasSyncTimestamp(board.savedAt)) line += `, saved ${formatWhen(board.savedAt)}`;
  line += trailing ? `. ${trailing}` : ".";
  return line;
}

function ownClause(
  provider: LedgerProvider,
  own: LedgerSyncFigures,
  includeRevenue: boolean,
): string {
  let line = `${providerName(provider)} month to date ${own.periodLabel}`;
  if (includeRevenue) {
    const revenue = money(own.revenue);
    if (revenue) line += ` · Revenue ${revenue}`;
  }
  if (own.ytdPeriodLabel && includeRevenue) {
    line += ` · ${yearToDateTitle(own.ytdBasis)} ${own.ytdPeriodLabel}`;
    const yearRevenue = money(own.ytdRevenue);
    if (yearRevenue) line += ` · Revenue ${yearRevenue}`;
  }
  return line;
}

export type IngestSnapshotRow = {
  source?: string | null;
  created_at?: string | null;
};

/**
 * Split "this connection's sync" from the figures on the overview.
 * Blob totals stay on `syncFigures` only when this link wrote them.
 */
export function ledgerAttribution(input: {
  provider: LedgerProvider;
  lastSyncedAt: string | null;
  financials: unknown;
  financialsUpdatedAt?: string | null;
  snapshots?: readonly IngestSnapshotRow[] | null;
  /** Proof read off the live blob. Used only when statementSource is this provider. */
  ownFromBlob: LedgerSyncFigures | null;
  /** Cached sync for this provider, when the live blob belongs to someone else. */
  ownFromCache?: LedgerSyncFigures | null;
}): {
  figuresFromThisSync: boolean;
  syncFigures: LedgerSyncFigures | null;
  boardFigures: BoardFigures | null;
} {
  const meta = readStatementMeta(
    input.financials && typeof input.financials === "object" && !Array.isArray(input.financials)
      ? input.financials
      : null,
  );
  const ingest = pickIngestSnapshot(input.snapshots, meta.statementSource);
  const boardFigures = boardFiguresFrom({
    financials: input.financials,
    snapshotSource: ingest?.source ?? null,
    snapshotCreatedAt: ingest?.created_at ?? null,
    financialsUpdatedAt: input.financialsUpdatedAt ?? null,
  });
  const figuresFromThisSync =
    hasSyncTimestamp(input.lastSyncedAt) && meta.statementSource === input.provider;
  const syncFigures = figuresFromThisSync
    ? input.ownFromBlob
    : hasSyncTimestamp(input.lastSyncedAt)
      ? (input.ownFromCache ?? null)
      : null;
  return { figuresFromThisSync, syncFigures, boardFigures };
}

/**
 * Status under a linked Xero or QuickBooks name.
 * `formatWhen` receives a real timestamp; a missing sync does not become "never".
 */
export function describeLedgerLink(
  input: {
    provider: LedgerProvider;
    lastSyncedAt: string | null;
    syncStatus: string;
    /** True only when last_synced_at is set and the live blob is this provider. */
    figuresFromThisSync: boolean;
    /** This connection's own sync. Ignored when the link has never synced. */
    own: LedgerSyncFigures | null;
    /** What the overview snapshot is showing, whatever its source. */
    board: BoardFigures | null;
  },
  formatWhen: (iso: string) => string,
): LedgerLinkCopy {
  const name = providerName(input.provider);
  const syncedAt = input.lastSyncedAt;
  const synced = input.syncStatus !== "error" && hasSyncTimestamp(syncedAt);
  const own = synced ? input.own : null;
  const ownsBoard = Boolean(synced && input.figuresFromThisSync && own?.periodLabel);

  if (!synced || !hasSyncTimestamp(syncedAt)) {
    return {
      statusLine: `Connected. No ${name} sync yet.`,
      figuresLine: input.board ? boardLine(input.board, formatWhen, null) : null,
      showOwnStats: false,
    };
  }

  if (ownsBoard && own?.periodLabel) {
    return {
      statusLine: `Last sync ${formatWhen(syncedAt)} · ${ownClause(input.provider, own, true)}`,
      figuresLine: null,
      showOwnStats: true,
    };
  }

  if (input.figuresFromThisSync) {
    return {
      statusLine: `Last sync ${formatWhen(syncedAt)}. Sync again — the stored total has no period dates, so it is not this month.`,
      figuresLine: null,
      showOwnStats: false,
    };
  }

  if (own?.periodLabel) {
    const includeRevenue = own.revenue != null && own.revenue !== 0;
    return {
      statusLine: `Last sync ${formatWhen(syncedAt)} · ${ownClause(input.provider, own, includeRevenue)}`,
      figuresLine: input.board
        ? boardLine(input.board, formatWhen, `Not this ${name} sync.`)
        : null,
      showOwnStats: false,
    };
  }

  if (input.board?.periodLabel || input.board?.revenue != null || input.board?.cash != null) {
    return {
      statusLine: `Last sync ${formatWhen(syncedAt)}.`,
      figuresLine: input.board
        ? boardLine(input.board, formatWhen, `Not this ${name} sync.`)
        : null,
      showOwnStats: false,
    };
  }

  return {
    statusLine: `Last sync ${formatWhen(syncedAt)}. Sync again — the stored total has no period dates, so it is not this month.`,
    figuresLine: null,
    showOwnStats: false,
  };
}
