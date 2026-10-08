/**
 * Local-only route. Not registered on the production router.
 * `/milon-team-desk` renders the desk from the harness stub, with the
 * real chat widget mounted underneath and pointed at a local stub.
 */
import { useEffect, type ReactNode } from "react";
import { useSearch } from "@tanstack/react-router";
import { CLIENT_RAIL, ClientRailButton } from "@/components/client-studio-chrome";
import { MilonTeamDesk } from "@/components/milon-team/milon-team-desk";
import "../../../public/ask-ai.css";
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
  useEffect(() => {
    const el = document.getElementById("ask-ai-accountant");
    if (!el) return;
    let cancelled = false;
    el.dataset.clientId = "harness-client";
    if (el.dataset.askAiMounted === "1") return;
    el.innerHTML = "";
    void import("@/lib/ask-ai.js").then((mod: { mountAskAi?: (node: HTMLElement, opts: unknown) => void }) => {
      if (cancelled || typeof mod.mountAskAi !== "function") return;
      if (el.dataset.askAiMounted === "1") return;
      el.dataset.askAiMounted = "1";
      mod.mountAskAi(el, {
        endpoint: "/__harness/bot-reply",
        botEndpoint: "/__harness/bot-reply",
        variant: "studio",
        audience: "accountant",
        getToken: async () => "harness",
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <Frame clientName={empty ? "North Shed" : "Harbour Glass"} onFile={!empty}>
      <div className="tabpane on" id="pane-ask">
        <div className="milon-desk-host">
          <MilonTeamDesk feed={feed} now={DESK_NOW} />
          <div id="ask-ai-accountant" className="ask-ai-studio-shell" />
        </div>
      </div>
    </Frame>
  );
}
