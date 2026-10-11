import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { agentShortName } from "@/lib/milon-team";
import { OWNER_SIGNED_SECTION_ID } from "@/lib/owner-nav";
import { ownerPlanFreeLine, ownerPlanLine, type OwnerVisitor } from "@/lib/owner-plan";
import {
  OWNER_PLAN_BENEFITS,
  OWNER_PLAN_FREE_LINE,
  OWNER_PLAN_INVITE_LABEL,
  type OwnerSubscribeView,
} from "@/lib/owner-subscribe";
import { OwnerSubscribe } from "./owner-subscribe";

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
      <button type="button" className="btn gold owner-ask owner-ask-inline" onClick={onAsk}>
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
  signed,
  requests,
  onConnect,
  onHome,
}: {
  joined: boolean;
  firmName: string | null;
  invite: ReactNode;
  uploads: ReactNode;
  requests?: ReactNode;
  signed: OwnerSignoffRow[];
  onConnect: () => void;
  onHome?: () => void;
}) {
  return (
    <section className="owner-pane" data-owner-page="accountant">
      <nav className="owner-crumb" aria-label="breadcrumb">
        {onHome ? (
          <button type="button" className="owner-crumb-link" onClick={onHome}>
            Home
          </button>
        ) : (
          <span>Home</span>
        )}
        <span aria-hidden="true">/</span>
        <span aria-current="page">Accountant portal</span>
      </nav>
      <h1 className="owner-title">Accountant portal</h1>
      <p className="owner-lede">
        {joined
          ? `${firmName?.trim() || "Your accountant"} is on Milōn.`
          : "Invite your accountant to sign off."}
      </p>
      {joined ? null : <p className="owner-free">{ownerPlanFreeLine()}</p>}
      {invite}
      <div id="owner-accountant-requests">{requests}</div>
      <section id={OWNER_SIGNED_SECTION_ID} aria-label="Signed deliverables">
        <h2 className="owner-sub">What your accountant signed</h2>
        {signed.length ? (
          <div className="owner-promises">
            {signed.map((row) => (
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
        ) : (
          <p className="owner-lede">Invite your accountant to sign off.</p>
        )}
      </section>
      <h2 className="owner-sub">Uploads</h2>
      {uploads}
      <button type="button" className="btn gold owner-ask owner-ask-inline" onClick={onConnect}>
        Connect your books
      </button>
    </section>
  );
}

export function OwnerPlan({
  visitor,
  accountantOnMilon,
  firmName,
  billing = { kind: "pending" },
  subscribeBusy = false,
  onSubscribe,
  onInvite,
  checkoutNotice = null,
}: {
  visitor: OwnerVisitor | null;
  accountantOnMilon: boolean;
  firmName: string | null;
  billing?: OwnerSubscribeView;
  subscribeBusy?: boolean;
  onSubscribe?: () => void;
  /** Opens the Accountant portal invite. */
  onInvite?: () => void;
  checkoutNotice?: "success" | "cancel" | null;
}) {
  return (
    <section className="owner-pane" data-owner-page="plan">
      <h1 className="owner-title">Plan</h1>
      <article className="owner-plan-card">
        <p className="owner-plan">{ownerPlanLine({ visitor, accountantOnMilon, firmName })}</p>
        <h2>What you get</h2>
        <ul className="owner-plan-benefits">
          {OWNER_PLAN_BENEFITS.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <OwnerSubscribe
          view={billing}
          busy={subscribeBusy}
          notice={checkoutNotice}
          onSubscribe={onSubscribe}
        />
        {billing.kind === "subscribe" ? (
          <p className="owner-plan-note">
            {OWNER_PLAN_FREE_LINE}
            <button type="button" className="owner-plan-invite" onClick={onInvite}>
              {OWNER_PLAN_INVITE_LABEL}
            </button>
          </p>
        ) : null}
      </article>
    </section>
  );
}

export function OwnerSettings({
  visitor,
  accountantOnMilon,
  firmName,
  onProfile,
  onQuickBooks,
  onXero,
  onBack,
  onAccount,
  billing = { kind: "pending" },
  subscribeBusy = false,
  onSubscribe,
}: {
  visitor: OwnerVisitor | null;
  accountantOnMilon: boolean;
  firmName: string | null;
  onProfile: () => void;
  onQuickBooks: () => void;
  onXero: () => void;
  onBack: () => void;
  onAccount?: () => void;
  billing?: OwnerSubscribeView;
  subscribeBusy?: boolean;
  onSubscribe?: () => void;
}) {
  return (
    <section className="owner-pane" data-owner-page="settings">
      <button type="button" className="owner-back" onClick={onBack}>
        Back
      </button>
      <h1 className="owner-title">Settings</h1>
      <p className="owner-lede">Plan, appearance, profile, and book connections.</p>
      <section className="owner-settings-block">
        <h2>Plan</h2>
        <p className="owner-plan">{ownerPlanLine({ visitor, accountantOnMilon, firmName })}</p>
        <OwnerSubscribe view={billing} busy={subscribeBusy} onSubscribe={onSubscribe} />
      </section>
      <section className="owner-settings-block">
        <h2>Theme</h2>
        <div className="owner-settings-theme">
          <ThemeToggle />
          <span>Light or dark</span>
        </div>
      </section>
      <section className="owner-settings-block">
        <h2>Profile</h2>
        <button type="button" className="owner-btn-secondary" onClick={onProfile}>
          Business profile
        </button>
      </section>
      <section className="owner-settings-block">
        <h2>Connections</h2>
        <div className="owner-first-actions">
          <button type="button" className="btn gold owner-ask" onClick={onQuickBooks}>
            Connect QuickBooks
          </button>
          <button type="button" className="owner-btn-secondary owner-ask" onClick={onXero}>
            Connect Xero
          </button>
        </div>
      </section>
      {onAccount ? (
        <button type="button" className="owner-btn-tertiary" onClick={onAccount}>
          Account and legal
        </button>
      ) : null}
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
        <button type="button" className="btn gold owner-ask" onClick={onQuickBooks}>
          Connect QuickBooks
        </button>
        <button type="button" className="owner-btn-secondary owner-ask" onClick={onXero}>
          Connect Xero
        </button>
      </div>
      {joined ? null : (
        <>
          <p className="owner-free">{ownerPlanFreeLine()}</p>
          <button
            type="button"
            className="owner-btn-tertiary owner-ask owner-ask-inline"
            onClick={onInvite}
          >
            Invite your accountant
          </button>
        </>
      )}
    </section>
  );
}
