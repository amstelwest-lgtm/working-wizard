import { useEffect, useState, type ReactNode } from "react";
import { AgentStage } from "@/components/milon-team/agent-stage";
import { portalButtonClass } from "@/lib/client-chrome";
import { supabase } from "@/integrations/supabase/client";
import { loadStarterMonthlyLabel } from "@/lib/trial-card-price";
import type { AgentKey } from "@/lib/milon-team-feed";
import { rewriteDraftMonthStamp } from "@/lib/statement-period";
import "./milon-team/milon-team-desk.css";
import "./practice-agent-thread.css";

export type PracticeThreadClient = { id: string; name: string };

/**
 * Practice Home thread for one agent. The hash `#ask-financial-manager`
 * (and the analyst / advisor hashes) is the address. The cards stay off
 * while this is mounted.
 */
export function PracticeAgentThread({
  agent,
  finding,
  clients,
  onBack,
  onSelectAgent,
  marketCountry = null,
  firmId = null,
  children,
}: {
  agent: AgentKey;
  finding: string;
  clients: PracticeThreadClient[];
  onBack: () => void;
  onSelectAgent: (agent: AgentKey) => void;
  marketCountry?: string | null;
  firmId?: string | null;
  children?: ReactNode;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  useEffect(() => {
    if (clients.some((row) => row.id === clientId)) return;
    setClientId(clients[0]?.id ?? "");
  }, [clients, clientId]);

  useEffect(() => {
    const el = document.getElementById("ask-ai-accountant");
    if (!el || !clientId) return;
    let cancelled = false;
    el.dataset.clientId = clientId;
    el.dataset.agent = agent;
    // The chat widget reads this when a trial-ended reply mounts the plan card.
    if (firmId) el.dataset.firmId = firmId;
    else delete el.dataset.firmId;
    el.dispatchEvent(new Event("ask-ai-context"));
    if (el.dataset.askAiMounted === "1" && el.dataset.askAiClient === clientId) return;
    el.innerHTML = "";
    delete el.dataset.askAiMounted;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — plain JS module without type declarations
    void import("../lib/ask-ai.js")
      .then((mod: { mountAskAi?: (el: HTMLElement, opts: unknown) => void }) => {
        if (cancelled || typeof mod.mountAskAi !== "function") return;
        const node = document.getElementById("ask-ai-accountant");
        if (!node) return;
        node.dataset.clientId = clientId;
        node.dataset.askAiMounted = "1";
        node.dataset.askAiClient = clientId;
        const base = import.meta.env.VITE_SUPABASE_URL;
        mod.mountAskAi(node, {
          endpoint: `${base}/functions/v1/ask-ai`,
          botEndpoint: `${base}/functions/v1/milon-bot`,
          variant: "studio",
          audience: "accountant",
          note: null,
          getToken: async () => {
            const { data } = await supabase.auth.getSession();
            return data.session?.access_token ?? null;
          },
          refreshSession: async () => {
            const { data } = await supabase.auth.refreshSession();
            return data.session?.access_token ?? null;
          },
          getStarterMonthly: () => loadStarterMonthlyLabel(),
        });
      })
      .catch(() => {
        /* Widget module unavailable. The stage is still the open thread. */
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, agent, firmId]);

  return (
    <div className="practice-agent-thread" data-practice-agent-thread={agent}>
      <button type="button" className={portalButtonClass("secondary")} data-agent-back="" onClick={onBack}>
        Back to the team
      </button>
      <AgentStage
        agent={agent}
        finding={rewriteDraftMonthStamp(finding)}
        onSelect={onSelectAgent}
        marketCountry={marketCountry}
        audience="accountant"
      >
        {children}
        {clients.length > 1 ? (
          <label className="practice-agent-client">
            Ask about
            <select
              value={clientId}
              aria-label="Ask about"
              onChange={(event) => setClientId(event.target.value)}
            >
              {clients.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
        ) : clients.length === 1 ? (
          <p className="practice-agent-client">Ask about {clients[0].name}</p>
        ) : (
          <p className="practice-agent-client">Add a client to ask about their books.</p>
        )}
        {clientId ? (
          <div className="milon-desk-host">
            <div id="ask-ai-accountant" className="ask-ai-studio-shell" />
          </div>
        ) : null}
      </AgentStage>
    </div>
  );
}
