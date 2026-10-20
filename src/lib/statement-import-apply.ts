/**
 * What a statement import tells the person who uploaded it.
 * The panel stays up until this message exists. A failure keeps Retry.
 */
import type { StatementKind } from "./statement-parse.ts";

export type ImportChoiceLabels = {
  replaceLabel: string;
  addLabel: string;
};

export type ImportApplyResult = {
  ok: boolean;
  message: string;
  /** Set when the file covers a different span and nothing was written yet. */
  choice?: ImportChoiceLabels | null;
};

/** The noun in "Imported, <what> updated". */
export function statementImportWhat(kind: StatementKind | null | undefined): string {
  if (kind === "balance_sheet") return "balance sheet";
  if (kind === "income_statement") return "income statement";
  if (kind === "mixed") return "income statement and balance sheet";
  return "statement";
}

export function importedUpdateMessage(what: string): string {
  const detail = what.trim() || "statement";
  return `Imported, ${detail} updated`;
}

export function importFailureMessage(reason?: string | null): string {
  const detail = reason?.trim();
  if (!detail) return "Import failed. Nothing was saved. Try again.";
  return `Import failed. ${detail}`;
}

/**
 * Stamp read before an autosave write. The write matches this stamp so a
 * statement import that landed in between is not replaced by the older form.
 */
export function seenFinancialsStamp(updatedAt: unknown): { eq: string } | { eq: null } {
  if (typeof updatedAt === "string" && updatedAt.trim()) return { eq: updatedAt };
  return { eq: null };
}

/** Inside `clients.financials`. An import bumps it so a late autosave misses. */
export const FINANCIALS_WRITE_REV_KEY = "_writeRev";

const WRITE_REV_COLUMN = `financials->>${FINANCIALS_WRITE_REV_KEY}`;

export function newFinancialsWriteRev(): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `w${time}${rand}`.replace(/[^a-z0-9]/g, "");
}

export function financialsWriteRev(financials: unknown): string | null {
  if (!financials || typeof financials !== "object" || Array.isArray(financials)) return null;
  const rev = (financials as Record<string, unknown>)[FINANCIALS_WRITE_REV_KEY];
  return typeof rev === "string" && /^w[a-z0-9]+$/.test(rev) ? rev : null;
}

/** Stamp the blob the import writes. Autosave does not copy this onto an older form. */
export function withFinancialsWriteRev<T extends Record<string, unknown>>(
  blob: T,
  rev = newFinancialsWriteRev(),
): T {
  return { ...blob, [FINANCIALS_WRITE_REV_KEY]: rev };
}

/**
 * The row changed after this autosave read it. A statement import landed.
 * The empty update is that race, not a permissions failure.
 */
export function financialsWriteSuperseded(seenRev: string | null, financials: unknown): boolean {
  return financialsWriteRev(financials) !== seenRev;
}

/**
 * Compare-and-set on the revision inside the financials blob.
 * A missing key matches only a row that still has no revision.
 */
export function guardFinancialsWrite<T>(query: T, seenRev: string | null): T {
  const builder = query as T & {
    eq: (column: string, value: string) => T;
    is: (column: string, value: null) => T;
  };
  if (seenRev) return builder.eq(WRITE_REV_COLUMN, seenRev);
  return builder.is(WRITE_REV_COLUMN, null);
}
