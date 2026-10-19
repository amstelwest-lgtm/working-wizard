/**
 * Last painted All clients list, kept only for a known user and firm.
 * A null firm is not a key. An empty list is a real result.
 * Only adding a client invalidates the book today. Removing or
 * archiving a client does not.
 */

const paintedBooks = new Map<string, readonly unknown[]>();

function practiceBookCacheKey(userId: string, firmId: string): string {
  return `${userId}:${firmId}`;
}

export function readPaintedBook<T>(
  userId: string | undefined,
  firmId: string | null,
): T[] | null {
  if (!userId || !firmId) return null;
  const hit = paintedBooks.get(practiceBookCacheKey(userId, firmId));
  if (!hit) return null;
  return hit as T[];
}

export function rememberPaintedBook(
  userId: string | undefined,
  firmId: string | null,
  rows: readonly unknown[],
): void {
  if (!userId || !firmId) return;
  paintedBooks.set(practiceBookCacheKey(userId, firmId), rows.slice());
}

export function forgetPaintedBook(userId: string | undefined, firmId: string | null): void {
  if (!userId || !firmId) return;
  paintedBooks.delete(practiceBookCacheKey(userId, firmId));
}
