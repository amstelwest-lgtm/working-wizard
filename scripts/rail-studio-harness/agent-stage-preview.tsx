/**
 * Local-only route. Shows the open agent stage and the Hand to buttons.
 */
import { useEffect, useState } from "react";
import { ActionHandoffButtons } from "@/components/action-handoff-buttons";
import { AgentStage } from "@/components/milon-team/agent-stage";
import { agentDisplayName } from "@/lib/milon-team";
import type { AgentKey } from "@/lib/milon-team-feed";
import "@/components/owner-door/owner-door.css";
import "@/components/milon-team/milon-team-desk.css";
import "../../public/ask-ai.css";

const FINDING =
  "Connect a ledger or send the current trial balance, and confirm the opening cash for the 13-week cashflow.";

export function AgentStagePreview() {
  const [agent, setAgent] = useState<AgentKey>("financial_manager");
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [pickup, setPickup] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = document.getElementById("ask-ai-accountant");
    if (!el) return;
    let cancelled = false;
    el.dataset.clientId = "harness-client";
    if (el.dataset.askAiMounted === "1") {
      setReady(true);
      return;
    }
    el.innerHTML = "";
    void import("@/lib/ask-ai.js").then(
      (mod: { mountAskAi?: (node: HTMLElement, opts: unknown) => void }) => {
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
        setReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="accountant-portal"
      data-rail-ready="true"
      data-agent-stage-ready={ready ? "true" : "false"}
    >
      <div className="shell" style={{ maxWidth: 920, margin: "0 auto", padding: 16 }}>
        <p className="crumb">Practice · Karoo Traders</p>
        <div className="tabpane on" id="pane-ask">
          <button type="button" className="owner-back">
            Back to the team
          </button>
          <div className="milon-desk-host">
            <AgentStage
              agent={agent}
              finding={FINDING}
              onSelect={setAgent}
              marketCountry="ZA"
              audience="accountant"
              chat={<div id="ask-ai-accountant" className="ask-ai-studio-shell" />}
            >
              <section className="milon-desk-card" aria-label="Today">
                <p className="milon-desk-kicker">Today</p>
                <p className="milon-desk-figure">{FINDING}</p>
                <p className="milon-desk-signoff" data-signoff-status>
                  Advisory pack · still a draft
                </p>
              </section>
            </AgentStage>
            <p className="milon-desk-invite" style={{ margin: "8px 4px 0" }}>
              1 open query
            </p>
          </div>
        </div>
        <section
          data-handoff-preview="true"
          style={{
            marginTop: 24,
            background: "#fff",
            border: "1px solid #dbeafe",
            borderRadius: 16,
            paddingTop: 12,
          }}
        >
          <p style={{ margin: "0 16px 8px", fontWeight: 700 }}>get emails out to 10 clients</p>
          <p style={{ margin: "0 16px 8px", fontSize: 12, letterSpacing: "0.08em" }}>
            ASSIGN {ownerName ?? "—"}
          </p>
          <ActionHandoffButtons
            ownerName={ownerName}
            pickupLabel={pickup}
            onHandOff={(next) => {
              setOwnerName(agentDisplayName(next));
              setPickup(next === "analyst" ? "Analyst picked this up" : null);
            }}
          />
        </section>
      </div>
    </div>
  );
}
