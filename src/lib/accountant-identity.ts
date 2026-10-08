/**
 * Persisted accountant identity. Firm and person names come from the database.
 * A local draft never overrides them, and a sample/demo persona is not a greeting.
 */

import { isSamplePracticeSignoff } from "./review-signoff-stamp.ts";

export type PersistedNameChain = {
  profileFullName: string;
  authFullName: string;
};

function trimmed(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** Skip the demo persona. A real profile name is kept even if it looks similar. */
function withoutSamplePersona(value: string): string {
  if (!value) return "";
  if (isSamplePracticeSignoff({ name: value })) return "";
  return value;
}

export function authDisplayName(meta: { full_name?: unknown; name?: unknown } | null | undefined): string {
  const full = typeof meta?.full_name === "string" ? meta.full_name.trim() : "";
  if (full) return full;
  return typeof meta?.name === "string" ? meta.name.trim() : "";
}

/**
 * firms.name, then brand_contact_name, then profiles.full_name, then auth metadata.
 * Cached drafts are not an input.
 */
export function resolvePersistedAccountantIdentity(input: {
  firmName?: string | null;
  brandContactName?: string | null;
  profileFullName?: string | null;
  authFullName?: string | null;
}): { firmName: string; accountantName: string } {
  const firmName = trimmed(input.firmName);
  const accountantName =
    trimmed(input.brandContactName) ||
    trimmed(input.profileFullName) ||
    withoutSamplePersona(trimmed(input.authFullName));
  return { firmName, accountantName };
}

/**
 * Greeting source. The persisted name chain wins. The email local-part is only
 * used when every name in that chain is blank. A cached "A. Sample" is skipped.
 */
export function practiceGreetingName(input: {
  accountantName?: string | null;
  profileFullName?: string | null;
  authFullName?: string | null;
  email?: string | null;
}): string {
  const named =
    withoutSamplePersona(trimmed(input.accountantName)) ||
    trimmed(input.profileFullName) ||
    withoutSamplePersona(trimmed(input.authFullName));
  if (named) return named;
  const local = trimmed((input.email ?? "").split("@")[0]);
  return local;
}

/** Signer line stored on a sign-off. Profile full name, then auth metadata, then email. */
export function persistedSignerName(input: {
  profileFullName?: string | null;
  authFullName?: string | null;
  authName?: string | null;
  email?: string | null;
}): string | null {
  const profile = trimmed(input.profileFullName);
  if (profile) return profile;
  const authFull = withoutSamplePersona(trimmed(input.authFullName));
  if (authFull) return authFull;
  const authName = withoutSamplePersona(trimmed(input.authName));
  if (authName) return authName;
  const local = trimmed((input.email ?? "").split("@")[0]);
  return local || null;
}

/**
 * Firm printed on a sign-off. The client's firm row wins.
 * `requestedFirmName` is the value the dialog sent and is ignored.
 */
export function persistedSignoffFirmName(input: {
  clientFirmName?: string | null;
  requestedFirmName?: string | null;
}): string | null {
  void input.requestedFirmName;
  const name = trimmed(input.clientFirmName);
  return name || null;
}

export type RecordedActor = {
  name: string;
  firmName: string | null;
};

/**
 * Person and firm to print for a pack actor. Profile full name wins, then
 * auth metadata, then the email local-part. A sample persona is skipped so
 * it cannot stand in for a real signer, and a sample firm is not printed.
 */
export function recordedActorIdentity(input: {
  profileFullName?: string | null;
  authFullName?: string | null;
  authName?: string | null;
  email?: string | null;
  clientFirmName?: string | null;
}): RecordedActor | null {
  const firmName = persistedSignoffFirmName({ clientFirmName: input.clientFirmName });
  const profile = trimmed(input.profileFullName);
  const profileOk = profile && !isSamplePracticeSignoff({ name: profile, firmName });
  const name = profileOk
    ? profile
    : persistedSignerName({
        profileFullName: null,
        authFullName: input.authFullName,
        authName: input.authName,
        email: input.email,
      });
  if (!name || isSamplePracticeSignoff({ name, firmName })) return null;
  return { name, firmName };
}
