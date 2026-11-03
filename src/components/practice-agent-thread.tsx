import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { AgentStage } from "@/components/milon-team/agent-stage";
import { portalButtonClass } from "@/lib/client-chrome";
import { supabase } from "@/integrations/supabase/client";
import { loadStarterMonthlyLabel } from "@/lib/trial-card-price";
import {
  isTaxAgent,
  type StageAgentKey,
} from "@/lib/tax-specialist/agents";
import type { PracticeTaxPageClient } from "@/lib/tax-specialist/practice-tax-client";
import { rewriteDraftMonthStamp } from "@/lib/statement-period";
import "./milon-team/milon-team-desk.css";
import "./practice-agent-thread.css";

export type PracticeThreadClient = { id: string; name: string };

type LoadedTaxPractice = ComponentType<{
  clients: readonly PracticeTaxPageClient[];
  selectedClientId: string;
  onSelectClient: (clientId: string) => void;
  marketCountry: string | null;
  audience?: "owner" | "accountant";
}>;

/**
 * Practice Home thread for one agent. The hash `#ask-financial-manager`
 * (and the analyst / advisor / tax hashes) is the address. The cards stay off
 * while this is mounted.
 */
export function PracticeAgentThread({
  agent,
  finding,
  clients,
  taxClients = [],
  onBack,
  onSelectAgent,
  marketCountry = null,
  firmId = null,
  children,
}: {
  agent: StageAgentKey;
  finding: string;
  /** Clients the Ask widget can use. */
  clients: PracticeThreadClient[];
  /** ZA clients for the Tax Specialist portfolio. */
  taxClients?: readonly PracticeTaxPageClient[];
  onBack: () => void;
  onSelectAgent: (agent: StageAgentKey) => void;
  marketCountry?: string | null;
  firmId?: string | null;
  children?: ReactNode;
}) {
  const taxMode = isTaxAgent(agent);
  const askClients = taxMode
    ? taxClients.map((row) => ({ id: row.id, name: row.name }))
    : clients;
  const [clientId, setClientId] = useState(askClients[0]?.id ?? "");
  const [TaxPracticePage, setTaxPracticePage] = useState<LoadedTaxPractice | null>(null);

  useEffect(() => {
    if (askClients.some((row) => row.id === clientId)) return;
    setClientId(askClients[0]?.id ?? "");
  }, [askClients, clientId]);

  useEffect(() => {
    if (!taxMode) return;
    let live = true;
    void import("@/components/tax-specialist/za-tax-practice-page").then((mod) => {
      if (live) setTaxPracticePage(() => mod.ZaTaxPracticePage);
    });
    return () => {
      live = false;
    };
  }, [taxMode]);

  useEffect(() => {
    const el = document.getElementById("ask-ai-accountant");
    if (!el || !clientId) return;
    let cancelled = false;
    el.dataset.clientId = clientId;
    el.dataset.agent = agent;
    el.dataset.agentReply = "shell";
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

  const chat = (
    <>
      {askClients.length > 1 ? (
        <label className="practice-agent-client">
          Ask about
          <select
            value={clientId}
            aria-label="Ask about"
            onChange={(event) => setClientId(event.target.value)}
          >
            {askClients.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
      ) : askClients.length === 1 ? (
        <p className="practice-agent-client">Ask about {askClients[0].name}</p>
      ) : (
        <p className="practice-agent-client">
          {taxMode ? "Add a South African client to prepare tax forms." : "Add a client to ask about their books."}
        </p>
      )}
      {clientId ? (
        <div className="milon-desk-host">
          <div id="ask-ai-accountant" className="ask-ai-studio-shell" />
        </div>
      ) : null}
    </>
  );

  if (taxMode) {
    return (
      <div className="practice-agent-thread" data-practice-agent-thread={agent}>
        <button type="button" className={portalButtonClass("secondary")} data-agent-back="" onClick={onBack}>
          Back to the team
        </button>
        <AgentStage
          agent={agent}
          finding={rewriteDraftMonthStamp(finding)}
          onSelect={(next) => onSelectAgent(next)}
          marketCountry={marketCountry}
          audience="accountant"
          taxTab
          chat={chat}
        >
          {TaxPracticePage ? (
            <TaxPracticePage
              clients={taxClients}
              selectedClientId={clientId}
              onSelectClient={setClientId}
              marketCountry={marketCountry}
              audience="accountant"
            />
          ) : (
            <p className="agent-section-empty" data-tax-practice="loading" role="status">
              Loading the Tax Specialist…
            </p>
          )}
        </AgentStage>
      </div>
    );
  }

  return (
    <div className="practice-agent-thread" data-practice-agent-thread={agent}>
      <button type="button" className={portalButtonClass("secondary")} data-agent-back="" onClick={onBack}>
        Back to the team
      </button>
      <AgentStage
        agent={agent}
        finding={rewriteDraftMonthStamp(finding)}
        onSelect={(next) => onSelectAgent(next)}
        marketCountry={marketCountry}
        audience="accountant"
        chat={chat}
      >
        {children}
      </AgentStage>
    </div>
  );
}
