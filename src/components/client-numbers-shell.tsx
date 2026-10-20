/**
 * Cash and Budget paint before the fat client row (financials, cashflow,
 * budget) comes back. The panels load those blobs themselves. Home still
 * uses the agent-card standby and its own 8s row deadline.
 */
import { useEffect } from "react";
import { BudgetPanel } from "@/components/budget/budget-panel";
import { CashForecastPanel } from "@/components/cash-forecast";
import { ClientSectionOverview, ClientSubpageFrame } from "@/components/client-subpage";
import { MarketProvider } from "@/contexts/market";
import { measureBootstrap } from "@/lib/bootstrap-perf";
import { accountantClientTabSearch } from "@/lib/client-route-search";
import { parseMarketSelection } from "@/lib/market";

export function ClientNumbersShell({
  clientId,
  tab,
  section,
  market,
  timedOut,
}: {
  clientId: string;
  tab: "cash" | "budget";
  section?: string;
  market?: unknown;
  timedOut: boolean;
}) {
  useEffect(() => {
    measureBootstrap("client-shell");
  }, []);

  const body = (
    <div className="accountant-portal premium-shell" data-client-numbers-shell="">
      <main className="shell">
        {timedOut ? (
          <p className="sub" role="status">
            Couldn't load this client. Refresh to try again.
          </p>
        ) : null}
        {tab === "cash" && section === "forecast" ? (
          <ClientSubpageFrame
            id="forecast"
            eyebrow="Cash flow"
            title="13-week forecast"
            subtitle="Thirteen weeks of cash. Sign off and export from this page."
          >
            <div className="card cf-wrap" id="wizard-cash-panel">
              <CashForecastPanel clientId={clientId} clientName="" canSign hideInlineSignOff />
            </div>
          </ClientSubpageFrame>
        ) : null}
        {tab === "cash" && section !== "forecast" ? (
          <ClientSectionOverview
            clientId={clientId}
            eyebrow="Numbers"
            title="Cash flow"
            subtitle="The forecast, who to chase, and who to pay each have their own page."
            links={[
              {
                id: "forecast",
                label: "13-week forecast",
                detail: "Thirteen weeks of cash, with sign-off on this page.",
                search: (prev) => accountantClientTabSearch(prev, "cash", { section: "forecast" }),
              },
              {
                id: "collections",
                label: "Who to chase",
                detail: "Debtors to collect.",
                search: (prev) =>
                  accountantClientTabSearch(prev, "cash", { section: "collections" }),
              },
              {
                id: "payables",
                label: "Who to pay",
                detail: "Bills to schedule against the cash you have.",
                search: (prev) => accountantClientTabSearch(prev, "cash", { section: "payables" }),
              },
            ]}
          />
        ) : null}
        {tab === "budget" && (section === "year" || section === "months") ? (
          <ClientSubpageFrame
            id={section}
            eyebrow="Budget"
            title={section === "months" ? "Month by month" : "This year"}
            subtitle={
              section === "months"
                ? "Every month in the budget, next to actuals. Sign off and export from this page."
                : "The year against the plan. Sign off and export from this page."
            }
          >
            <div id="wizard-budget-panel">
              <BudgetPanel
                clientId={clientId}
                clientName=""
                simplified
                role="accountant"
                canSign
                hideInlineSignOff
                lens={section === "months" ? "table" : "chart"}
              />
            </div>
          </ClientSubpageFrame>
        ) : null}
        {tab === "budget" && section !== "year" && section !== "months" ? (
          <ClientSectionOverview
            clientId={clientId}
            eyebrow="Numbers"
            title="Budget"
            subtitle="This year and the month-by-month view each have their own page."
            links={[
              {
                id: "year",
                label: "This year",
                detail: "The year against the plan, with sign-off and the PDF.",
                search: (prev) => accountantClientTabSearch(prev, "budget", { section: "year" }),
              },
              {
                id: "months",
                label: "Month by month",
                detail: "Every month in the budget, next to actuals.",
                search: (prev) => accountantClientTabSearch(prev, "budget", { section: "months" }),
              },
            ]}
          />
        ) : null}
      </main>
    </div>
  );

  return <MarketProvider selection={parseMarketSelection(market)}>{body}</MarketProvider>;
}
