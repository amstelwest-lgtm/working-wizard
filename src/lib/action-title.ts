const DEBT_GUIDANCE = /target a d\/e below 1/i;

/** Stored guidance and lowercase titles render as an action title. */
export function actionDisplayTitle(title: string | null | undefined): string {
  const text = (title ?? "").trim();
  if (!text) return "";
  if (DEBT_GUIDANCE.test(text)) return "Bring debt-to-equity under the target";
  const first = text.charAt(0);
  if (first >= "a" && first <= "z") return first.toUpperCase() + text.slice(1);
  return text;
}

/** One row per displayed title. "Target a D/E below 1×" is the debt-to-equity action. */
export function dedupeActionTitles(titles: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of titles) {
    const title = actionDisplayTitle(raw);
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}
