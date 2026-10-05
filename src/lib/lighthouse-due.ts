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

/** Chip label. Generic names show firm plus email so two "team" rows differ. */
export function lighthouseLeadChipLabel(lead: {
  name?: string | null;
  company?: string | null;
  email?: string | null;
}): string {
  const name = (lead.name ?? "").trim();
  const company = (lead.company ?? "").trim();
  const email = (lead.email ?? "").trim();
  if (!isGenericLeadName(name, email)) return name || company || email || "Unnamed";
  const firm = company || name || "Unnamed";
  return email ? `${firm} · ${email}` : firm;
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
