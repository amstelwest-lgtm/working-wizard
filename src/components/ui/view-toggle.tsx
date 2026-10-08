/**
 * Segmented Chart / Table style switch shared by Budget and Cash.
 * Active segment uses gold. It is a view switch, not the page's Sign off button.
 */
import { useRef, type KeyboardEvent } from "react";

export type ViewToggleOption = {
  value: string;
  label: string;
};

export function ViewToggle({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly ViewToggleOption[];
  ariaLabel: string;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    buttons.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (options.length === 0) return;
    const current = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      select((current + 1) % options.length);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      select((current - 1 + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      select(0);
    } else if (event.key === "End") {
      event.preventDefault();
      select(options.length - 1);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      data-view-toggle=""
      className="inline-flex max-w-full rounded-full border border-[#d4af37]/50 p-0.5"
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`view-toggle-${option.value}`}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            className={`rounded-full px-3 py-1 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d4af37] ${
              on ? "bg-[#d4af37] text-[#1b1608]" : "bg-transparent text-slate-600 dark:text-slate-300"
            }`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
