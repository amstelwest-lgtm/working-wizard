import { useRef, type KeyboardEvent } from "react";
import { PROFIT_PAGED_LABEL, profitMenuViews, type ProfitPagedView } from "@/lib/profit-paged-view";

/** Same block menu as the cash forecast. */
export function ProfitPagedMenu({
  value,
  onChange,
  includeLines = true,
  auditCount = 0,
}: {
  value: ProfitPagedView;
  onChange: (view: ProfitPagedView) => void;
  includeLines?: boolean;
  /** Inputs still waiting for approval. Zero hides the badge. */
  auditCount?: number;
}) {
  const views = profitMenuViews(includeLines);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const safeValue = views.includes(value) ? value : views[0]!;

  const select = (index: number) => {
    const view = views[index];
    if (!view) return;
    onChange(view);
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Math.max(0, views.indexOf(safeValue));
    const last = views.length - 1;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      select(current === last ? 0 : current + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      select(current === 0 ? last : current - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      select(0);
    } else if (event.key === "End") {
      event.preventDefault();
      select(last);
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Profit"
      className="cash-menu"
      data-profit-menu=""
      onKeyDown={onKeyDown}
    >
      {views.map((view, index) => {
        const on = view === safeValue;
        return (
          <button
            key={view}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`profit-menu-${view}`}
            aria-selected={on}
            aria-controls={`profit-pane-${view}`}
            tabIndex={on ? 0 : -1}
            className="cash-menu__tab"
            data-profit-menu-tab={view}
            onClick={() => onChange(view)}
          >
            {PROFIT_PAGED_LABEL[view]}
            {view === "audit" && auditCount > 0 ? (
              <span
                className="cash-menu__badge"
                data-profit-audit-badge=""
                aria-label={`${auditCount} to approve`}
              >
                {auditCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
