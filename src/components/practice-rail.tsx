import { useEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { readDeskClient, rememberDeskClient } from "@/lib/desk-client";

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

function activePracticeItem(pathname: string, hash: string, href: string): PracticeRailId | null {
  const bare = hash.replace(/^#/, "");
  if (pathname.startsWith("/clients/") && /(?:^|[?&])tab=desk(?:&|$)/.test(href)) return "desk";
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

export function PracticeRailItems() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hash = useRouterState({ select: (s) => s.location.hash });
  const href = useRouterState({ select: (s) => s.location.href });
  const active = activePracticeItem(pathname, hash ?? "", href ?? "");
  const [deskClientId, setDeskClientId] = useState<string | null>(() => readDeskClient());

  useEffect(() => {
    if (deskClientId) return;
    let cancelled = false;
    void supabase
      .from("clients")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        const id = data?.[0]?.id;
        if (!cancelled && typeof id === "string" && id) {
          rememberDeskClient(id);
          setDeskClientId(id);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deskClientId]);

  const openDesk = () => {
    const id = deskClientId ?? readDeskClient();
    if (!id) return;
    rememberDeskClient(id);
    void navigate({
      to: "/clients/$clientId",
      params: { clientId: id },
      search: { tab: "desk" },
    });
  };

  const linkFor = (item: (typeof ITEMS)[number]) => {
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
  };

  const desk = deskClientId ? (
    <Link
      key="desk"
      to="/clients/$clientId"
      params={{ clientId: deskClientId }}
      search={{ tab: "desk" }}
      className={`tab${active === "desk" ? " on" : ""}`}
      aria-current={active === "desk" ? "page" : undefined}
    >
      Desk
    </Link>
  ) : (
    <button key="desk" type="button" className="tab" onClick={openDesk}>
      Desk
    </button>
  );

  return (
    <>
      {ITEMS.filter((item) => item.id === "dashboard" || item.id === "clients").map(linkFor)}
      {desk}
      {ITEMS.filter((item) => item.id === "team" || item.id === "billing").map(linkFor)}
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
