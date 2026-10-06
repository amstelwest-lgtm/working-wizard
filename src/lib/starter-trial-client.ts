/**
 * Session memory of a trial-ended firm. Dashboard and Settings already load
 * this from billing. Generate pack and Bot create read it so they can refuse
 * without waiting on another Stripe round trip.
 */

const STORAGE_KEY = "milon.starterTrialGenerationBlocked";

type Remembered = { firmId?: string; blocked?: boolean };

function readRemembered(): Remembered | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Remembered;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function rememberStarterTrialGenerationBlocked(firmId: string, blocked: boolean): void {
  if (!firmId || typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ firmId, blocked }));
}

/**
 * True only when this session already learned the firm is trial-ended.
 * Unknown (never loaded) is false — the server check still runs.
 * Pass firmId when the caller has one; a mismatch does not block.
 */
export function knownStarterTrialGenerationBlocked(firmId?: string | null): boolean {
  const parsed = readRemembered();
  if (!parsed || parsed.blocked !== true) return false;
  if (firmId && parsed.firmId && parsed.firmId !== firmId) return false;
  return true;
}
