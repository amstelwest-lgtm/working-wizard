/**
 * Due-today queue identity and guards.
 * The board can show two real leads that share a mailbox-style name ("team").
 * The queue still collapses duplicate lead ids and the same email so one
 * address cannot be touched twice from Due today.
 */

export function normalizeLeadEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * True when the visible name is empty or is just the mailbox local part
 * (team@… displays as "team"). A real person name stays as-is.
 */
export function isGenericLeadName(
  name: string | null | undefined,
  email: string | null | undefined,
): boolean {
  const n = (name ?? "").trim().toLowerCase();
  if (!n) return true;
  const local = normalizeLeadEmail(email).split("@")[0] ?? "";
  return Boolean(local) && n === local;
}

const CONSUMER_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "live.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

/** A firm or person we can show. The mailbox itself is not a name. */
function usableLeadLabel(value: string, email: string): boolean {
  if (!value || value.includes("@")) return false;
  if (email && value.toLowerCase() === email.toLowerCase()) return false;
  return !isGenericLeadName(value, email);
}

/**
 * First domain label, title-cased. Consumer mail hosts are not firm names,
 * so those fall through to the raw address.
 */
export function prettifyEmailDomain(email: string | null | undefined): string {
  const normalized = normalizeLeadEmail(email);
  const at = normalized.lastIndexOf("@");
  if (at < 0) return "";
  const domain = normalized.slice(at + 1);
  if (!domain.includes(".") || CONSUMER_EMAIL_DOMAINS.has(domain)) return "";
  const label = domain.split(".")[0] ?? "";
  if (label.length < 2) return "";
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export type LeadLabelSource = {
  company?: string | null;
  /** `lighthouse_firms.name` when the lead company column is empty. */
  firmName?: string | null;
  name?: string | null;
  email?: string | null;
};

/**
 * One label for every lead surface.
 * Firm or company, then the contact, then a prettified email domain, then the raw email.
 */
export function leadDisplayName(lead: LeadLabelSource): string {
  const email = (lead.email ?? "").trim();
  const company = (lead.company ?? "").trim();
  const firmName = (lead.firmName ?? "").trim();
  const name = (lead.name ?? "").trim();
  if (usableLeadLabel(company, email)) return company;
  if (usableLeadLabel(firmName, email)) return firmName;
  if (usableLeadLabel(name, email)) return name;
  const domain = prettifyEmailDomain(email);
  if (domain) return domain;
  return email || "Unnamed";
}

/** Keep a real company. Otherwise take the lighthouse book firm name. */
export function applyBookFirmName<T extends { company: string | null; email?: string | null }>(
  lead: T,
  bookName: string | null | undefined,
): void {
  const email = lead.email ?? "";
  if (usableLeadLabel((lead.company ?? "").trim(), email)) return;
  const book = (bookName ?? "").trim();
  if (usableLeadLabel(book, email)) lead.company = book;
}

/** Chip, inbox, drawer, queue, and pipeline share one name. */
export function lighthouseLeadChipLabel(lead: LeadLabelSource): string {
  return leadDisplayName(lead);
}

export type DueQueueItem = {
  leadId: string;
  leadName: string;
  stepNo: number;
  email?: string | null;
};

/** One row per lead id, then one row per email. First occurrence wins. */
export function dedupeDueToday<T extends { leadId: string; email?: string | null }>(
  items: T[],
): T[] {
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!item.leadId || seenIds.has(item.leadId)) continue;
    seenIds.add(item.leadId);
    const email = normalizeLeadEmail(item.email);
    if (email) {
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);
    }
    out.push(item);
  }
  return out;
}

/** Drop a repeated lead id if a query ever returns the same row twice. */
export function dedupeLeadsById<T extends { id: string }>(leads: T[]): T[] {
  const seen = new Set<string>();
  return leads.filter((lead) => {
    if (!lead.id || seen.has(lead.id)) return false;
    seen.add(lead.id);
    return true;
  });
}

/**
 * True when this email already has a sent touch at this step (this lead or
 * another row with the same address). The send path treats that as a no-op.
 */
export function emailAlreadyTouchedAtStep(
  sent: Array<{ email: string | null | undefined; stepNo: number }>,
  email: string,
  stepNo: number,
): boolean {
  const key = normalizeLeadEmail(email);
  if (!key || !Number.isFinite(stepNo)) return false;
  return sent.some((row) => normalizeLeadEmail(row.email) === key && row.stepNo === stepNo);
}
