/**
 * Dividends tax draft pack: DTR01 (the company declaring the dividend) and
 * DTR02 (beneficial-owner lines, including a regulated-intermediary listing).
 *
 * Money is whole cents. A missing figure stays blank. An exempt line is Nil.
 * The 20% rate is the cited rate in docs/sars/README.md. It is not applied
 * when the payment date is missing or before 22 February 2017. A DTA rate
 * is only the figure the accountant types.
 *
 * Nothing is filed, and nothing is sent to a bookkeeping ledger.
 */
import { formatSampleCents } from "../sample-compute.ts";
import { plainRands } from "./irp6.ts";

export const DTR_TITLE = "Draft pack, not a SARS return";

/** Year column on the published rates table. See docs/sars/README.md. */
export const DTR_RULES_YEAR = 2027;

export const DTR_RATES_NOTE = `Rates from SARS published tables YA${DTR_RULES_YEAR}; accountant to confirm`;

export const DTR_PAYMENT_DATE_MESSAGE = "Enter payment date to work out the due date";

/**
 * 20% (2000 basis points) for a dividend paid on or after 22 February 2017.
 * Cited in docs/sars/README.md. Leave this null if that citation is removed.
 * Do not substitute another rate.
 */
export const DTR_STANDARD_RATE_BPS: number | null = 2000;

export const DTR_STANDARD_RATE_FROM = "2017-02-22";

const CITED_RATE_MESSAGE =
  "Enter a payment date on or after 22 February 2017 to use the cited rate";

export type DtrKind = "" | "cash" | "in-specie";

export type DtrTreatment = "" | "standard" | "exempt" | "dta";

export type DtrOwnerInput = {
  id: string;
  name: string;
  amountCents: number | null;
  treatment: DtrTreatment;
  exemptionReason: string;
  /** What the accountant typed, such as "10" or "10%". Never a default. */
  dtaRateText: string;
};

export type DtrInputs = {
  declarationDate: string;
  paymentDate: string;
  amountCents: number | null;
  kind: DtrKind;
  owners: DtrOwnerInput[];
};

export type DtrOwnerLine = {
  id: string;
  name: string;
  label: string;
  amountCents: number | null;
  treatment: DtrTreatment;
  exemptionReason: string;
  rateBps: number | null;
  withholdingCents: number | null;
  withholdingLabel: string;
  note: string;
};

export type DtrSheet = {
  title: string;
  ratesNote: string;
  declarationDate: string | null;
  paymentDate: string | null;
  amountCents: number | null;
  kind: DtrKind;
  kindLabel: string;
  dueDate: string | null;
  inSpecieNote: string;
  owners: DtrOwnerLine[];
  totalWithheldCents: number | null;
  totalWithheldLabel: string;
  messages: string[];
};

export function emptyDtrOwner(id = "owner"): DtrOwnerInput {
  return {
    id,
    name: "",
    amountCents: null,
    treatment: "",
    exemptionReason: "",
    dtaRateText: "",
  };
}

export function emptyDtrInputs(): DtrInputs {
  return {
    declarationDate: "",
    paymentDate: "",
    amountCents: null,
    kind: "",
    owners: [],
  };
}

/** Blank stays blank. A computed zero is Nil, never 0.00. */
export function dtrMoney(cents: number | null): string {
  if (cents == null) return "";
  if (cents === 0) return "Nil";
  return formatSampleCents(cents);
}

export function dtrMoneyPlain(cents: number | null): string {
  if (cents == null) return "";
  if (cents === 0) return "Nil";
  return plainRands(cents);
}

export function dtrKindLabel(kind: DtrKind): string {
  if (kind === "cash") return "Cash";
  if (kind === "in-specie") return "In specie";
  return "";
}

/** "10", "10%", or "10.5" to basis points. Empty or unreadable is null. */
export function parseDtrRateBps(text: string): number | null {
  const raw = text.trim().replace(/%/g, "").replace(/\s/g, "").replace(",", ".");
  if (!raw) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, frac = ""] = raw.split(".");
  const bps = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(bps) || bps > 10_000) return null;
  return bps;
}

export function formatDtrRate(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return `${whole}%`;
  if (frac % 10 === 0) return `${whole}.${frac / 10}%`;
  return `${whole}.${String(frac).padStart(2, "0")}%`;
}

/** YYYY-MM-DD, or null when the text is empty or not a real calendar day. */
export function parseDtrDate(value: string): string | null {
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > last) return null;
  return text;
}

/** Last calendar day of the month after the month the dividend was paid. */
export function dtrDueDate(paymentDate: string): string | null {
  const iso = parseDtrDate(paymentDate);
  if (!iso) return null;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const last = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

function wholeCents(value: number | null): number | null {
  if (value == null || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function applyRate(amountCents: number, rateBps: number): number | null {
  const product = amountCents * rateBps;
  if (!Number.isSafeInteger(product)) return null;
  return Math.round(product / 10_000);
}

function ownerLabel(owner: DtrOwnerInput, index: number): string {
  const name = owner.name.trim();
  return name || `beneficial owner ${index + 1}`;
}

function unique(rows: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    if (seen.has(row)) continue;
    seen.add(row);
    out.push(row);
  }
  return out;
}

export function computeDtr(inputs: DtrInputs): DtrSheet {
  const messages: string[] = [];
  const declarationDate = parseDtrDate(inputs.declarationDate);
  const paymentDate = parseDtrDate(inputs.paymentDate);
  const amountCents = wholeCents(inputs.amountCents);
  const kind = inputs.kind === "cash" || inputs.kind === "in-specie" ? inputs.kind : "";

  if (!declarationDate) messages.push("Enter declaration date");
  if (!paymentDate) messages.push(DTR_PAYMENT_DATE_MESSAGE);
  if (amountCents == null) messages.push("Enter dividend amount");
  if (!kind) messages.push("Enter whether the dividend is cash or in specie");

  const dueDate = paymentDate ? dtrDueDate(paymentDate) : null;
  const standardRate =
    DTR_STANDARD_RATE_BPS != null && paymentDate != null && paymentDate >= DTR_STANDARD_RATE_FROM
      ? DTR_STANDARD_RATE_BPS
      : null;
  let rateTooEarly = false;
  let citedRateMissing = false;

  const owners: DtrOwnerLine[] = inputs.owners.map((owner, index) => {
    const label = ownerLabel(owner, index);
    const lineAmount = wholeCents(owner.amountCents);
    const treatment =
      owner.treatment === "standard" || owner.treatment === "exempt" || owner.treatment === "dta"
        ? owner.treatment
        : "";
    if (lineAmount == null) messages.push(`Enter the amount for ${label}`);
    if (!treatment) messages.push(`Enter the treatment for ${label}`);

    const reason = owner.exemptionReason.trim();
    let rateBps: number | null = null;
    let withholdingCents: number | null = null;
    let note = "";

    if (treatment === "exempt") {
      if (!reason) messages.push(`Enter an exemption reason for ${label}`);
      if (lineAmount != null) {
        withholdingCents = 0;
        note = reason ? `Exempt. ${reason}` : "Exempt";
      }
    } else if (treatment === "dta") {
      rateBps = parseDtrRateBps(owner.dtaRateText);
      if (rateBps == null) messages.push(`Enter the DTA rate for ${label}`);
      if (lineAmount != null && rateBps != null) {
        withholdingCents = applyRate(lineAmount, rateBps);
        note = `Reduced DTA rate ${formatDtrRate(rateBps)}`;
      }
    } else if (treatment === "standard") {
      if (DTR_STANDARD_RATE_BPS == null) citedRateMissing = true;
      else if (paymentDate != null && paymentDate < DTR_STANDARD_RATE_FROM) rateTooEarly = true;
      else if (paymentDate != null && lineAmount != null && standardRate != null) {
        rateBps = standardRate;
        withholdingCents = applyRate(lineAmount, standardRate);
        note = `Standard rate ${formatDtrRate(standardRate)}`;
      }
    }

    return {
      id: owner.id,
      name: owner.name.trim(),
      label,
      amountCents: lineAmount,
      treatment,
      exemptionReason: reason,
      rateBps,
      withholdingCents,
      withholdingLabel: dtrMoney(withholdingCents),
      note,
    };
  });

  if (owners.length === 0) messages.push("Enter a beneficial owner");
  if (citedRateMissing) messages.push("The cited dividends tax rate is blank");
  if (rateTooEarly) messages.push(CITED_RATE_MESSAGE);

  if (amountCents != null && owners.length > 0 && owners.every((row) => row.amountCents != null)) {
    const sum = owners.reduce((total, row) => total + (row.amountCents ?? 0), 0);
    if (sum !== amountCents) {
      messages.push("Beneficial owner amounts do not add up to the dividend amount");
    }
  }

  const totalWithheldCents =
    owners.length > 0 && owners.every((row) => row.withholdingCents != null)
      ? owners.reduce((total, row) => total + (row.withholdingCents ?? 0), 0)
      : null;

  return {
    title: DTR_TITLE,
    ratesNote: DTR_RATES_NOTE,
    declarationDate,
    paymentDate,
    amountCents,
    kind,
    kindLabel: dtrKindLabel(kind),
    dueDate,
    inSpecieNote: kind === "in-specie" ? "On a dividend in specie the company bears this tax." : "",
    owners,
    totalWithheldCents,
    totalWithheldLabel: dtrMoney(totalWithheldCents),
    messages: unique(messages),
  };
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function fileSafe(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "Client"
  );
}

export function dtrFileName(clientName: string, ext: "pdf" | "csv"): string {
  return `DTR_${fileSafe(clientName)}.${ext}`;
}

/** Capture sheet. Blank amounts stay empty. Exempt withholding is Nil. */
export function dtrCsv(sheet: DtrSheet): string {
  const rows: string[][] = [
    ["Section", "Field", "Value", "Note"],
    ["", "Title", sheet.title, ""],
    ["", "Rates", sheet.ratesNote, ""],
    ["DTR01", "Declaration date", sheet.declarationDate ?? "", ""],
    ["DTR01", "Payment date", sheet.paymentDate ?? "", ""],
    ["DTR01", "Dividend amount", dtrMoneyPlain(sheet.amountCents), ""],
    ["DTR01", "Cash or in specie", sheet.kindLabel, sheet.inSpecieNote],
    ["DTR01", "Due date", sheet.dueDate ?? "", ""],
  ];
  if (sheet.owners.length === 0) rows.push(["DTR02", "Beneficial owners", "", ""]);
  for (const owner of sheet.owners) {
    rows.push(["DTR02", owner.label, dtrMoneyPlain(owner.amountCents), owner.note]);
    rows.push(["DTR02", `${owner.label} withholding`, dtrMoneyPlain(owner.withholdingCents), ""]);
  }
  rows.push(["DTR02", "Total withheld", dtrMoneyPlain(sheet.totalWithheldCents), ""]);
  for (const message of sheet.messages) rows.push(["", "Missing", message, ""]);
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}
