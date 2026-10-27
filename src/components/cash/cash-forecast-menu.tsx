import { useRef, type KeyboardEvent } from "react";
import { CASH_PAGED_LABEL, CASH_PAGED_VIEWS, type CashPagedView } from "@/lib/cash-paged-view";

export function CashForecastMenu({
  value,
  onChange,
  auditCount = 0,
}: {
  value: CashPagedView;
  onChange: (view: CashPagedView) => void;
  /** Inputs still waiting for approval. Zero hides the badge. */
  auditCount?: number;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number) => {
    const view = CASH_PAGED_VIEWS[index];
    if (!view) return;
    onChange(view);
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Math.max(0, CASH_PAGED_VIEWS.indexOf(value));
    const last = CASH_PAGED_VIEWS.length - 1;
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
      aria-label="Cash forecast"
      className="cash-menu"
      data-cash-menu=""
      onKeyDown={onKeyDown}
    >
      {CASH_PAGED_VIEWS.map((view, index) => {
        const on = view === value;
        return (
          <button
            key={view}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`cash-menu-${view}`}
            aria-selected={on}
            aria-controls={`cash-pane-${view}`}
            tabIndex={on ? 0 : -1}
            className="cash-menu__tab"
            data-cash-menu-tab={view}
            onClick={() => onChange(view)}
          >
            {CASH_PAGED_LABEL[view]}
            {view === "audit" && auditCount > 0 ? (
              <span
                className="cash-menu__badge"
                data-cash-audit-badge=""
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
