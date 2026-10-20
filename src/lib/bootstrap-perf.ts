/**
 * Cold-load marks. Dev logs the duration so a regression shows up in the console.
 * Production still records the measure; it does not print.
 */

const START = "milon:bootstrap:start";

function devConsole(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

export function beginBootstrap(): void {
  if (typeof performance === "undefined") return;
  if (performance.getEntriesByName(START).length > 0) return;
  performance.mark(START);
}

/** Measure from the first auth-ready mark to `name`. Logged only in dev. */
export function measureBootstrap(name: string): void {
  if (typeof performance === "undefined") return;
  beginBootstrap();
  const end = `milon:bootstrap:${name}`;
  if (performance.getEntriesByName(end).length > 0) return;
  performance.mark(end);
  const measureName = `bootstrap:${name}`;
  try {
    performance.measure(measureName, START, end);
  } catch {
    return;
  }
  if (!devConsole()) return;
  const entry = performance.getEntriesByName(measureName).at(-1);
  if (entry) console.info(`[bootstrap] ${measureName} ${Math.round(entry.duration)}ms`);
}
