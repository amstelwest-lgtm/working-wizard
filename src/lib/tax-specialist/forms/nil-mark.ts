/**
 * An accountant marks the blank lines on one schedule as nil.
 * It is never applied on its own. Blank stays blank until they click.
 */
export const NIL_CONFIRMED_NOTE = "Nil confirmed by accountant";

export type NilMark = {
  /** Lines this click set from blank to 0. Undo puts these back to blank. */
  keys: string[];
};

export function nilMarkFrom(value: unknown): NilMark | null {
  if (!value || typeof value !== "object") return null;
  const keys = (value as { keys?: unknown }).keys;
  if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string")) return null;
  return { keys: [...keys] };
}

export function rememberNilKey(mark: NilMark | null | undefined, key: string): string[] {
  const keys = mark?.keys ?? [];
  return keys.includes(key) ? [...keys] : [...keys, key];
}
