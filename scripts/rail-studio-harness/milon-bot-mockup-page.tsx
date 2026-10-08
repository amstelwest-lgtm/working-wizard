/**
 * Local-only routes. Not registered on the production router.
 * `/milon-bot-mockup` renders the desk from fixtures.
 * `/milon-bot-current` mounts the live widget so the before shot is the real chrome.
 */
import { useEffect, type ReactNode } from "react";
import { useSearch } from "@tanstack/react-router";
import { MilonBotDesk } from "@/components/milon-bot-desk/milon-bot-desk";
import { SectionCard } from "@/components/primitives";
import {
  CLIENT_RAIL,
  ClientRailButton,
} from "@/components/client-studio-chrome";
import { EMPTY_DESK, POPULATED_DESK } from "./milon-bot-mockup-fixtures";
import "../../public/ask-ai.css";

const CLIENT_ID = "harness-client";

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
    <div className="accountant-portal milon-desk-portal" data-rail-ready="true" data-desk-ready="true">
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
                landing={item.landing}
                label={item.id === "ask" ? "Milōn Bot" : item.label}
                active={item.id === "ask"}
                clientId={CLIENT_ID}
                primary={item.id === "ask"}
              />
            ))}
          </nav>
          <div className="deliverable-main">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function MilonBotMockupPage() {
  const search = useSearch({ strict: false }) as { fixture?: string };
  const model = search.fixture === "empty" ? EMPTY_DESK : POPULATED_DESK;
  return (
    <Frame clientName={model.clientName} onFile={model.syncedAt != null}>
      <MilonBotDesk model={model} />
    </Frame>
  );
}

export function CurrentBotPage() {
  useEffect(() => {
    let cancelled = false;
    const el = document.getElementById("ask-ai-accountant");
    if (!el) return;
    el.dataset.clientId = CLIENT_ID;
    void import("../../src/lib/ask-ai.js").then((mod: { mountAskAi?: (node: HTMLElement, opts: unknown) => void }) => {
      if (cancelled || typeof mod.mountAskAi !== "function") return;
      el.replaceChildren();
      mod.mountAskAi(el, {
        endpoint: "http://127.0.0.1:9/functions/v1/ask-ai",
        botEndpoint: "http://127.0.0.1:9/functions/v1/milon-bot",
        variant: "studio",
        audience: "accountant",
        getToken: async () => null,
      });
      el.dataset.currentBotReady = "true";
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Frame clientName="Harbour Glass" onFile>
      <div className="tabpane on" id="pane-ask">
        <SectionCard className="card hero-card ask-ai-studio-shell">
          <div id="ask-ai-accountant" />
        </SectionCard>
      </div>
    </Frame>
  );
}
