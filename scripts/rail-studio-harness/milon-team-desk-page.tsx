/**
 * Local-only route. Not registered on the production router.
 * `/milon-team-desk` renders the desk from the harness stub.
 */
import type { ReactNode } from "react";
import { useSearch } from "@tanstack/react-router";
import { CLIENT_RAIL, ClientRailButton } from "@/components/client-studio-chrome";
import { MilonTeamDesk } from "@/components/milon-team/milon-team-desk";
import { DESK_NOW, useMilonTeamFeedStub } from "./milon-team-stub";

function Frame({
  clientName,
  onFile,
  children,
}: {
  clientName: string;
  onFile: boolean;
  children: ReactNode;
}) {
  return (
    <div className="accountant-portal" data-rail-ready="true">
      <div id="atmos">
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="grid" />
      </div>
      <div className="shell">
        <div className="topbar">
          <span className="brand">
            <span className="gold-text">MILŌN</span>
          </span>
          <span className="spacer" />
        </div>
        <div className="crumb">
          <span>Firm dashboard</span>
          <span>/</span>
          <span>
            <b style={{ color: "var(--ink)" }}>{clientName}</b>
          </span>
          {onFile ? <span className="aud">On file</span> : <span className="crumb-empty">No data yet</span>}
        </div>
        <div className="client-workspace">
          <nav className="deliverable-rail" aria-label="Client workspace">
            {CLIENT_RAIL.map((item) => (
              <ClientRailButton
                key={item.id}
                id={item.id}
                label={item.label}
                active={item.id === "ask"}
                primary={item.id === "ask"}
                onSelect={() => undefined}
              />
            ))}
          </nav>
          <div className="deliverable-main">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function MilonTeamDeskPage() {
  const search = useSearch({ strict: false }) as { fixture?: string };
  const empty = search.fixture === "empty";
  const feed = useMilonTeamFeedStub(empty ? "empty" : "harbour-glass");
  return (
    <Frame clientName={empty ? "North Shed" : "Harbour Glass"} onFile={!empty}>
      <MilonTeamDesk feed={feed} now={DESK_NOW} />
    </Frame>
  );
}
