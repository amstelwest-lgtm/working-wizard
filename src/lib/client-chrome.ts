/**
 * Accountant client chrome (header, Overview, Client Brain).
 *
 * One primary next action. On Overview that primary is the Next Step card,
 * which paints its own control. Strips around it stay secondary. On Client
 * Brain the hero's primary is "Propose from brain". Header shortcuts are
 * navigation, not a second primary.
 */

export type ChromeRole = "primary" | "secondary";

export function portalButtonClass(role: ChromeRole, mini = true): string {
  const size = mini ? " mini" : "";
  return role === "primary" ? `btn gold${size}` : `btn ghost${size}`;
}

/** Top-bar shortcut. Gold is reserved for the workspace's one next action. */
export function headerShortcutClass(): string {
  return "tb-btn";
}

const GOLD_ASK =
  "inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-[#f3d98a] via-[#d4a550] to-[#b7872a] px-2.5 py-1.5 text-[12px] font-bold text-[#1b1300] disabled:opacity-50";

const QUIET_ASK =
  "inline-flex items-center gap-1.5 rounded-lg border border-[#b7872a]/40 px-2.5 py-1.5 text-[12px] font-semibold text-[#7a5a0e] disabled:opacity-50 dark:text-[#f1d28b]";

/**
 * Tracked-ask actions under Next Step. The owner board keeps the gold pill.
 * The accountant Overview already has a Next Step primary, so these stay quiet.
 */
export function trackedAskClass(audience: "owner" | "accountant"): string {
  return audience === "accountant" ? QUIET_ASK : GOLD_ASK;
}
