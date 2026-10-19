/**
 * Scrolling the content area may move a highlight. It must not change the route.
 * A hashchange after load is what turned a scroll into Cash flow > Who to pay
 * or Health > Score. Only the first load may apply a legacy fragment.
 */
export function shouldNavigateForHashChange(input: {
  phase: "load" | "hashchange";
  scrolling: boolean;
}): boolean {
  if (input.scrolling) return false;
  if (input.phase === "hashchange") return false;
  return true;
}
