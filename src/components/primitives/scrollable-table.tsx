import * as React from "react";
import { cn } from "@/lib/utils";

export type ScrollableTableProps = {
  children: React.ReactNode;
  className?: string;
  viewportClassName?: string;
  /** Swipe hint copy; pass false to hide */
  hint?: string | false;
  /** Right-edge fade while content overflows horizontally */
  fadeEdge?: boolean;
  /** Collapse rows to cards at ≤640px (requires data-label on td cells) */
  cardRows?: boolean;
};

export function ScrollableTable({
  children,
  className,
  viewportClassName,
  hint = "Swipe sideways to see more →",
  fadeEdge = true,
  cardRows = false,
}: ScrollableTableProps) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = React.useState(false);
  const [canScroll, setCanScroll] = React.useState(false);

  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const update = () => {
      const scrollable = el.scrollWidth > el.clientWidth + 2;
      setCanScroll(scrollable);
      setAtEnd(!scrollable || el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [children]);

  const showHint = hint !== false && canScroll && !cardRows;
  const showFade = fadeEdge && canScroll && !atEnd && !cardRows;

  return (
    <div
      className={cn(
        "milon-scroll-table",
        cardRows && "milon-scroll-table--cards",
        showFade && "milon-scroll-table--fade",
        className,
      )}
    >
      {showHint ? <p className="milon-scroll-table__hint">{hint}</p> : null}
      <div ref={viewportRef} className={cn("milon-scroll-table__viewport", viewportClassName)}>
        {children}
      </div>
    </div>
  );
}
