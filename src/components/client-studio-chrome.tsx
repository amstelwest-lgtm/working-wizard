export type ClientRailId =
  | "home"
  | "desk"
  | "health"
  | "cash"
  | "profit"
  | "budget"
  | "moves"
  | "reports"
  | "deliverables"
  | "portal";

export const CLIENT_RAIL_GROUPS: {
  id: "overview" | "numbers" | "advice" | "client";
  label: string;
  items: { id: ClientRailId; label: string }[];
}[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      { id: "home", label: "Home" },
      { id: "desk", label: "Desk" },
      { id: "health", label: "Health" },
    ],
  },
  {
    id: "numbers",
    label: "Numbers",
    items: [
      { id: "cash", label: "Cash flow" },
      { id: "profit", label: "Profit" },
      { id: "budget", label: "Budget" },
    ],
  },
  {
    id: "advice",
    label: "Advice",
    items: [
      { id: "moves", label: "Next moves" },
      { id: "reports", label: "Reports" },
      { id: "deliverables", label: "Deliverables" },
    ],
  },
  {
    id: "client",
    label: "Client",
    items: [{ id: "portal", label: "Client portal" }],
  },
];

/** Flat list, top to bottom, for callers that do not render the headings. */
export const CLIENT_RAIL = CLIENT_RAIL_GROUPS.flatMap((group) => group.items);

export function ClientRailButton({
  id,
  label,
  active,
  onSelect,
}: {
  id: ClientRailId;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`tab${active ? " on" : ""}`}
      data-tab={id}
      data-bot-rail={id === "desk" ? "true" : undefined}
      aria-current={active ? "page" : undefined}
      aria-label={id === "portal" ? "Client portal, documents" : label}
      title={id === "portal" ? "Client portal and documents" : label}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}
