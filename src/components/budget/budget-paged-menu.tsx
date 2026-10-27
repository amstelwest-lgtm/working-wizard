import { useRef, type KeyboardEvent } from "react";
import {
  BUDGET_PAGED_LABEL,
  BUDGET_PAGED_VIEWS,
  type BudgetPagedView,
} from "@/lib/budget-paged-view";

/** Same block menu as the cash forecast. Accountant budget only. */
export function BudgetPagedMenu({
  value,
  onChange,
}: {
  value: BudgetPagedView;
  onChange: (view: BudgetPagedView) => void;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number) => {
    const view = BUDGET_PAGED_VIEWS[index];
    if (!view) return;
    onChange(view);
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Math.max(0, BUDGET_PAGED_VIEWS.indexOf(value));
    const last = BUDGET_PAGED_VIEWS.length - 1;
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
      aria-label="Budget"
      className="cash-menu"
      data-budget-menu=""
      onKeyDown={onKeyDown}
    >
      {BUDGET_PAGED_VIEWS.map((view, index) => {
        const on = view === value;
        return (
          <button
            key={view}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`budget-menu-${view}`}
            aria-selected={on}
            aria-controls={`budget-pane-${view}`}
            tabIndex={on ? 0 : -1}
            className="cash-menu__tab"
            data-budget-menu-tab={view}
            onClick={() => onChange(view)}
          >
            {BUDGET_PAGED_LABEL[view]}
          </button>
        );
      })}
    </div>
  );
}
