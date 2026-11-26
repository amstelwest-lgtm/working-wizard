/**
 * One real next step per integration-plan play. Routes are the ones the
 * client file already serves. Nothing here sends, posts, or files.
 */
import { IM_PLAN_APPROVE } from "./im-solution-plays.ts";

export type PlanClient = { id: string; name: string };

export type PlanActionCopy = {
  actionLabel: string;
  actionHref: string;
  actionPrompt: string;
  actionApprove: string;
  clientName: string;
};

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ActionSeed = {
  label: (name: string) => string;
  openLabel: string;
  path: (id: string) => string;
  prompt: (name: string) => string;
  approve: string;
};

const SEEDS: Record<string, ActionSeed> = {
  "monthly-client-update": {
    label: (name) => `Set up a scheduled client update draft for ${name} every month-end`,
    openLabel: "Open a client and set up a scheduled client update draft",
    path: (id) => `/clients/${id}?tab=portal&section=routines`,
    prompt: (name) =>
      `Draft the month-end client update for ${name}. Leave it unsent for me to approve.`,
    approve: IM_PLAN_APPROVE,
  },
  "document-collection": {
    label: (name) => `Send an agent to collect ${name}'s bank statements`,
    openLabel: "Open a client and send an agent to collect the bank statements",
    path: (id) => `/clients/${id}?tab=portal&section=send-agent`,
    prompt: (name) =>
      `Collect the latest bank statements from ${name}. Save an unsent draft for me to approve.`,
    approve:
      "You approve the document request before the link is sent. Nothing goes out on its own.",
  },
  diagnose: {
    label: (name) => `Open Diagnose for ${name}`,
    openLabel: "Open a client and open Diagnose",
    path: (id) => `/clients/${id}?tab=health`,
    prompt: () => "",
    approve: "You review the diagnosis. Nothing is sent.",
  },
  "management-pack": {
    label: (name) => `Open the Management Report for ${name}`,
    openLabel: "Open a client and open the Management Report",
    path: (id) => `/clients/${id}?tab=reports&section=drafts`,
    prompt: () => "",
    approve: "You sign off the PDF before a client sees it.",
  },
  "cash-flow": {
    label: (name) => `Run the cash-flow report on ${name} now`,
    openLabel: "Open a client and run the cash-flow report",
    path: (id) => `/clients/${id}?report=forecast&action=preview`,
    prompt: () => "",
    approve: "You review the forecast. Nothing is posted to a ledger.",
  },
  "profit-waterfall": {
    label: (name) => `Open the profit waterfall for ${name}`,
    openLabel: "Open a client and open the profit waterfall",
    path: (id) => `/clients/${id}?tab=profit&section=waterfall`,
    prompt: () => "",
    approve: "You review the profit story. Nothing is sent.",
  },
  budget: {
    label: (name) => `Open budget versus actual for ${name}`,
    openLabel: "Open a client and open budget versus actual",
    path: (id) => `/clients/${id}?tab=budget`,
    prompt: () => "",
    approve: "You review the drift. Nothing is posted to a ledger.",
  },
  "action-plan": {
    label: (name) => `Open the action plan for ${name}`,
    openLabel: "Open a client and open the action plan",
    path: (id) => `/clients/${id}?tab=plan&section=open`,
    prompt: () => "",
    approve: "You approve the owners and dates before the client sees the list.",
  },
  "tax-deadlines": {
    label: (name) => `Open the tax drafts for ${name}`,
    openLabel: "Open a client and open the tax drafts",
    path: (id) => `/clients/${id}?tab=tax`,
    prompt: () => "",
    approve: "You review the reminder and any ready draft. Nothing is filed.",
  },
};

export function planClientName(name: string): string {
  const clean = name
    .replace(/[\u0000-\u001f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return clean || "this client";
}

function safeClientId(client?: PlanClient | null): string {
  const id = client?.id?.trim() ?? "";
  return CLIENT_ID.test(id) ? id : "";
}

export function planActionFor(playId: string, client?: PlanClient | null): PlanActionCopy {
  const seed = SEEDS[playId];
  const id = safeClientId(client);
  if (!seed) {
    return {
      actionLabel: "Open a client and pick the next step",
      actionHref: "/clients",
      actionPrompt: "",
      actionApprove: "You approve each draft before it is sent. Nothing is posted or filed.",
      clientName: "",
    };
  }
  if (!id) {
    return {
      actionLabel: seed.openLabel,
      actionHref: "/clients",
      actionPrompt: "",
      actionApprove: seed.approve,
      clientName: "",
    };
  }
  const name = planClientName(client?.name ?? "");
  return {
    actionLabel: seed.label(name),
    actionHref: seed.path(id),
    actionPrompt: seed.prompt(name),
    actionApprove: seed.approve,
    clientName: name,
  };
}

/** Client library, where a per-client rule is added. */
export function rulesActionFromHref(href: string | undefined): { href: string; label: string } {
  const id = /\/clients\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
    href ?? "",
  )?.[1];
  if (!id) return { href: "/clients", label: "Open a client and add a rule" };
  return {
    href: `/clients/${id}?tab=portal&section=documents`,
    label: "Add a rule for this client",
  };
}

export function stampPlanActions<T extends { playId: string }>(
  rows: readonly T[],
  client?: PlanClient | null,
): Array<T & PlanActionCopy> {
  return rows.map((row) => ({ ...row, ...planActionFor(row.playId, client) }));
}
