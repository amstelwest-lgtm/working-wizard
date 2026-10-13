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

const NON_TEXT_INPUTS = new Set([
  "button",
  "submit",
  "reset",
  "checkbox",
  "radio",
  "file",
  "range",
  "color",
  "image",
  "hidden",
]);

/** Email, password, textarea, and contenteditable fields. Buttons are not fields. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  return !NON_TEXT_INPUTS.has((target as HTMLInputElement).type);
}

/**
 * Overlay key handlers may close on Escape and move focus on Tab.
 * Letters, numbers, and Space stay in the field.
 */
export function overlayMayHandleKey(event: { key: string; target: EventTarget | null }): boolean {
  if (!isTextEntry(event.target)) return true;
  return event.key === "Escape" || event.key === "Tab";
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
