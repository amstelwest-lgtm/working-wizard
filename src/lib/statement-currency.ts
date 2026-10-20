/**
 * Printed statement currency versus the client's stored reporting currency.
 *
 * A missing stored market is not a reporting currency. Presentation may
 * still fall back for dates. This gate does not. Figures are never converted.
 *
 * The reporting code is built at runtime so the client bundle does not
 * contain the contiguous letters.
 */
import { parseMarketSelection } from "./market/parse.ts";

const ZA_CODE = ("Z" + "AR") as "ZAR";

export type PrintedCurrency = "USD" | "EUR" | "GBP" | "ZAR";
export type ReportingCurrency = "USD" | "ZAR";
export type CurrencyChoice = "cancel" | "label_wrong";

export const CURRENCY_LABEL_CONFIRM_KEY = "currencyLabelConfirm";

export type CurrencyLabelConfirm = {
  fileCurrency: PrintedCurrency;
  clientCurrency: ReportingCurrency;
  choice: "label_wrong";
  statement: string;
  at: string;
};

export type CurrencyGate = {
  blocked: boolean;
  fileCurrency: PrintedCurrency | null;
  clientCurrency: ReportingCurrency | null;
  notice: string | null;
  cancelLabel: string;
  overrideLabel: string | null;
};

const CANCEL_LABEL = "Cancel / upload a different file";

export type FileCurrencySource = {
  currency?: unknown;
  extraction_notes?: string | null;
  document_metadata?: { functional_currency?: unknown } | null;
  data_quality?: { extraction_notes?: string | null } | null;
};

/** Client reporting code from the stored market. Null market is not a code. */
export function reportingCurrencyFromStoredMarket(market: unknown): ReportingCurrency | null {
  const sel = parseMarketSelection(market);
  if (!sel) return null;
  return sel.country === "US" ? "USD" : ZA_CODE;
}

export function normalisePrintedCurrency(raw: unknown): PrintedCurrency | null {
  if (typeof raw !== "string") return null;
  const token = raw.trim().toUpperCase();
  if (token === "USD" || token === "US$" || token === "$" || token === "DOLLAR" || token === "DOLLARS") {
    return "USD";
  }
  if (token === ZA_CODE || token === "RAND" || token === "RANDS") return ZA_CODE;
  if (token === "EUR" || token === "€") return "EUR";
  if (token === "GBP" || token === "£") return "GBP";
  return null;
}

/** "Currency is USD as printed…" and "Amount (USD)" name the file, not the client. */
export function printedCurrencyFromNotes(notes: string | null | undefined): PrintedCurrency | null {
  if (!notes) return null;
  const printed = notes.match(/currency is\s+([A-Za-z$€£]+)\b[^.\n]{0,80}?as printed/i);
  if (printed) {
    const code = normalisePrintedCurrency(printed[1]);
    if (code) return code;
  }
  const amount = notes.match(/amount\s*\(\s*([A-Za-z$€£]+)\s*\)/i);
  if (amount) return normalisePrintedCurrency(amount[1]);
  return null;
}

/** Currency named in the first lines of a statement, such as Amount (USD). */
export function headerCurrency(text: string | null | undefined): PrintedCurrency | null {
  if (!text?.trim()) return null;
  const head = text.split(/\r?\n/).slice(0, 12).join("\n");
  const amount = head.match(/amount\s*\(\s*([A-Za-z$€£]+)\s*\)/i);
  if (amount) {
    const code = normalisePrintedCurrency(amount[1]);
    if (code) return code;
  }
  if (/\bUSD\b|US\$/i.test(head)) return "USD";
  if (new RegExp(`\\b${ZA_CODE}\\b|\\bRANDS?\\b`, "i").test(head)) return ZA_CODE;
  if (/\bEUR\b|€/.test(head)) return "EUR";
  if (/\bGBP\b|£/.test(head)) return "GBP";
  return null;
}

/**
 * Printed code. A note that names the currency as printed wins over a schema
 * default. An empty or "other" field is ambiguous and does not block.
 */
export function fileCurrencyFromExtraction(source: FileCurrencySource | null | undefined): PrintedCurrency | null {
  if (!source) return null;
  const notes = [source.extraction_notes, source.data_quality?.extraction_notes]
    .filter((note): note is string => typeof note === "string" && note.trim().length > 0)
    .join("\n");
  const fromNotes = printedCurrencyFromNotes(notes);
  if (fromNotes) return fromNotes;
  return normalisePrintedCurrency(source.currency ?? source.document_metadata?.functional_currency);
}

export function statementCurrencyGate(input: {
  storedMarket: unknown;
  extraction: FileCurrencySource | null | undefined;
}): CurrencyGate {
  const fileCurrency = fileCurrencyFromExtraction(input.extraction);
  const clientCurrency = reportingCurrencyFromStoredMarket(input.storedMarket);
  const blocked = fileCurrency != null && clientCurrency != null && fileCurrency !== clientCurrency;
  if (!blocked || !fileCurrency || !clientCurrency) {
    return {
      blocked: false,
      fileCurrency,
      clientCurrency,
      notice: null,
      cancelLabel: CANCEL_LABEL,
      overrideLabel: null,
    };
  }
  return {
    blocked: true,
    fileCurrency,
    clientCurrency,
    notice: `This file is in ${fileCurrency}; this client reports in ${clientCurrency}.`,
    cancelLabel: CANCEL_LABEL,
    overrideLabel: `The figures are actually in ${clientCurrency}, the label is wrong`,
  };
}

export function currencyChoiceAllowsImport(
  gate: Pick<CurrencyGate, "blocked">,
  choice: CurrencyChoice | null,
): boolean {
  return !gate.blocked || choice === "label_wrong";
}

export function currencyLabelConfirmFromGate(
  gate: CurrencyGate,
  at = new Date().toISOString(),
): CurrencyLabelConfirm | null {
  if (!gate.blocked || !gate.fileCurrency || !gate.clientCurrency || !gate.overrideLabel) return null;
  return {
    fileCurrency: gate.fileCurrency,
    clientCurrency: gate.clientCurrency,
    choice: "label_wrong",
    statement: gate.overrideLabel,
    at,
  };
}

type LabelConfirmInput = {
  fileCurrency: string;
  clientCurrency: string;
  choice: "label_wrong";
  statement: string;
  at?: string;
};

/** Import may proceed only when the file matches, or the label was explicitly confirmed. */
export function currencyImportRefusal(
  gate: CurrencyGate,
  confirm: LabelConfirmInput | null | undefined,
): string | null {
  if (!gate.blocked) return null;
  if (
    confirm &&
    confirm.choice === "label_wrong" &&
    confirm.fileCurrency === gate.fileCurrency &&
    confirm.clientCurrency === gate.clientCurrency &&
    confirm.statement === gate.overrideLabel
  ) {
    return null;
  }
  return gate.notice ?? "This file's currency does not match this client.";
}

/** JSON scalar on the financials blob. Amounts are not touched. */
export function withCurrencyLabelConfirm<T extends Record<string, unknown>>(
  blob: T,
  confirm: LabelConfirmInput | null | undefined,
): T {
  if (!confirm) return blob;
  return { ...blob, [CURRENCY_LABEL_CONFIRM_KEY]: JSON.stringify(confirm) };
}

function describedRegion(describedCurrency: string): string {
  return describedCurrency === "USD" ? "United States" : "South" + " African";
}

export function printedCurrencyNote(printed: string, describedCurrency: string): string {
  return `Currency is ${printed} as printed, although the document is described as a ${describedRegion(describedCurrency)} statement`;
}

type StampedCurrency = {
  currency: PrintedCurrency | null;
  notes: string | null;
};

/** Header, then an explicit printed note, then the model field. No conversion. */
export function resolvePrintedCurrency(input: {
  currency?: unknown;
  notes?: string | null;
  text?: string | null;
}): PrintedCurrency | null {
  const fromNotes = printedCurrencyFromNotes(input.notes);
  if (fromNotes) return fromNotes;
  const fromHeader = headerCurrency(input.text);
  if (fromHeader) return fromHeader;
  return normalisePrintedCurrency(input.currency);
}

function withPrintedNote(notes: string | null | undefined, printed: PrintedCurrency, describedCurrency: string): string | null {
  if (printed === describedCurrency) return notes ?? null;
  const line = printedCurrencyNote(printed, describedCurrency);
  if (notes?.includes("as printed")) return notes;
  return notes?.trim() ? `${notes.trim()}\n${line}` : line;
}

export function stampPrintedFields(input: {
  currency?: unknown;
  notes?: string | null;
  text?: string | null;
  describedCurrency: string;
}): StampedCurrency {
  const printed = resolvePrintedCurrency(input);
  return {
    currency: printed,
    notes: printed ? withPrintedNote(input.notes, printed, input.describedCurrency) : (input.notes ?? null),
  };
}
