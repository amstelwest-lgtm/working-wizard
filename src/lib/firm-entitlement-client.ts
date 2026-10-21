/**
 * One entitlement read per user for this tab.
 * A paid result lasts a minute. An unpaid result lasts a few seconds, so a
 * card that just went through is not bounced for the rest of the minute.
 * The billing gate and the post-insight card share the in-flight read.
 *
 * The fresh slot expires. The last successful result for this user and firm
 * stays for the tab, so a later timeout does not forget a live Starter plan.
 */

export type CachedFirmEntitlement = {
  entitled: boolean;
  reason?: string;
  checkFailed?: "timeout" | "network" | "http_5xx";
  /** Present when this read also carried the plan line. A later open reuses it. */
  plan?: {
    configured?: boolean;
    phase?: string;
    band?: string | null;
  } | null;
  /** Present when this read also carried the add-client allowance. */
  allowance?: {
    allowed: boolean;
    canEndTrial?: boolean;
    code?: string;
    message?: string;
    upgrade?: { phase?: string; band?: string | null } | null;
    starterTrial?: { expired?: boolean; cardFree?: boolean };
  } | null;
};

export const FIRM_ENTITLEMENT_TTL_MS = 60_000;
export const FIRM_ENTITLEMENT_NEGATIVE_TTL_MS = 5_000;

type Slot = {
  at: number;
  userId: string;
  firmId: string | null;
  value: CachedFirmEntitlement;
};

let cached: Slot | null = null;
let lastKnown: Slot | null = null;
let inflightUser: string | null = null;
let inflightFirm: string | null = null;
let inflight: Promise<CachedFirmEntitlement> | null = null;

function ttlFor(value: CachedFirmEntitlement): number {
  return value.entitled ? FIRM_ENTITLEMENT_TTL_MS : FIRM_ENTITLEMENT_NEGATIVE_TTL_MS;
}

function firmKey(firmId?: string | null): string {
  return firmId?.trim() ?? "";
}

/** A result is only that firm. A missing id matches only another missing id. */
function sameFirm(slot: Slot | null, userId: string, firmId?: string | null): slot is Slot {
  if (!slot || slot.userId !== userId) return false;
  const id = firmKey(firmId);
  const slotId = slot.firmId?.trim() ?? "";
  if (!id || !slotId) return id === slotId;
  return slotId === id;
}

/** An entitled slot is only that firm. A missing firm id does not cover another firm. */
function entitledSlotMatches(slot: Slot | null, userId: string, firmId?: string | null): boolean {
  return Boolean(
    slot &&
      slot.userId === userId &&
      slot.value.entitled === true &&
      firmId &&
      slot.firmId &&
      slot.firmId === firmId,
  );
}

function fresh(userId: string, firmId?: string | null): boolean {
  if (!cached || cached.userId !== userId) return false;
  if (cached.value.entitled && !entitledSlotMatches(cached, userId, firmId)) return false;
  return sameFirm(cached, userId, firmId) && Date.now() - cached.at < ttlFor(cached.value);
}

function sameInflight(userId: string, firmId?: string | null): boolean {
  if (!inflight || inflightUser !== userId) return false;
  const id = firmKey(firmId);
  const current = inflightFirm ?? "";
  if (!id || !current) return id === current;
  return current === id;
}

function liveFailure(value: CachedFirmEntitlement): boolean {
  return value.reason === "stripe_error" || Boolean(value.checkFailed);
}

/**
 * Gate, Start here, and the practice allowance share this read.
 * One server call per firm for the tab. The load runs once.
 */
export function readFirmBillingOpen<T extends CachedFirmEntitlement>(
  userId: string,
  load: (input: { data: { refresh?: boolean } }) => Promise<T>,
  refresh = false,
  firmId?: string | null,
): Promise<T> {
  return readCachedFirmEntitlement(userId, load, refresh, firmId);
}

export function readCachedFirmEntitlement<T extends CachedFirmEntitlement>(
  userId: string,
  load: (input: { data: { refresh?: boolean } }) => Promise<T>,
  refresh = false,
  firmId?: string | null,
): Promise<T> {
  if (!refresh && fresh(userId, firmId)) {
    return Promise.resolve(cached!.value as T);
  }
  // Retry and the quiet recheck wait on the read that is already running.
  if (sameInflight(userId, firmId)) return inflight as Promise<T>;
  const pending = load({ data: refresh ? { refresh: true } : {} }).then(
    (value) => {
      noteFirmEntitlement(userId, value, firmId);
      if (inflightUser === userId && inflightFirm === (firmKey(firmId) || null)) {
        inflight = null;
        inflightUser = null;
        inflightFirm = null;
      }
      return value;
    },
    (err: unknown) => {
      if (inflightUser === userId && inflightFirm === (firmKey(firmId) || null)) {
        inflight = null;
        inflightUser = null;
        inflightFirm = null;
      }
      throw err;
    },
  );
  inflightUser = userId;
  inflightFirm = firmKey(firmId) || null;
  inflight = pending;
  return pending;
}

/**
 * Last successful entitlement for this user and firm, including after the
 * fresh TTL. A failed read does not replace it.
 */
export function lastKnownFirmEntitlement(
  userId: string,
  firmId?: string | null,
): CachedFirmEntitlement | null {
  if (!lastKnown || lastKnown.userId !== userId) return null;
  if (lastKnown.value.entitled) {
    return entitledSlotMatches(lastKnown, userId, firmId) ? lastKnown.value : null;
  }
  if (!sameFirm(lastKnown, userId, firmId)) return null;
  return lastKnown.value;
}

/**
 * Last success only when it was stored for this firm id.
 * A missing id, or another firm's id, is not a plan we can open.
 */
export function lastKnownEntitlementForFirm(
  userId: string,
  firmId: string | null | undefined,
): CachedFirmEntitlement | null {
  const id = firmId?.trim() ?? "";
  if (!userId || !id || !lastKnown || lastKnown.userId !== userId || lastKnown.firmId !== id) {
    return null;
  }
  return lastKnown.value;
}

/** A refresh that learned the firm is paid replaces any unpaid tab result. */
export function noteFirmEntitlement(
  userId: string,
  value: CachedFirmEntitlement,
  firmId?: string | null,
): void {
  if (!userId) return;
  // Unknown is not a result. Leave the previous success in place.
  if (value.reason === "stripe_error") return;
  const id = firmKey(firmId);
  // A missing firm id is not another firm's plan, and it must not erase one.
  if (!id && lastKnown && lastKnown.userId === userId && lastKnown.firmId) return;
  // A failed recheck must not downgrade a firm this tab already knows is entitled.
  if (value.checkFailed && !value.entitled && entitledSlotMatches(lastKnown, userId, id)) {
    return;
  }
  const slot: Slot = {
    at: Date.now(),
    userId,
    firmId: id,
    value: {
      entitled: value.entitled === true,
      reason: value.reason,
      plan: value.plan,
      allowance: value.allowance,
    },
  };
  if (!liveFailure(value)) {
    cached = slot;
  }
  lastKnown = slot;
}

export function clearCachedFirmEntitlement(): void {
  cached = null;
  lastKnown = null;
  inflight = null;
  inflightUser = null;
  inflightFirm = null;
}

/** Drop the settled plan. The in-flight read stays, so Retry can apply it. */
export function releaseFirmEntitlementForRetry(): void {
  cached = null;
  lastKnown = null;
}
