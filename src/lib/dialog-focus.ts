/**
 * Minimal focus trap for the hand-rolled upload drawer (not a Radix dialog).
 * Returns the index Tab should move to. -1 only when the dialog has nothing
 * focusable — the caller always prevents the browser from moving focus itself,
 * which is what was letting Tab leave the drawer.
 */
export function focusTrapTabIndex(count: number, activeIndex: number, shift: boolean): number {
  if (count <= 0) return -1;
  if (activeIndex < 0) return shift ? count - 1 : 0;
  const next = shift ? activeIndex - 1 : activeIndex + 1;
  if (next < 0) return count - 1;
  if (next >= count) return 0;
  return next;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function listFocusable(root: ParentNode): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(FOCUSABLE);
  const out: HTMLElement[] = [];
  for (const el of nodes) {
    if (el.getAttribute("aria-hidden") === "true") continue;
    if (el.closest("[aria-hidden='true'], [hidden]")) continue;
    if (el.getClientRects().length === 0) continue;
    out.push(el);
  }
  return out;
}
