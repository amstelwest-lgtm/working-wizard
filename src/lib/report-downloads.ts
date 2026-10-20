/**
 * One download per report. A second report can start while the first is
 * still rendering. The same report does not start twice.
 */

export function startReportDownload(
  pending: ReadonlySet<string>,
  key: string,
): { pending: ReadonlySet<string>; started: boolean } {
  if (pending.has(key)) return { pending, started: false };
  const next = new Set(pending);
  next.add(key);
  return { pending: next, started: true };
}

export function finishReportDownload(
  pending: ReadonlySet<string>,
  key: string,
): ReadonlySet<string> {
  if (!pending.has(key)) return pending;
  const next = new Set(pending);
  next.delete(key);
  return next;
}
