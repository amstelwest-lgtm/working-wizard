/** How often an open tab compares its build id with /version.json. */
export const STALE_BUNDLE_POLL_MS = 10 * 60 * 1000;

export const STALE_BUNDLE_READY = "A new version of Milōn is ready";
export const STALE_BUNDLE_RELOAD = "Reload";

/** Visible bar copy. Reload is a button; nothing calls location.reload on its own. */
export const STALE_BUNDLE_BAR_TEXT = `${STALE_BUNDLE_READY} · ${STALE_BUNDLE_RELOAD}`;

/**
 * True when /version.json names a different build than the one running.
 * A missing file, a blank id, or the same id leaves the tab alone.
 */
export function remoteBuildIsNewer(currentBuildId: string, body: unknown): boolean {
  const current = currentBuildId.trim();
  if (!current) return false;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const remote = (body as { buildId?: unknown }).buildId;
  if (typeof remote !== "string") return false;
  const next = remote.trim();
  if (!next) return false;
  return next !== current;
}
