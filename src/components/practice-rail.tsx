import { Link, useRouterState } from "@tanstack/react-router";

export type PracticeRailId = "dashboard" | "clients" | "desk" | "team" | "billing";

const ITEMS: {
  id: Exclude<PracticeRailId, "desk">;
  label: string;
  to: "/dashboard" | "/settings/team" | "/settings";
  hash?: string;
}[] = [
  { id: "dashboard", label: "Dashboard", to: "/dashboard" },
  { id: "clients", label: "Clients", to: "/dashboard", hash: "clients-table" },
  { id: "team", label: "Team", to: "/settings/team" },
  { id: "billing", label: "Billing", to: "/settings", hash: "firm-billing" },
];

function activePracticeItem(pathname: string, hash: string): PracticeRailId | null {
  const bare = hash.replace(/^#/, "");
  if (pathname === "/desk" || pathname === "/desk/") return "desk";
  if (pathname === "/settings/team" || pathname.startsWith("/settings/team/")) return "team";
  if (pathname === "/settings" || pathname === "/settings/") {
    return bare === "firm-billing" ? "billing" : null;
  }
  if (pathname === "/dashboard" || pathname === "/dashboard/") {
    if (bare === "clients-table") return "clients";
    return "dashboard";
  }
  return null;
}

export function PracticeRailItems({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hash = useRouterState({ select: (s) => s.location.hash });
  const active = activePracticeItem(pathname, hash ?? "");

  const linkFor = (item: (typeof ITEMS)[number]) => {
    const on = active === item.id;
    return (
      <Link
        key={item.id}
        to={item.to}
        hash={item.hash}
        className={`tab${on ? " on" : ""}`}
        aria-current={on ? "page" : undefined}
        onClick={onNavigate}
      >
        {item.label}
      </Link>
    );
  };

  return (
    <>
      {ITEMS.filter((item) => item.id === "dashboard" || item.id === "clients").map(linkFor)}
      <Link
        key="desk"
        to="/desk"
        className={`tab${active === "desk" ? " on" : ""}`}
        aria-current={active === "desk" ? "page" : undefined}
        onClick={onNavigate}
      >
        Desk
      </Link>
      {ITEMS.filter((item) => item.id === "team" || item.id === "billing").map(linkFor)}
    </>
  );
}

/** Practice nav. Same flush rail as the client workspace. */
export function PracticeRail({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="deliverable-rail" aria-label="Practice">
      <PracticeRailItems onNavigate={onNavigate} />
    </nav>
  );
}
