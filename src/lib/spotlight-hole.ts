/**
 * The practice tour draws a spotlight, then a full-viewport click catcher
 * under it. The spotlight is `pointer-events: none`, so a click on the lit
 * feature used to hit the catcher and do nothing (the Open queries tile
 * stayed on /dashboard). These blockers are the catcher with the lit
 * rectangles removed.
 */

export type SpotBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type ViewportBox = {
  width: number;
  height: number;
};

/** Id of the firm-home Open queries tile. The dashboard tour keeps it clickable. */
export const OPEN_QUERIES_TILE_ID = "wizard-dash-open-queries";

export function boxContains(box: SpotBox, x: number, y: number): boolean {
  return x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height;
}

function subtractOne(block: SpotBox, hole: SpotBox): SpotBox[] {
  const x1 = Math.max(block.left, hole.left);
  const y1 = Math.max(block.top, hole.top);
  const x2 = Math.min(block.left + block.width, hole.left + hole.width);
  const y2 = Math.min(block.top + block.height, hole.top + hole.height);
  if (x2 <= x1 || y2 <= y1) return [block];
  const parts: SpotBox[] = [];
  if (y1 > block.top) {
    parts.push({ top: block.top, left: block.left, width: block.width, height: y1 - block.top });
  }
  if (y2 < block.top + block.height) {
    parts.push({
      top: y2,
      left: block.left,
      width: block.width,
      height: block.top + block.height - y2,
    });
  }
  if (x1 > block.left) {
    parts.push({ top: y1, left: block.left, width: x1 - block.left, height: y2 - y1 });
  }
  if (x2 < block.left + block.width) {
    parts.push({
      top: y1,
      left: x2,
      width: block.left + block.width - x2,
      height: y2 - y1,
    });
  }
  return parts;
}

/** Viewport rectangles that should swallow clicks. `holes` stay clickable. */
export function spotlightClickBlockers(
  holes: readonly SpotBox[],
  viewport: ViewportBox,
): SpotBox[] {
  if (viewport.width <= 0 || viewport.height <= 0) return [];
  let blocks: SpotBox[] = [{ top: 0, left: 0, width: viewport.width, height: viewport.height }];
  for (const hole of holes) {
    if (hole.width <= 0 || hole.height <= 0) continue;
    blocks = blocks.flatMap((block) => subtractOne(block, hole));
  }
  return blocks.filter((block) => block.width > 0 && block.height > 0);
}
