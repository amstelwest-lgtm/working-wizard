/** A note with no page position is stored at the origin. It stays in the tray. */
export function noteShowsFloatingPin(note: {
  x: number;
  y: number;
  ratioKey?: string | null;
}): boolean {
  if (note.ratioKey) return false;
  if (!Number.isFinite(note.x) || !Number.isFinite(note.y)) return false;
  if (Math.abs(note.x) < 1 && Math.abs(note.y) < 1) return false;
  return true;
}
