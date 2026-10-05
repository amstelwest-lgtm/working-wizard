/**
 * Pilot knobs stored on milon_ops_settings.feature_flags.
 * A flag is Live only when product code reads that key to gate behavior.
 * The ops console itself only stores and displays them, which is not a gate.
 * Audited 2026-10-05: none of these keys are read outside owner-ops storage.
 */

export const PILOT_FLAG_KEYS = [
  "maintenance_mode",
  "signup_open",
  "ask_ai_enabled",
  "qbo_enabled",
  "landing_waitlist_orbit",
  "show_pricing",
] as const;

export type PilotFlagKey = (typeof PILOT_FLAG_KEYS)[number];

const LIVE_FLAGS = new Set<string>([]);

export function pilotFlagWiring(key: string): "Live" | "Not wired yet" {
  return LIVE_FLAGS.has(key) ? "Live" : "Not wired yet";
}
