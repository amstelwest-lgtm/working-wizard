import { Link, useRouterState } from "@tanstack/react-router";

export type PracticeRailId = "dashboard" | "clients" | "desk" | "team" | "billing";

const ITEMS: {
  id: PracticeRailId;
  label: string;
  to: "/dashboard" | "/settings/team" | "/settings";
  hash?: string;
}[] = [
  { id: "dashboard", label: "Dashboard", to: "/dashboard" },
  { id: "clients", label: "Clients", to: "/dashboard", hash: "clients-table" },
  { id: "desk", label: "Desk", to: "/dashboard", hash: "accountant-inbox" },
  { id: "team", label: "Team", to: "/settings/team" },
  { id: "billing", label: "Billing", to: "/settings" },
];

function activePracticeItem(pathname: string, hash: string): PracticeRailId | null {
  const bare = hash.replace(/^#/, "");
  if (pathname === "/settings/team" || pathname.startsWith("/settings/team/")) return "team";
  if (pathname === "/settings" || pathname === "/settings/") return "billing";
  if (pathname === "/dashboard" || pathname === "/dashboard/") {
    if (bare === "clients-table") return "clients";
    if (bare === "accountant-inbox") return "desk";
    return "dashboard";
  }
  return null;
}

export function PracticeRailItems() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hash = useRouterState({ select: (s) => s.location.hash });
  const active = activePracticeItem(pathname, hash ?? "");
  return (
    <>
      {ITEMS.map((item) => {
        const on = active === item.id;
        return (
          <Link
            key={item.id}
            to={item.to}
            hash={item.hash}
            className={`tab${on ? " on" : ""}`}
            aria-current={on ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

/** Practice nav. Same flush rail as the client workspace. */
export function PracticeRail() {
  return (
    <nav className="deliverable-rail" aria-label="Practice">
      <PracticeRailItems />
    </nav>
  );
}
