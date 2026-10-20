/**
 * Post-auth routing and the deadline around it.
 *
 * Password sign-in used to await supabase.auth.getUser() inside
 * loadSignInRoleSnapshot even after the password grant had already returned
 * the user. That call takes the GoTrue lock. A parallel firm hydrate
 * (AccountantProfileProvider) queues more lock work, and for a dual-role
 * account the promise never settles: the network GET /user is 200, the
 * button stays on "Signing in…".
 *
 * A firm row is the accountant door. signup_type "customer" with no
 * firm_name, client_owner memberships, and a null or US firm market do not
 * change that. An unread firm is not "no firm" — that used to look like the
 * old auto-grant and send this account to the owner board.
 */
import { settleWithin } from "@/lib/bounded-load";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";
import { destinationAfterSignIn, type LandingSignInRoles } from "@/lib/landing-sign-in-destination";
import { decidePostLoginPath } from "@/lib/user-roles";

/** Same clock as the practice shell. The sign-in button may not outlast it. */
export const POST_AUTH_DEADLINE_MS = SHELL_GATE_TIMEOUT_MS;

export const POST_AUTH_TIMEOUT_MESSAGE =
  "Sign-in is taking too long. Retry to open your workspace.";

export type FirmMarketCountry = "ZA" | "US" | null;

export type FirmReadResult =
  | { ok: true; count: number; marketCountry: FirmMarketCountry }
  | { ok: false };

export type PostAuthGo = { status: "go"; path: string };
export type PostAuthStop = PostAuthGo | { status: "retry" };

/**
 * Accountant door once the firm read has finished.
 * A positive firm count is /practice for every market, including null and US.
 */
export function accountantDoorWhenFirmsLoaded(input: {
  firmCount: number;
  marketCountry: FirmMarketCountry;
  practiceSignup: boolean;
  hasPracticeRole: boolean;
  hasClientRole: boolean;
}): "/practice" | "/app" {
  if (input.firmCount > 0) return "/practice";
  const snapshot: LandingSignInRoles = {
    hasPracticeRole: input.hasPracticeRole,
    hasClientRole: input.hasClientRole,
    hasFirm: false,
    practiceSignup: input.practiceSignup,
    profileLoaded: true,
  };
  const path = destinationAfterSignIn(snapshot, "accountant");
  return path === "/app" ? "/app" : "/practice";
}

/**
 * Owner door stays available for the same account. The one-shot owner force
 * opens /app; the accountant door opened /practice above.
 */
export function ownerDoorForDualRoleFirm(): "/dashboard" | "/app" {
  return decidePostLoginPath({
    hasPracticeRole: true,
    hasClientRole: true,
    hasFirm: true,
    practiceSignup: false,
    intent: "owner",
    force: "owner",
  });
}

/**
 * Run the accountant post-auth reads. A known firm returns /practice without
 * calling `whenNoFirm` (that path is getUser / entitlement / ensure).
 * A hung read becomes retry instead of an infinite spinner.
 */
export async function finishAccountantSignIn(input: {
  flow: "signin" | "signup";
  practiceSignup: boolean;
  hasPracticeRole: boolean;
  hasClientRole: boolean;
  readFirms: () => Promise<FirmReadResult>;
  /**
   * Firm read finished empty, or a brand-new signup must still consider
   * Checkout. May itself hang — still inside the deadline.
   */
  whenNoFirm: () => Promise<string>;
  /** False only when a new firm signup still has to open Checkout. */
  firmRowWins?: boolean;
  timeoutMs?: number;
}): Promise<PostAuthStop> {
  const timeoutMs = input.timeoutMs ?? POST_AUTH_DEADLINE_MS;
  const settled = await settleWithin(
    (async (): Promise<string> => {
      const firms = await input.readFirms();
      if (!firms.ok) {
        // Failed read is not an empty book. Customer metadata must not win.
        // A client_owner seat with no practice evidence stays unresolved (retry),
        // not the owner board.
        if (
          input.hasClientRole &&
          !input.hasPracticeRole &&
          !input.practiceSignup &&
          input.flow !== "signup"
        ) {
          throw new Error("firm-read-unknown");
        }
        if (input.practiceSignup || input.flow === "signup" || input.hasPracticeRole) {
          return "/practice";
        }
        throw new Error("firm-read-unknown");
      }
      // Firm row wins over signup_type customer, client_owner seats, and market.
      if (firms.count > 0 && input.firmRowWins !== false) return "/practice";
      return input.whenNoFirm();
    })(),
    timeoutMs,
  );
  if (settled.status !== "value") return { status: "retry" };
  return { status: "go", path: settled.value };
}

/** Owner sign-in and owner signup. A hung destination read retries. */
export async function finishOwnerSignIn(input: {
  readDestination: () => Promise<string>;
  timeoutMs?: number;
}): Promise<PostAuthStop> {
  const settled = await settleWithin(
    input.readDestination(),
    input.timeoutMs ?? POST_AUTH_DEADLINE_MS,
  );
  if (settled.status !== "value") return { status: "retry" };
  return { status: "go", path: settled.value };
}

export type HeldFirm = { id: string; ownerUserId: string };

/**
 * Sign-out → sign-in in the same tab. The profile provider only re-runs when
 * the user id changes. Drop the previous account's firms immediately so a
 * timed-out hydrate cannot keep them (or an empty list) as this user's book.
 */
export function firmsAfterAccountChange(input: {
  previousUserId: string | null;
  nextUserId: string | null;
  firms: readonly HeldFirm[];
}): HeldFirm[] {
  if (input.previousUserId === input.nextUserId) return [...input.firms];
  return [];
}

/** The 8s firm timeout did not commit rows. Do not keep the previous hold. */
export function firmsAfterLoadTimeout(input: { committed: boolean; firms: readonly HeldFirm[] }): HeldFirm[] {
  if (input.committed) return [...input.firms];
  return [];
}
