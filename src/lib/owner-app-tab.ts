/**
 * Owner door tabs live on `/app?tab=`. Home is `/app` with no tab.
 * Legacy board links (`today`, `waterfall`, `next`, `tasks`) stay on the
 * older board. Cash and budget are the owner door.
 */
import { OWNER_BOARD_TABS } from "@/lib/next-step";

export const OWNER_DOOR_TABS = ["home", "health", "cash", "profit", "budget", "moves", "accountant"] as const;

export type OwnerDoorTab = (typeof OWNER_DOOR_TABS)[number];

const LEGACY_BOARD_TABS = new Set(["today", "waterfall", "next", "tasks"]);

export type OwnerAppSearch = {
  tab?: string;
  screen?: "settings" | "accountant" | "plan";
  section?: "signed";
  bot?: string;
};

export function isLegacyOwnerBoardTab(tab: string | null | undefined): boolean {
  return Boolean(tab && LEGACY_BOARD_TABS.has(tab));
}

/** Tabs `/app` keeps in the URL. Door tabs and the older board tabs. */
export function isOwnerAppTab(tab: string): boolean {
  return (
    (OWNER_BOARD_TABS as readonly string[]).includes(tab) ||
    (OWNER_DOOR_TABS as readonly string[]).includes(tab)
  );
}

/** Screen the owner door should show for this search. Legacy board tabs are not opened here. */
export function ownerDoorScreen(search: {
  tab?: string | null;
  screen?: string | null;
  bot?: string | null;
}): "home" | "chat" | "health" | "cash" | "profit" | "budget" | "moves" | "accountant" | "plan" | "settings" {
  if (search.bot) return "chat";
  if (search.screen === "settings" || search.tab === "settings") return "settings";
  if (search.screen === "plan" || search.tab === "plan") return "plan";
  if (search.screen === "accountant" || search.tab === "accountant") return "accountant";
  const tab = search.tab ?? "";
  if (tab === "health" || tab === "cash" || tab === "profit" || tab === "budget" || tab === "moves") {
    return tab;
  }
  return "home";
}

/** Next search for a door screen. Push this onto history so Back restores the previous tab. */
export function ownerDoorSearch<T>(prev: T, screen: string): T {
  const next = { ...prev } as T & OwnerAppSearch;
  delete next.bot;
  if (screen === "settings") {
    delete next.section;
    next.screen = "settings";
    return next as T;
  }
  if (screen === "plan") {
    delete next.section;
    next.screen = "plan";
    return next as T;
  }
  if (screen === "accountant" || screen === "deliverables") {
    delete next.screen;
    next.tab = "accountant";
    if (screen === "deliverables") next.section = "signed";
    else delete next.section;
    return next as T;
  }
  delete next.screen;
  delete next.section;
  if (screen === "home" || screen === "chat" || screen === "first") {
    delete next.tab;
    return next as T;
  }
  next.tab = screen;
  return next as T;
}
