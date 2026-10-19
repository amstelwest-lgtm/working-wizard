/** Placeholder while the saved region is still in flight. No country, no state, no save. */
export function RegionSettingsLoading() {
  return (
    <div data-region-loading="" aria-busy="true" aria-live="polite">
      <p className="text-sm text-[var(--ink-dim)]">Loading saved region…</p>
    </div>
  );
}
