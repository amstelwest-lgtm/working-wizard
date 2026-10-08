import type { KeyboardEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  accountantClientTabSearch,
  DELIVERABLE_SECTIONS,
  OVERVIEW_SECTIONS,
} from "@/lib/client-route-search";

export const CLIENT_RAIL: { id: "ask" | "overview" | "deliverables"; label: string; landing: string }[] = [
  { id: "ask", label: "Bot", landing: "ask" },
  { id: "overview", label: "Overview", landing: "overview" },
  { id: "deliverables", label: "Deliverables", landing: "reports" },
];

export const OVERVIEW_SECTION_TABS: { id: (typeof OVERVIEW_SECTIONS)[number]; label: string }[] = [
  { id: "health", label: "Health" },
  { id: "pillars", label: "Pillars" },
  { id: "cash", label: "Cash" },
  { id: "profit", label: "Profit" },
  { id: "collections", label: "Collections" },
  { id: "payables", label: "Payables" },
  { id: "budget", label: "Budget" },
  { id: "moves", label: "Moves" },
  { id: "books", label: "Books" },
];

export const DELIVERABLE_SECTION_TABS: { id: (typeof DELIVERABLE_SECTIONS)[number]; label: string }[] = [
  { id: "reports", label: "Reports" },
  { id: "pack", label: "Advisory pack" },
  { id: "plan", label: "Action plan" },
  { id: "drafter", label: "Advisory" },
];

export function railGroup(tab: string): "ask" | "overview" | "deliverables" {
  if (tab === "ask") return "ask";
  if (tab === "reports" || tab === "plan" || tab === "advisory" || tab === "drafter") return "deliverables";
  return "overview";
}

export function selectedSectionId(tab: string, section: string | undefined): string | null {
  if (railGroup(tab) === "deliverables") {
    return DELIVERABLE_SECTION_TABS.some((row) => row.id === section) ? (section ?? "reports") : "reports";
  }
  return OVERVIEW_SECTION_TABS.some((row) => row.id === section) ? (section ?? null) : null;
}

export function ClientRailButton({
  id,
  landing,
  label,
  active,
  clientId,
  primary,
}: {
  id: "ask" | "overview" | "deliverables";
  landing: string;
  label: string;
  active: boolean;
  clientId: string;
  primary?: boolean;
}) {
  return (
    <Link
      to="/clients/$clientId"
      params={{ clientId }}
      search={(prev) => accountantClientTabSearch(prev, landing)}
      className={`tab${active ? " on" : ""}${primary ? " bot-primary" : ""}`}
      data-tab={id}
      data-bot-rail={primary ? "true" : undefined}
      aria-current={active ? "page" : undefined}
      replace
    >
      {label}
    </Link>
  );
}

export function SectionTabList({
  label,
  sections,
  selected,
  onSelect,
}: {
  label: string;
  sections: readonly { id: string; label: string }[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    const ids = sections.map((section) => section.id);
    const current = selected && ids.includes(selected) ? selected : ids[0];
    let index = Math.max(0, ids.indexOf(current ?? ""));
    if (event.key === "ArrowRight") index = (index + 1) % ids.length;
    if (event.key === "ArrowLeft") index = (index - 1 + ids.length) % ids.length;
    if (event.key === "Home") index = 0;
    if (event.key === "End") index = ids.length - 1;
    const next = ids[index];
    if (!next) return;
    onSelect(next);
    window.requestAnimationFrame(() => {
      document.getElementById(`section-tab-${next}`)?.focus();
    });
  };
  return (
    <div className="section-tablist" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {sections.map((section, index) => {
        const on = selected === section.id;
        const roving = on || (selected == null && index === 0);
        return (
          <button
            key={section.id}
            type="button"
            role="tab"
            id={`section-tab-${section.id}`}
            className="section-tab"
            aria-selected={on}
            aria-current={on ? "page" : undefined}
            tabIndex={roving ? 0 : -1}
            onClick={() => onSelect(section.id)}
          >
            {section.label}
          </button>
        );
      })}
    </div>
  );
}
