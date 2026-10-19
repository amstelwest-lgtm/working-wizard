/** Open a practice section the rail linked to, then bring it into view. */
export function revealPracticeHash(hash: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const id = (hash ?? "").replace(/^#/, "");
  if (!id) return;
  const el = document.getElementById(id);
  if (!el) return;
  const details = el instanceof HTMLDetailsElement ? el : el.querySelector("details");
  if (details instanceof HTMLDetailsElement) details.open = true;
  el.scrollIntoView({ block: "start" });
}
