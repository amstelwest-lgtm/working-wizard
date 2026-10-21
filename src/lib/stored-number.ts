/**
 * PostgREST `numeric` columns arrive as strings ("63"). Number() plus a
 * finite check. An empty string is missing, not zero.
 */
export function storedFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) return direct;
  const stripped = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(stripped) ? stripped : null;
}
