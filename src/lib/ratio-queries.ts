import { RATIO_NAME_TO_KEY } from "./health-score";
import { playbookKeyForUiKey } from "./playbook-key";

/** Canonical playbook/UI key so aliases (inventoryDays ↔ wipDays) match. */
export function ratioQueryCanon(key: string): string {
  return playbookKeyForUiKey(key);
}

export function noteBelongsToRatio(
  noteKey: string | null | undefined,
  ratioKey: string,
): boolean {
  if (!noteKey || !ratioKey) return false;
  return ratioQueryCanon(noteKey) === ratioQueryCanon(ratioKey);
}

export function ratioQueryLabel(key: string): string {
  const canon = ratioQueryCanon(key);
  for (const [name, ui] of Object.entries(RATIO_NAME_TO_KEY)) {
    if (ui === key || ui === canon || ratioQueryCanon(ui) === canon) return name;
  }
  return key;
}

export function countOpenRatioQueries(
  notes: Array<{ ratioKey?: string | null; resolved?: boolean }>,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const n of notes) {
    if (n.resolved || !n.ratioKey) continue;
    const ui = n.ratioKey;
    const canon = ratioQueryCanon(ui);
    map[ui] = (map[ui] ?? 0) + 1;
    if (canon !== ui) map[canon] = (map[canon] ?? 0) + 1;
  }
  return map;
}

export function openQueryCountForRatio(
  counts: Record<string, number>,
  ratioNameOrKey: string,
): number {
  const ui = RATIO_NAME_TO_KEY[ratioNameOrKey] ?? ratioNameOrKey;
  return counts[ui] ?? counts[ratioQueryCanon(ui)] ?? counts[ratioNameOrKey] ?? 0;
}
