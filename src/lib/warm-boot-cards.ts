/**
 * Last Financial Manager line for one client, so a warm reload can paint
 * it before the client row returns. A different client does not reuse it.
 */

const memory = new Map<string, string>();

function storageKey(clientId: string): string {
  return `milon-warm-boot-card:${clientId}`;
}

export function rememberWarmBootCard(clientId: string, line: string): void {
  const text = line.replace(/\s+/g, " ").trim();
  if (!clientId || !text) return;
  if (text === "Checking…" || text.startsWith("Couldn't load")) return;
  memory.set(clientId, text);
  try {
    sessionStorage.setItem(storageKey(clientId), text);
  } catch {
    // Private mode still has the in-memory line for this page.
  }
}

export function readWarmBootCard(clientId: string | null | undefined): string | null {
  if (!clientId) return null;
  try {
    const stored = sessionStorage.getItem(storageKey(clientId));
    const text = stored?.replace(/\s+/g, " ").trim() ?? "";
    if (text) {
      memory.set(clientId, text);
      return text;
    }
  } catch {
    // sessionStorage can be blocked. The in-memory line still covers this page.
  }
  return memory.get(clientId) ?? null;
}

export function clearWarmBootCardsForTests(): void {
  memory.clear();
}
