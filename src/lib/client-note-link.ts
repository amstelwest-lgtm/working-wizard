/** Deep link from Lighthouse / email into a pinned note on the customer profile. */

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
