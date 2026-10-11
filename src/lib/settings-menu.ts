export type MenuMove = "next" | "prev" | "first" | "last";

/** Next index for a menu. `current` is -1 when nothing inside the menu is focused. */
export function moveMenuIndex(current: number, count: number, move: MenuMove): number {
  if (count <= 0) return 0;
  if (move === "first") return 0;
  if (move === "last") return count - 1;
  if (move === "next") return (Math.max(current, -1) + 1) % count;
  const start = current < 0 ? 0 : current;
  return (start - 1 + count) % count;
}

export function menuIndexForKey(current: number, count: number, key: string): number | null {
  if (key === "ArrowDown") return moveMenuIndex(current, count, "next");
  if (key === "ArrowUp") return moveMenuIndex(current, count, "prev");
  if (key === "Home") return moveMenuIndex(current, count, "first");
  if (key === "End") return moveMenuIndex(current, count, "last");
  return null;
}
