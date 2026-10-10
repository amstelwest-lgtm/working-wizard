import type { ReactNode } from "react";
import { agentShortName } from "@/lib/milon-team";
import { ownerPlanFreeLine, ownerPlanLine, type OwnerVisitor } from "@/lib/owner-plan";

export type OwnerActionRow = {
  id: string;
  title: string;
  status: string;
  due: string | null;
};

export type OwnerSignoffRow = {
  id: string;
  scope: string;
  name: string;
  when: string;
};

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
};

const SCOPE_LABEL: Record<string, string> = {
  financials: "Books",
  profitability: "Profit",
  cash_forecast: "13-week cash",
  budget: "Budget",
  action_plan: "Action points",
  advisory: "Advisory",
};

export function OwnerActions({
  rows,
  ready,
  onAsk,
}: {
  rows: OwnerActionRow[];
  ready: boolean;
  onAsk: () => void;
}) {
  return (
    <section className="owner-pane" data-owner-page="actions">
      <h1 className="owner-title">Action points</h1>
      <p className="owner-lede">
        {ready
          ? rows.length
            ? "Open points waiting on you."
            : "Nothing is waiting on you."
          : "Checking action points."}
      </p>
      <div className="owner-promises">
        {rows.map((row) => (
          <article key={row.id} className="owner-tile" data-action={row.id}>
            <div>
              <h2>{row.title}</h2>
              <p>
                {STATUS_LABEL[row.status] ?? row.status}
                {row.due ? ` · ${row.due}` : ""}
              </p>
            </div>
          </article>
        ))}
      </div>
      <button type="button" className="owner-ask owner-ask-inline" onClick={onAsk}>
        Ask {agentShortName("financial_manager")}
      </button>
    </section>
  );
}

export function OwnerAccountant({
  joined,
  firmName,
  invite,
  uploads,
  onConnect,
}: {
  joined: boolean;
  firmName: string | null;
  invite: ReactNode;
  uploads: ReactNode;
  onConnect: () => void;
}) {
  return (
    <section className="owner-pane" data-owner-page="accountant">
      <h1 className="owner-title">Accountant</h1>
      <p className="owner-lede">
        {joined
          ? `${firmName?.trim() || "Your accountant"} is on Milōn.`
          : "Invite your accountant to sign off."}
      </p>
      {joined ? null : <p className="owner-free">{ownerPlanFreeLine()}</p>}
      {invite}
      <h2 className="owner-sub">Uploads</h2>
      {uploads}
      <button type="button" className="owner-ask owner-ask-inline" onClick={onConnect}>
        Connect your books
      </button>
    </section>
  );
}

export function OwnerDeliverables({
  rows,
  onInvite,
}: {
  rows: OwnerSignoffRow[];
  onInvite: () => void;
}) {
  return (
    <section className="owner-pane" data-owner-page="deliverables">
      <h1 className="owner-title">Deliverables</h1>
      <p className="owner-lede">
        {rows.length ? "What your accountant signed." : "Invite your accountant to sign off."}
      </p>
      <div className="owner-promises">
        {rows.map((row) => (
          <article key={row.id} className="owner-tile">
            <div>
              <h2>{SCOPE_LABEL[row.scope] ?? row.scope}</h2>
              <p>
                {row.name} signed off on {row.when}.
              </p>
            </div>
            <span className="owner-badge">Signed off ✓</span>
          </article>
        ))}
      </div>
      {rows.length ? null : (
        <button type="button" className="owner-ask owner-ask-inline" onClick={onInvite}>
          Invite your accountant
        </button>
      )}
    </section>
  );
}

export function OwnerPlan({
  visitor,
  accountantOnMilon,
  firmName,
}: {
  visitor: OwnerVisitor | null;
  accountantOnMilon: boolean;
  firmName: string | null;
}) {
  return (
    <section className="owner-pane" data-owner-page="plan">
      <h1 className="owner-title">Plan</h1>
      <p className="owner-plan">{ownerPlanLine({ visitor, accountantOnMilon, firmName })}</p>
      <p className="owner-lede">The price is on this page only.</p>
    </section>
  );
}

export function OwnerFirst({
  onQuickBooks,
  onXero,
  onInvite,
  joined,
}: {
  onQuickBooks: () => void;
  onXero: () => void;
  onInvite: () => void;
  joined: boolean;
}) {
  return (
    <section className="owner-pane" data-owner-page="first">
      <h1 className="owner-title">Connect your books</h1>
      <p className="owner-lede">
        Connect QuickBooks or Xero. Nothing is filled in until the books are on file.
      </p>
      <div className="owner-first-actions">
        <button type="button" className="owner-ask" onClick={onQuickBooks}>
          Connect QuickBooks
        </button>
        <button type="button" className="owner-ask" onClick={onXero}>
          Connect Xero
        </button>
      </div>
      {joined ? null : (
        <>
          <p className="owner-free">{ownerPlanFreeLine()}</p>
          <button type="button" className="owner-ask owner-ask-inline" onClick={onInvite}>
            Invite your accountant
          </button>
        </>
      )}
    </section>
  );
}
