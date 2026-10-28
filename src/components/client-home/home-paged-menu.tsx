import { useRef, type KeyboardEvent } from "react";
import { HOME_PAGED_LABEL, HOME_PAGED_VIEWS, type HomePagedView } from "@/lib/home-paged-view";

/** Same block menu as the cash forecast and budget. Accountant client Home only. */
export function HomePagedMenu({
  value,
  onChange,
  attentionCount = 0,
}: {
  value: HomePagedView;
  onChange: (view: HomePagedView) => void;
  /** Rows on Needs attention. Zero hides the badge. */
  attentionCount?: number;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number) => {
    const view = HOME_PAGED_VIEWS[index];
    if (!view) return;
    onChange(view);
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Math.max(0, HOME_PAGED_VIEWS.indexOf(value));
    const last = HOME_PAGED_VIEWS.length - 1;
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
      aria-label="Client home"
      className="cash-menu"
      data-home-menu=""
      onKeyDown={onKeyDown}
    >
      {HOME_PAGED_VIEWS.map((view, index) => {
        const on = view === value;
        return (
          <button
            key={view}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`home-menu-${view}`}
            aria-selected={on}
            aria-controls={`home-pane-${view}`}
            tabIndex={on ? 0 : -1}
            className="cash-menu__tab"
            data-home-menu-tab={view}
            onClick={() => onChange(view)}
          >
            {HOME_PAGED_LABEL[view]}
            {view === "attention" && attentionCount > 0 ? (
              <span
                className="cash-menu__badge home-menu__badge"
                aria-label={`${attentionCount} to act on`}
              >
                {attentionCount}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
