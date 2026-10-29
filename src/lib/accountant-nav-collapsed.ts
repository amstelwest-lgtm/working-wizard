/** Laptop rail: full 232px column or a 56px icon strip. Phones keep the drawer. */
export const NAV_COLLAPSED_KEY = "milon.accountantNav.collapsed";
/** Set on <html> before first paint so the grid does not jump on load. */
export const NAV_COLLAPSED_ATTR = "data-accountant-nav";
export const NAV_COLLAPSED_EVENT = "milon-accountant-nav-collapsed";

export const NAV_COLLAPSED_BOOT_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(
  NAV_COLLAPSED_KEY,
)})==="1")document.documentElement.setAttribute(${JSON.stringify(NAV_COLLAPSED_ATTR)},"collapsed");}catch(e){}})();`;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readNavCollapsed(storage: StorageLike | null): boolean {
  try {
    return storage?.getItem(NAV_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeNavCollapsed(storage: StorageLike | null, collapsed: boolean): void {
  try {
    if (collapsed) storage?.setItem(NAV_COLLAPSED_KEY, "1");
    else storage?.removeItem(NAV_COLLAPSED_KEY);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

/** `[` toggles the rail, except while typing or with a modifier held. */
export function isNavToggleKey(event: {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  target?: EventTarget | null;
}): boolean {
  if (event.key !== "[" || event.altKey || event.ctrlKey || event.metaKey) return false;
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!target) return true;
  if (target.isContentEditable) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT";
}
