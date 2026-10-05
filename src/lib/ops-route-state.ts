/**
 * Render decision for /ops.
 * The owner dashboard is required only for platform metrics and pilot knobs.
 * The default Lighthouse view (and agent / firms / system) must render the
 * shell without it — a missing dashboard there used to return null and leave
 * a blank page.
 */

export const OPS_IT_PANES = ["it", "access", "pilot"] as const;
export type OpsItPane = (typeof OPS_IT_PANES)[number];
export type OpsConsoleView = "lighthouse" | "it" | "platform";

export type OpsAccessSnapshot = {
  allowed: boolean;
  isOwner: boolean;
  isItMember: boolean;
};

/** Screens the /ops route can show. Never null — a blank page is not a state. */
export type OpsRouteRenderDecision = "loading" | "restricted" | "locked" | "error" | "render shell";

export type OpsRouteState = {
  authLoading: boolean;
  signedIn: boolean;
  unlocked: boolean;
  accessChecked: boolean;
  access: OpsAccessSnapshot | null;
  /** Validated `?tab=` value. Undefined is the default Lighthouse view. */
  tab?: string;
  hasDash: boolean;
  /** True while the owner-dashboard request is in flight. */
  dashBusy: boolean;
  /** Owner-dashboard load failed. */
  dashErr: boolean;
};

export function isOpsItPane(raw: string | undefined): raw is OpsItPane {
  return Boolean(raw && (OPS_IT_PANES as readonly string[]).includes(raw));
}

export function opsItOnly(access: OpsAccessSnapshot | null): boolean {
  return Boolean(access?.isItMember && !access?.isOwner);
}

export function opsConsoleView(tab: string | undefined, itOnly: boolean): OpsConsoleView {
  if (itOnly || isOpsItPane(tab)) return "it";
  if (tab === "usage") return "platform";
  return "lighthouse";
}

export function opsItPane(tab: string | undefined, itOnly: boolean): OpsItPane {
  if (itOnly && tab === "pilot") return "it";
  return isOpsItPane(tab) ? tab : "it";
}

/** True only when the open view reads the owner dashboard. */
export function opsNeedsDashboard(
  itOnly: boolean,
  view: OpsConsoleView,
  itPane: OpsItPane,
): boolean {
  return !itOnly && (view === "platform" || (view === "it" && itPane === "pilot"));
}

/** Inverse of `opsNeedsDashboard`. Lighthouse always skips the dashboard. */
export function opsSkipsDashboard(
  itOnly: boolean,
  view: OpsConsoleView,
  itPane: OpsItPane,
): boolean {
  return !opsNeedsDashboard(itOnly, view, itPane);
}

/**
 * Which screen /ops should render.
 * A view that needs the dashboard shows the loading spinner until it arrives,
 * or the error card if the load failed. Every other unlocked, allowed view
 * renders the shell even when `dash` is null.
 */
export function opsRouteRenderDecision(state: OpsRouteState): OpsRouteRenderDecision {
  const itOnly = opsItOnly(state.access);
  const view = opsConsoleView(state.tab, itOnly);
  const itPane = opsItPane(state.tab, itOnly);
  const needsDash = opsNeedsDashboard(itOnly, view, itPane);

  if (state.authLoading) return "loading";
  if (state.signedIn && !state.accessChecked) return "loading";

  // getOpsAccess threw — access stays null. Do not paint an empty shell.
  if (state.signedIn && state.accessChecked && state.access === null) return "error";

  if (state.accessChecked && state.access && !state.access.allowed && !state.unlocked) {
    return "restricted";
  }

  if (!state.unlocked) return "locked";

  if (needsDash && !state.hasDash) {
    // In flight, or not started yet: spinner. A finished failure is the error card.
    if (state.dashErr && !state.dashBusy) return "error";
    return "loading";
  }

  return "render shell";
}
