/** Practice team roles and per-client access classifications. */

export const PRACTICE_CLIENT_ACCESS_CAP = 12;
export const PRACTICE_ACCESS_MIGRATION = "20260901160000_practice_client_access.sql";

export const MEMBERSHIP_ROLES = ["owner", "admin", "member"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const CLASSIFICATIONS = [
  "partner",
  "manager",
  "staff",
  "bookkeeper",
  "reviewer",
  "read_only",
] as const;
export type PracticeClassification = (typeof CLASSIFICATIONS)[number];

export const ACCESS_STATUSES = ["pending", "active", "revoked", "declined"] as const;
export type PracticeAccessStatus = (typeof ACCESS_STATUSES)[number];

export const CLASSIFICATION_LABELS: Record<PracticeClassification, string> = {
  partner: "Partner",
  manager: "Manager",
  staff: "Staff",
  bookkeeper: "Bookkeeper",
  reviewer: "Reviewer",
  read_only: "Read only",
};

export const MEMBERSHIP_LABELS: Record<MembershipRole, string> = {
  owner: "Practice owner",
  admin: "Firm admin",
  member: "Team member",
};

export function parseClassification(raw: unknown): PracticeClassification {
  return CLASSIFICATIONS.includes(raw as PracticeClassification)
    ? (raw as PracticeClassification)
    : "staff";
}

export function parseMembershipRole(raw: unknown): MembershipRole {
  return MEMBERSHIP_ROLES.includes(raw as MembershipRole) ? (raw as MembershipRole) : "member";
}

export function isManagerRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function accessTokenFromNext(next: string | undefined): string | undefined {
  if (!next) return undefined;
  const m = next.match(/^\/access\/([A-Za-z0-9]+)/);
  return m?.[1];
}
