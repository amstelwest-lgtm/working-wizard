/**
 * Client Home brief. The accountant confirms or opens work.
 * Draft chase uses the shared chase draft and is never sent.
 */
import { useState } from "react";
import { ChaseDraftDialog } from "@/components/chase-draft-dialog";
import type { FinancialManagerBrief } from "@/lib/financial-manager-brief";
import { useMarketFormat } from "@/contexts/market";
import "./financial-manager-brief.css";

const BUTTON_LABEL = {
  hand: "Hand to bot",
  chase: "Draft chase",
  open: "Open",
} as const;

export function FinancialManagerBrief({
  brief,
  onHandToBot,
  onOpen,
}: {
  brief: FinancialManagerBrief;
  onHandToBot: () => void;
  onOpen: (tab: "plan" | "cash" | "health" | "profit" | "budget" | "reports") => void;
}) {
  const { money } = useMarketFormat();
  const [chaseOpen, setChaseOpen] = useState(false);
  const since = brief.priorLabel ? `since ${brief.priorLabel}` : "since last month";

  return (
    <section className="fm-brief" aria-label="Financial Manager brief" data-fm-brief="true">
      <p className="fm-brief-kicker">Financial Manager</p>
      <h2 className="fm-brief-title">What changed {since}</h2>
      {brief.movements.length > 0 ? (
        <ol className="fm-brief-moves">
          {brief.movements.map((row) => (
            <li key={row.key}>
              <span>{row.label}</span>
              <b>
                {row.delta > 0 ? "Up " : "Down "}
                {money(Math.abs(row.delta))}
              </b>
              <small>
                {money(row.current)} from {money(row.prior)}
              </small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="fm-brief-empty">{brief.movementEmpty}</p>
      )}

      <h3>Act on these</h3>
      {brief.actions.length > 0 ? (
        <ul className="fm-brief-actions">
          {brief.actions.map((action) => (
            <li key={action.id}>
              <div>
                <b>{action.title}</b>
                <span>{action.reason}</span>
              </div>
              <button
                type="button"
                className="btn ghost mini"
                onClick={() => {
                  if (action.button === "hand") onHandToBot();
                  else if (action.button === "chase") setChaseOpen(true);
                  else if (action.tab) onOpen(action.tab);
                }}
              >
                {BUTTON_LABEL[action.button]}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fm-brief-empty">{brief.actionEmpty}</p>
      )}
      {chaseOpen && brief.chase ? (
        <ChaseDraftDialog draft={brief.chase} onClose={() => setChaseOpen(false)} />
      ) : null}

      <h3>Drafts ready to review</h3>
      {brief.drafts.length > 0 ? (
        <ul className="fm-brief-drafts">
          {brief.drafts.map((draft) => (
            <li key={draft.id}>
              <span>{draft.title}</span>
              <button type="button" className="btn ghost mini" onClick={() => onOpen("reports")}>
                Open
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fm-brief-empty">{brief.draftEmpty}</p>
      )}
    </section>
  );
}
