/**
 * Add-client cap gate for the create server function.
 * The stored firm plan and the client count are independent. They run together.
 * Live Stripe (loadFirmClientCreateAllowance) runs only when those rows cannot
 * prove the firm is still under the tightest cap.
 */

import { LEGACY_FREE_STARTER_CLIENT_LIMIT } from "@/lib/stripe-plans";

/**
 * Tightest published cap: legacy $0 Starter. Trial and paid Starter are 5.
 * A count under this number cannot exceed any band, including that legacy price.
 */
export const TIGHTEST_FIRM_CLIENT_CAP = LEGACY_FREE_STARTER_CLIENT_LIMIT;

export type StoredCreateEntitlement = {
  /** firms.billing_plan_known. Null until a live check has written it. */
  plan: "entitled" | "none" | null;
  /**
   * firms.starter_trial_generation_blocked.
   * False means a billing sync wrote "not blocked". Null has never been written.
   * True means the trial-ended gate is on.
   */
  trialBlocked: boolean | null;
};

export type LiveCreateCap = {
  allowed: boolean;
  message?: string;
};

export type CreateCapDecision =
  | { allowed: true; source: "stored" | "live" }
  | { allowed: false; source: "live"; message: string };

/**
 * Stored rows may replace the live Stripe cap check only when they cannot
 * let the firm over a cap.
 * - `entitled` is a confirmed plan. `none` and null are not: a missing plan
 *   still has to be read from Stripe, and a stored "none" can be a capped plan
 *   that has not been written yet.
 * - The trial mirror must be an explicit false. Null is unsynced. True is the
 *   trial-ended block (no new clients), which the live check must confirm.
 * - The count must be under the tightest cap. At that cap or above, the band
 *   is not on the row, so Stripe still decides.
 */
export function storedEntitlementSkipsLiveCap(input: {
  stored: StoredCreateEntitlement | null;
  clientCount: number | null;
}): boolean {
  const stored = input.stored;
  const count = input.clientCount;
  if (!stored || stored.plan !== "entitled") return false;
  if (stored.trialBlocked !== false) return false;
  if (count == null || !Number.isFinite(count) || count < 0) return false;
  return count < TIGHTEST_FIRM_CLIENT_CAP;
}

async function settled<T>(work: Promise<T>): Promise<T | null> {
  try {
    return await work;
  } catch {
    return null;
  }
}

/**
 * Reads the stored plan and the client count at the same time.
 * A read that throws is "not fresh" and falls through to live Stripe.
 * Live Stripe is not started until those reads finish, and it is not started
 * when the stored rows already allow the create.
 */
export async function resolveFirmClientCreateGate(input: {
  readStoredEntitlement: () => Promise<StoredCreateEntitlement | null>;
  countClients: () => Promise<number | null>;
  loadLiveAllowance: () => Promise<LiveCreateCap>;
}): Promise<CreateCapDecision> {
  const [stored, clientCount] = await Promise.all([
    settled(input.readStoredEntitlement()),
    settled(input.countClients()),
  ]);
  if (storedEntitlementSkipsLiveCap({ stored, clientCount })) {
    return { allowed: true, source: "stored" };
  }
  const live = await input.loadLiveAllowance();
  if (!live.allowed) {
    const message = live.message?.trim() || "Could not add this client";
    return { allowed: false, source: "live", message };
  }
  return { allowed: true, source: "live" };
}

/** Cap gate, then the create RPC. The RPC does not start while the gate is in flight. */
export async function runFirmClientCreate<T>(input: {
  readStoredEntitlement: () => Promise<StoredCreateEntitlement | null>;
  countClients: () => Promise<number | null>;
  loadLiveAllowance: () => Promise<LiveCreateCap>;
  createClient: () => Promise<T>;
}): Promise<T> {
  const decision = await resolveFirmClientCreateGate(input);
  if (!decision.allowed) {
    throw new Error(decision.message);
  }
  return input.createClient();
}
