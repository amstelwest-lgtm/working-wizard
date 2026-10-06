/**
 * Who is left out of the founder instrument, platform metrics, and Milōn IT lists.
 * Pure. Callers pass the internal email list (owner allowlist, IT members, founder emails).
 * Cohort percentages still come from the SQL views, which already drop firms.is_internal.
 */

export type InstrumentSubject = {
  name?: string | null;
  email?: string | null;
  ownerEmail?: string | null;
  isInternal?: boolean | null;
  isTest?: boolean | null;
  isDemo?: boolean | null;
  isBot?: boolean | null;
};

export type ExclusionContext = {
  internalEmails?: readonly string[];
};

export type ExclusionReason =
  | "flag"
  | "known-e2e"
  | "known-team"
  | "name"
  | "placeholder"
  | "email";

/** Exact rule, in the order a row is tested. The PR body lists this. */
export const INSTRUMENT_EXCLUSION_RULES = [
  "Flag: firms.is_internal, clients.is_demo, an analytics is_bot stamp, or is_test when the row has that field. There is no is_test column today; it is honored if one appears.",
  "Known E2E account: the name folds to Ben Accountants.",
  "Known team firm: the name folds to “the milon team” or contains “milon team” (Milōn included).",
  "Name contains the word “test”, the word “qa”, or the word “smoke”, or contains “e2e” or “delete me”, after accents are folded and case is ignored.",
  "Placeholder: the name is “My practice” when the owner email is missing, or that email is internal or test.",
  "Email: the profile or owner address is on the list passed in (platform-owner allowlist, milon_it_members, analytics founder emails), the mailbox looks like test/qa/e2e/“delete me”, or the domain is milonfinance.com, milon.it, trymilon.com, or trymilon.co.za.",
] as const;

const INTERNAL_DOMAINS = new Set(["milonfinance.com", "milon.it", "trymilon.com", "trymilon.co.za"]);

export function foldInstrumentText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function mergeInternalEmails(...lists: Array<readonly string[] | undefined>): string[] {
  const set = new Set<string>();
  for (const list of lists) {
    for (const raw of list ?? []) {
      const email = raw.trim().toLowerCase();
      if (email) set.add(email);
    }
  }
  return [...set];
}

function emailSet(ctx?: ExclusionContext): Set<string> {
  return new Set((ctx?.internalEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
}

export function emailIsInternalOrTest(
  email: string | null | undefined,
  ctx?: ExclusionContext,
): boolean {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return false;
  if (emailSet(ctx).has(normalized)) return true;
  const [local, domain = ""] = normalized.split("@");
  if (INTERNAL_DOMAINS.has(domain) || domain.endsWith(".milonfinance.com")) return true;
  const localWords = local.replace(/[._+-]+/g, " ");
  if (/\b(test|qa|e2e)\b/.test(localWords)) return true;
  if (local.includes("deleteme") || local.includes("delete-me") || local.includes("delete_me")) {
    return true;
  }
  return false;
}

function nameReason(folded: string): ExclusionReason | null {
  if (!folded) return null;
  if (folded === "ben accountants" || folded.startsWith("ben accountants ")) return "known-e2e";
  if (folded === "the milon team" || folded === "milon team" || folded.includes("milon team")) {
    return "known-team";
  }
  if (folded.includes("delete me") || folded.includes("e2e")) return "name";
  if (/(^| )(?:test|qa|smoke)( |$)/.test(folded)) return "name";
  return null;
}

function isPlaceholder(folded: string, ownerEmail: string | null | undefined, ctx?: ExclusionContext): boolean {
  if (folded !== "my practice" && !folded.startsWith("my practice ")) return false;
  const owner = (ownerEmail ?? "").trim();
  if (!owner) return true;
  return emailIsInternalOrTest(owner, ctx);
}

export function exclusionReason(
  subject: InstrumentSubject,
  ctx?: ExclusionContext,
): ExclusionReason | null {
  if (subject.isInternal || subject.isTest || subject.isDemo || subject.isBot) return "flag";
  const folded = foldInstrumentText(subject.name);
  const named = nameReason(folded);
  if (named) return named;
  if (isPlaceholder(folded, subject.ownerEmail ?? subject.email, ctx)) return "placeholder";
  if (emailIsInternalOrTest(subject.email, ctx) || emailIsInternalOrTest(subject.ownerEmail, ctx)) {
    return "email";
  }
  return null;
}

export function isExcludedFromInstrument(
  subject: InstrumentSubject,
  ctx?: ExclusionContext,
): boolean {
  return exclusionReason(subject, ctx) != null;
}

export function realFirmCount(firms: readonly InstrumentSubject[], ctx?: ExclusionContext): number {
  return firms.filter((firm) => !isExcludedFromInstrument(firm, ctx)).length;
}
