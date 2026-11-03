/**
 * Multi-company groups, parent plan P0.
 *
 * A group is a navigation and billing bucket. It is not a set of books.
 * Nothing here totals money, and agents stay on one company.
 *
 * Individual entities do not count toward the included 3. A placeholder
 * counts only once books are connected or data has been uploaded.
 * Group chrome stays hidden while a group has one company.
 */

export const ENTITY_TYPES = [
  "company",
  "cc",
  "trust",
  "sole_prop",
  "individual",
  "partnership",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export const INCLUDED_COMPANIES = 3;

export const ENTITY_LABEL: Record<EntityType, string> = {
  company: "Company",
  cc: "Close corporation",
  trust: "Trust",
  sole_prop: "Sole prop",
  individual: "Individual",
  partnership: "Partnership",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function isEntityType(value: string | null | undefined): value is EntityType {
  return ENTITY_TYPES.includes(value as EntityType);
}

export function entityLabel(value: string | null | undefined): string {
  return isEntityType(value) ? ENTITY_LABEL[value] : "Company";
}

export function yearEndLabel(month: number | null | undefined): string {
  if (month == null || month < 1 || month > 12) return "Not set";
  return MONTHS[month - 1] ?? "Not set";
}

/** Financial year starts the month after year-end. December ends into January. */
export function financialYearStartMonth(yearEndMonth: number | null): number | null {
  if (yearEndMonth == null || yearEndMonth < 1 || yearEndMonth > 12) return null;
  return (yearEndMonth % 12) + 1;
}

export type SlotCompany = {
  entityType: string | null;
  placeholder: boolean;
  booksConnectedAt?: string | null;
  dataUploadedAt?: string | null;
  /** Live ledger connection, when the timestamp has not been stamped yet. */
  connected?: boolean;
};

/** Mirrors company_counts_toward_group_slot, plus a live connection flag. */
export function countsTowardCompanySlot(company: SlotCompany): boolean {
  if (company.entityType === "individual") return false;
  if (!company.placeholder) return true;
  return Boolean(company.booksConnectedAt || company.dataUploadedAt || company.connected);
}

export function billableCompanyCount(companies: readonly SlotCompany[]): number {
  return companies.filter(countsTowardCompanySlot).length;
}

/** Soft plan note. Null when the group is inside the included 3. No Stripe change. */
export function companyCountBanner(billable: number, included = INCLUDED_COMPANIES): string | null {
  if (billable <= included) return null;
  const extra = billable - included;
  const noun = extra === 1 ? "company" : "companies";
  return `This group has ${billable} companies on the plan count. The plan includes ${included}. ${extra} extra ${noun} will use a client slot. Billing is not changed yet.`;
}

/** Hide every group control while the group is a single company. */
export function groupChromeVisible(companyCount: number): boolean {
  return companyCount > 1;
}

/**
 * One new group id per existing client. Callers persist the ids; the helper
 * only proves the backfill shape: every client is grouped, and none share.
 */
export function backfillGroupOfOne(clientIds: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  clientIds.forEach((id, index) => {
    const trimmed = id.trim();
    if (!trimmed) return;
    out.set(trimmed, `group-${index + 1}-${trimmed}`);
  });
  return out;
}

export function backfillSharesAGroup(groups: ReadonlyMap<string, string>): boolean {
  const seen = new Set<string>();
  for (const groupId of groups.values()) {
    if (seen.has(groupId)) return true;
    seen.add(groupId);
  }
  return false;
}

export type CompanyAccessInput = {
  userId: string;
  entityType: string | null;
  personUserId: string | null;
  /** owner_user_id, practice assignment, direct membership, or Milōn IT. */
  direct: boolean;
  /** Owner login on this company's group. */
  groupOwner: boolean;
  hasMembership: boolean;
};

/**
 * Mirrors can_access_company. An Individual is not opened by group membership
 * alone: the firm path is `direct`, and the person is personUserId or a membership.
 */
export function canAccessCompany(input: CompanyAccessInput): boolean {
  if (input.direct) return true;
  if (!input.groupOwner) return false;
  if (input.entityType !== "individual") return true;
  if (input.personUserId && input.personUserId === input.userId) return true;
  return input.hasMembership;
}

export type MoveMembershipPlan = {
  revoke: string[];
  grant: string[];
};

/**
 * Memberships removed and added when a company changes group.
 * The person on an Individual keeps their seat. Destination owners gain a
 * seat except on an Individual they do not belong to.
 */
export function membershipsAfterMove(input: {
  fromOwnerIds: readonly string[];
  toOwnerIds: readonly string[];
  personUserId: string | null;
  entityType: string | null;
}): MoveMembershipPlan {
  const to = new Set(input.toOwnerIds);
  const revoke = [...new Set(input.fromOwnerIds)].filter(
    (userId) => !to.has(userId) && userId !== input.personUserId,
  );
  const grant = [...new Set(input.toOwnerIds)].filter(
    (userId) => input.entityType !== "individual" || userId === input.personUserId,
  );
  return { revoke, grant };
}

export type AccessPerson = { userId: string; label?: string | null };

function personLabel(person: AccessPerson): string {
  const label = person.label?.trim();
  if (label) return label;
  const tail = person.userId.replace(/-/g, "").slice(-4);
  return tail ? `Owner login ·${tail}` : "Owner login";
}

export function accessConfirmLines(input: {
  companyName: string;
  gains: readonly AccessPerson[];
  losses: readonly AccessPerson[];
  firmKeepsAccess: boolean;
}): { gains: string[]; losses: string[] } {
  const name = input.companyName.trim() || "this company";
  const gains =
    input.gains.length > 0
      ? input.gains.map((person) => `${personLabel(person)} gains access to ${name}.`)
      : ["No new owner login gains access."];
  const losses = input.losses.map((person) => `${personLabel(person)} loses access to ${name}.`);
  if (input.firmKeepsAccess) losses.push("The firm keeps this file.");
  return { gains, losses };
}

export type SyncSnapshot = {
  syncStatus: string | null;
  syncError: string | null;
  lastSyncedAt: string | null;
};

export type ConnectionHealth = {
  label: "Not connected" | "Connected" | "Needs attention";
  lastSync: string | null;
};

/** Connection health for one company. No amounts. */
export function connectionHealth(rows: readonly SyncSnapshot[]): ConnectionHealth {
  if (rows.length === 0) return { label: "Not connected", lastSync: null };
  const needsAttention = rows.some((row) => {
    if (row.syncError?.trim()) return true;
    return /error|fail/i.test(row.syncStatus ?? "");
  });
  const lastSync =
    rows
      .map((row) => row.lastSyncedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  return { label: needsAttention ? "Needs attention" : "Connected", lastSync };
}

export function openWorkLabel(openQueries: number | null | undefined): string {
  const count = openQueries ?? 0;
  if (count <= 0) return "None";
  return count === 1 ? "1 open" : `${count} open`;
}
