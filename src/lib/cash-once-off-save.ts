/**
 * Once-off forecast rows stay out of the silent autosave until the accountant
 * presses Save. Other lines keep saving on their own.
 */

export type OnceOffLine = {
  id: string;
  frequency: string;
};

export function onceOffLines<T extends OnceOffLine>(lines: readonly T[]): T[] {
  return lines.filter((line) => line.frequency === "once-off");
}

/**
 * Silent save keeps the last saved once-off rows and the current other rows.
 * A row that was saved as once-off stays on that saved copy until Save, even
 * if its frequency has been changed locally.
 */
export function linesForSilentSave<T extends OnceOffLine>(
  current: readonly T[],
  savedOnceOff: readonly T[],
): T[] {
  const savedById = new Map(savedOnceOff.map((line) => [line.id, line]));
  const used = new Set<string>();
  const out: T[] = [];
  for (const line of current) {
    const saved = savedById.get(line.id);
    if (saved || line.frequency === "once-off") {
      if (!saved) continue;
      out.push(saved);
      used.add(line.id);
      continue;
    }
    out.push(line);
  }
  for (const saved of savedOnceOff) {
    if (!used.has(saved.id)) out.push(saved);
  }
  return out;
}

export function onceOffDirty<T extends OnceOffLine>(
  current: readonly T[],
  savedOnceOff: readonly T[],
): boolean {
  return JSON.stringify(linesForSilentSave(current, savedOnceOff)) !== JSON.stringify(current);
}

export function silentForecastKey<T extends OnceOffLine>(input: {
  startDate: string;
  openingBalance: string;
  revenue: readonly T[];
  expenses: readonly T[];
  other: readonly T[];
  savedRevenue: readonly T[];
  savedExpenses: readonly T[];
  savedOther: readonly T[];
}): string {
  return JSON.stringify({
    startDate: input.startDate,
    openingBalance: input.openingBalance,
    revenue: linesForSilentSave(input.revenue, input.savedRevenue),
    expenses: linesForSilentSave(input.expenses, input.savedExpenses),
    other: linesForSilentSave(input.other, input.savedOther),
  });
}
