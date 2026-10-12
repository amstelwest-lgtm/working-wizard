/**
 * Open and closed groups on the accountant rail.
 * Team, Numbers, Work, and File (and Team and Book on the practice rail)
 * keep whatever the accountant set. Navigation never closes a group.
 */

/** Heading ids that are open. A missing id is closed. */
export type NavOpenState = Readonly<Record<string, true>>;

/** Client rail: headings under Team, Numbers, Work, and File. */
export const CLIENT_NAV_OPEN_KEY = "milon.nav.open.client";

/** Practice rail: headings under Team and Book. */
export const PRACTICE_NAV_OPEN_KEY = "milon.nav.open.practice";

export function parseNavOpen(raw: string | null): NavOpenState {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const out: Record<string, true> = {};
  for (const [id, value] of Object.entries(parsed)) {
    if (value === true && id.length > 0) out[id] = true;
  }
  return out;
}

export function navOpenEqual(a: NavOpenState, b: NavOpenState): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((id) => b[id] === true);
}

/** Chevron: open or close this group and leave every other group alone. */
export function toggleNavOpen(open: NavOpenState, id: string): NavOpenState {
  if (open[id]) {
    const next: Record<string, true> = { ...open };
    delete next[id];
    return next;
  }
  return { ...open, [id]: true };
}

/** Close one group. Other groups stay as they are. */
export function closeNavGroup(open: NavOpenState, id: string): NavOpenState {
  if (!open[id]) return open;
  const next: Record<string, true> = { ...open };
  delete next[id];
  return next;
}

/**
 * Arrival on a heading highlights it and opens that group when it is closed.
 * Groups the accountant already opened stay open.
 */
export function openNavGroup(open: NavOpenState, headingId: string | null): NavOpenState {
  if (!headingId || open[headingId]) return open;
  return { ...open, [headingId]: true };
}

export function readNavOpen(storage: Storage | null | undefined, key: string): NavOpenState {
  if (!storage || !key) return {};
  try {
    return parseNavOpen(storage.getItem(key));
  } catch {
    return {};
  }
}

export function writeNavOpen(storage: Storage | null | undefined, key: string, open: NavOpenState) {
  if (!storage || !key) return;
  try {
    storage.setItem(key, JSON.stringify(open));
  } catch {
    // Private mode and blocked storage leave the in-memory groups as they are.
  }
}
