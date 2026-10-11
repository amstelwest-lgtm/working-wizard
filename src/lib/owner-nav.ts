/**
 * Owner door navigation.
 * Accountant studio URLs (`/clients/...`) keep Deliverables.
 * Old owner /deliverables paths and deliverable section params open Accountant portal.
 */

const OWNER_BOARD_TABS = new Set(["today", "waterfall", "cash", "budget", "next", "tasks"]);

/** Sections that used to live on the owner Deliverables tab. `plan` only counts with that tab. */
const DELIVERABLE_SECTIONS = new Set([
  "reports",
  "pack",
  "drafter",
  "advisory",
  "signed",
  "deliverables",
]);

const KEPT_PARAMS = ["qbo", "xero", "reason", "view", "bot", "bots"] as const;

export const OWNER_ACCOUNTANT_PORTAL = "Accountant portal";
export const OWNER_SIGNED_SECTION_ID = "owner-signed-deliverables";

function cleanPath(pathname: string): string {
  const trimmed = pathname.trim() || "/";
  if (trimmed.length > 1 && trimmed.endsWith("/")) return trimmed.slice(0, -1);
  return trimmed;
}

export function canonicalOwnerScreen<T extends string>(screen: T): T | "accountant" {
  return screen === "deliverables" ? "accountant" : screen;
}

/** True when this owner URL should land on Accountant portal. Accountant client URLs return false. */
export function isOwnerDeliverablesRequest(input: {
  pathname?: string | null;
  screen?: string | null;
  tab?: string | null;
  section?: string | null;
}): boolean {
  const path = cleanPath(input.pathname ?? "/app");
  if (path.startsWith("/clients")) return false;

  const screen = (input.screen ?? "").trim();
  const tab = (input.tab ?? "").trim();
  const section = (input.section ?? "").trim();

  if (path === "/deliverables" || path === "/app/deliverables") return true;
  if (path !== "/app") return false;
  if (screen === "deliverables" || tab === "deliverables") return true;

  const sectionIsDeliverable =
    DELIVERABLE_SECTIONS.has(section) ||
    (section === "plan" && (screen === "deliverables" || tab === "deliverables"));
  if (!sectionIsDeliverable) return false;
  if (screen === "accountant" && section === "signed" && tab !== "deliverables") return false;
  if (screen === "settings") return false;
  if (tab && OWNER_BOARD_TABS.has(tab)) return false;
  if (screen && screen !== "deliverables" && screen !== "accountant") return false;
  return true;
}

/** Path + search for the redirect, or null when the URL should stay. */
export function ownerDeliverablesRedirectTarget(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const screen = url.searchParams.get("screen");
  const tab = url.searchParams.get("tab");
  const section = url.searchParams.get("section");
  if (
    !isOwnerDeliverablesRequest({
      pathname: url.pathname,
      screen,
      tab,
      section,
    })
  ) {
    return null;
  }

  const next = new URL(url.origin);
  next.pathname = "/app";
  for (const key of KEPT_PARAMS) {
    const value = url.searchParams.get(key);
    if (value) next.searchParams.set(key, value);
  }
  next.searchParams.set("screen", "accountant");
  next.searchParams.set("section", "signed");
  return `${next.pathname}${next.search}`;
}
