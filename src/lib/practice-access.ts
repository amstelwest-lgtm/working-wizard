/** Practice team roles and per-client access classifications. */

export const PRACTICE_CLIENT_ACCESS_CAP = 12;
export const PRACTICE_ACCESS_MIGRATION = "20260901160000_practice_client_access.sql";
export const PRACTICE_ACCESS_AMENDMENT_MIGRATION =
  "20260913120000_team_access_amendment.sql";
export const PARTNER_ASSIGN_TOOLTIP = "Only a partner can assign partner status.";

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

/** Shown on the Firm permissions dropdown. */
export const FIRM_PERMISSION_HELP: Record<"admin" | "member", string> = {
  member: "Works on assigned clients only",
  admin: "Can invite people and assign client access",
};

export const CLASSIFICATION_HELP =
  "Only partners can sign off client deliverables.";

/** Seniority: Partner > Manager > Reviewer > Staff = Bookkeeper > Read only. */
export const CLASS_RANK: Record<PracticeClassification, number> = {
  partner: 5,
  manager: 4,
  reviewer: 3,
  staff: 2,
  bookkeeper: 2,
  read_only: 1,
};

export type PracticeCapability = "view" | "edit" | "submit" | "review" | "sign_off";

export function canPractice(
  classification: PracticeClassification | null | undefined,
  cap: PracticeCapability,
): boolean {
  if (!classification) return false;
  switch (cap) {
    case "view":
      return true;
    case "edit":
    case "submit":
      return (
        classification === "partner" ||
        classification === "manager" ||
        classification === "staff" ||
        classification === "bookkeeper"
      );
    case "review":
      return (
        classification === "partner" ||
        classification === "manager" ||
        classification === "reviewer"
      );
    case "sign_off":
      return classification === "partner";
    default:
      return false;
  }
}

export function classAtMost(
  ceiling: PracticeClassification,
  wanted: PracticeClassification,
): PracticeClassification {
  return CLASS_RANK[wanted] <= CLASS_RANK[ceiling] ? wanted : ceiling;
}

export function effectiveClassification(
  team: PracticeClassification,
  perClient: PracticeClassification | null | undefined,
): PracticeClassification {
  return classAtMost(team, perClient ?? team);
}

export function classesAtOrBelow(ceiling: PracticeClassification): PracticeClassification[] {
  return CLASSIFICATIONS.filter((c) => CLASS_RANK[c] <= CLASS_RANK[ceiling]);
}

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
