/**
 * One [card-timing] line per reload of the accountant client file.
 * ms is the settled Financial Manager line. warmMs is set only when the
 * standby painted a cached line first. No ids.
 */

const RELOAD_MARK = "client-reload";
const WARM_MARK = "client-warm-line";
const CARD_MARK = "client-card-text";

let cardTimingLogged = false;

function performanceMarks(): Performance | null {
  try {
    if (typeof performance === "undefined" || typeof performance.mark !== "function") return null;
    if (typeof performance.getEntriesByName !== "function") return null;
    return performance;
  } catch {
    return null;
  }
}

/** A settled sentence. The standby's checking and error lines are not it. */
export function isRealCardLine(line: string | null | undefined): boolean {
  const text = (line ?? "").trim();
  if (!text) return false;
  if (text === "Checking…") return false;
  if (text.startsWith("Couldn't load")) return false;
  return true;
}

function markOnce(name: string): void {
  const marks = performanceMarks();
  if (!marks || marks.getEntriesByName(name).length > 0) return;
  marks.mark(name);
}

/** Client view mounted. Once per page load. */
export function markClientReload(): void {
  markOnce(RELOAD_MARK);
}

/** The standby painted a cached Financial Manager line. Once per page load. */
export function markWarmCardLine(): void {
  markOnce(WARM_MARK);
}

/**
 * The settled home committed a real Financial Manager line.
 * Logs once. warmMs is omitted when the cache did not paint.
 */
export function markClientCardText(line: string | null | undefined): void {
  if (cardTimingLogged || !isRealCardLine(line)) return;
  const marks = performanceMarks();
  if (!marks) return;
  markOnce(CARD_MARK);
  const content = marks.getEntriesByName(CARD_MARK)[0];
  if (!content) return;
  cardTimingLogged = true;
  const warm = marks.getEntriesByName(WARM_MARK)[0];
  const payload: { ms: number; warmMs?: number } = {
    ms: Math.max(0, Math.round(content.startTime)),
  };
  if (warm) payload.warmMs = Math.max(0, Math.round(warm.startTime));
  console.info("[card-timing]", payload);
}

export function resetCardTimingForTests(): void {
  cardTimingLogged = false;
  const marks = performanceMarks();
  marks?.clearMarks?.(RELOAD_MARK);
  marks?.clearMarks?.(WARM_MARK);
  marks?.clearMarks?.(CARD_MARK);
}
