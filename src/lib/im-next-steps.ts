/**
 * Ordered next steps at the end of the Implementation Manager interview.
 * Progress is a list of step ids. No network and no storage.
 */

export type ImNextStepKind = "link" | "start";

export type ImNextStep = {
  id: string;
  title: string;
  button: string;
  kind: ImNextStepKind;
  href: string | null;
};

export type ImNextStepRow = {
  playId: string;
  section: "lead" | "already_covered";
  actionHref: string;
};

const STEP_ORDER = [
  "monthly-client-update",
  "document-collection",
  "diagnose",
  "management-pack",
  "cash-flow",
  "profit-waterfall",
  "budget",
  "action-plan",
  "tax-deadlines",
] as const;

const CLIENT_ID = /\/clients\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function clientIdFrom(href: string): string {
  return CLIENT_ID.exec(href)?.[1] ?? "";
}

function clientPath(id: string, search: string): string {
  return id ? `/clients/${id}?${search}` : "/clients";
}

/** First step that is not marked done. Null when every step is done. */
export function nextUndoneStep<T extends { id: string }>(
  steps: readonly T[],
  doneIds: readonly string[],
): T | null {
  const done = new Set(doneIds);
  return steps.find((step) => !done.has(step.id)) ?? null;
}

export function markStepDone(doneIds: readonly string[], id: string): string[] {
  if (!id || doneIds.includes(id)) return [...doneIds];
  return [...doneIds, id];
}

export function parseDoneIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { done?: unknown };
    if (!Array.isArray(parsed.done)) return [];
    return parsed.done.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function imStepStorageKey(firmId: string, planKey: string): string {
  return `milon-im-next-steps:${firmId}:${planKey}`;
}

export function buildImNextSteps(input: {
  rows: readonly ImNextStepRow[];
  integrationStarted: boolean;
  sendAgentAllowed: boolean;
}): ImNextStep[] {
  const lead = new Map(
    input.rows.filter((row) => row.section === "lead" && row.playId).map((row) => [row.playId, row]),
  );
  const steps: ImNextStep[] = [];
  for (const id of STEP_ORDER) {
    const row = lead.get(id);
    if (!row) continue;
    const clientId = clientIdFrom(row.actionHref);
    if (id === "monthly-client-update" && !input.integrationStarted) {
      steps.push({
        id,
        title: "Set the month-end client update",
        button: "Start integration, then set the month-end client update",
        kind: "start",
        href: null,
      });
      continue;
    }
    if (id === "monthly-client-update") {
      steps.push({
        id,
        title: "Set the month-end client update",
        button: "Set the month-end client update",
        kind: "link",
        href: clientPath(clientId, "tab=portal&section=routines"),
      });
      continue;
    }
    if (id === "document-collection" && !input.sendAgentAllowed) {
      steps.push({
        id,
        title: "Ask the Financial Manager to draft a document request",
        button: "Ask the Financial Manager",
        kind: "link",
        href: clientPath(clientId, "tab=home&agent=financial_manager"),
      });
      continue;
    }
    const href =
      id === "document-collection"
        ? clientPath(clientId, "tab=portal&section=send-agent")
        : id === "diagnose"
          ? clientPath(clientId, "tab=health")
          : id === "management-pack"
            ? clientPath(clientId, "tab=reports&section=drafts")
            : id === "cash-flow"
              ? clientPath(clientId, "report=forecast&action=preview")
              : id === "profit-waterfall"
                ? clientPath(clientId, "tab=profit&section=waterfall")
                : id === "budget"
                  ? clientPath(clientId, "tab=budget")
                  : id === "action-plan"
                    ? clientPath(clientId, "tab=plan&section=open")
                    : clientPath(clientId, "tab=tax");
    const title =
      id === "document-collection"
        ? "Send an agent to collect the bank statements"
        : id === "diagnose"
          ? "Open Diagnose"
          : id === "management-pack"
            ? "Open the Management Report"
            : id === "cash-flow"
              ? "Run the cash-flow report"
              : id === "profit-waterfall"
                ? "Open the profit waterfall"
                : id === "budget"
                  ? "Open budget versus actual"
                  : id === "action-plan"
                    ? "Open the action plan"
                    : "Open the tax drafts";
    steps.push({ id, title, button: title, kind: "link", href });
  }
  return steps;
}
