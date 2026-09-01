/** Deep link from Lighthouse / email into a pinned note on the customer profile. */

export const LIGHTHOUSE_IT_INBOX_PATH = "/ops?tab=it";

export function clientNoteProfilePath(clientId: string, noteId: string, tab?: string): string {
  const params = new URLSearchParams({ note: noteId });
  if (tab && tab.trim()) params.set("tab", tab.trim());
  return `/clients/${clientId}?${params.toString()}`;
}

export function clientNoteProfileUrl(
  origin: string,
  clientId: string,
  noteId: string,
  tab?: string,
): string {
  const base = origin.replace(/\/$/, "") || "https://milon.co.za";
  return `${base}${clientNoteProfilePath(clientId, noteId, tab)}`;
}

export function lighthouseItInboxUrl(origin: string): string {
  const base = origin.replace(/\/$/, "") || "https://milon.co.za";
  return `${base}${LIGHTHOUSE_IT_INBOX_PATH}`;
}

/** True when a post-login `next` should open Lighthouse (`/ops` or `/ops?tab=it`). */
export function isOpsNext(next: string | undefined): boolean {
  if (!next) return false;
  return next === "/ops" || next.startsWith("/ops?");
}

export function lighthouseTabFromOpsNext(next: string | undefined): string | undefined {
  if (!next || !next.startsWith("/ops")) return undefined;
  try {
    return new URL(next, "https://milon.invalid").searchParams.get("tab") ?? undefined;
  } catch {
    return undefined;
  }
}
