/**
 * Activation planner — partner checklist, first-value milestone, and routine
 * maps from a confirmed plan plus the capability manifest. Pure functions only.
 */
import {
  buildCapabilityManifest,
  manifestBotForCapability,
  type ImCapabilityManifest,
} from "./im-capability-manifest.ts";
import type { PracticeImplementationPlan, PracticePlanStep } from "./setup-partner-plan.ts";
import { classifyPracticeStep } from "./setup-partner-plan.ts";
import type { ImReplayFixtureMeta } from "./im-replay.ts";
import type { SetupPartnerCountry } from "./setup-partner.ts";
import { FINANCE_DEADLINE_SIGNALS } from "./im-capability-manifest.ts";

export type ImPilotClient = {
  id: string;
  name: string;
  hasLedger: boolean;
  hasUpload: boolean;
};

export type ImApprovalGate = {
  kind: "human_send" | "human_ledger_post";
  description: string;
  sends: false;
};

export type ImRoutineMapStep = {
  id: string;
  title: string;
  botOwner: string;
  trigger: string;
  cadence: string;
  approvalGate: ImApprovalGate;
  sends: false;
};

export type ImRoutineKind =
  | "document_chase"
  | "monthly_pack"
  | "cash_debtor_early_warning"
  | "budget_actual_drift"
  | "tax_deadline_watch";

export type ImRoutineMap = {
  kind: "routine_map";
  routine: ImRoutineKind;
  tags: string[];
  steps: ImRoutineMapStep[];
};

export type ImFirstValueMilestone = {
  kind: "monthly_pack_draft" | "document_chase_draft";
  pilotClientId: string;
  title: string;
  sent: false;
  approvalGate: ImApprovalGate;
};

export type ImActivationPlan = {
  partnerChecklist: string[];
  firstValueMilestone: ImFirstValueMilestone;
  routineMaps: ImRoutineMap[];
  hoursSavedEstimate: number | null;
  /** Ready to persist later as client_artifacts + action_items tags. */
  artifactShape: {
    kind: "routine_map";
    tagged: readonly ["action_items", "routine_map"];
  };
};

const SEND_GATE: ImApprovalGate = {
  kind: "human_send",
  description: "Accountant reviews and sends. Milōn prepares drafts only.",
  sends: false,
};

const LEDGER_GATE: ImApprovalGate = {
  kind: "human_ledger_post",
  description: "Ledger posting only after a named accountant approves in the log.",
  sends: false,
};

export function pickPilotClients(clients: readonly ImPilotClient[], count = 3): ImPilotClient[] {
  const preferred = clients.filter((row) => row.hasLedger || row.hasUpload);
  const pool = preferred.length ? preferred : clients;
  return pool.slice(0, Math.max(2, Math.min(count, 3, pool.length)));
}

function botOwnerForStep(step: PracticePlanStep, manifest: ImCapabilityManifest): string {
  if (step.bucket === "covered") {
    return manifestBotForCapability(manifest, step.capability);
  }
  if (/\b(tax|vat|emp201|provisional)\b/i.test(step.step)) return "Tax Specialist";
  if (/\b(chase|documents?|receipts?|invoices?)\b/i.test(step.step)) return "Financial Manager";
  if (/\b(report|management)\b/i.test(step.step)) return "Analyst";
  return manifestBotForCapability(manifest, step.capability);
}

function triggerForStep(step: PracticePlanStep, routine: ImRoutineMap["routine"]): string {
  if (routine === "document_chase") {
    return /\bmonth\b/i.test(step.step) ? "month_end_pack_missing" : "missing_source_docs";
  }
  return "calendar_month_end";
}

function cadenceForStep(step: PracticePlanStep): string {
  if (/\bweekly\b/i.test(step.step)) return "weekly";
  if (/\bannual\b/i.test(step.step)) return "annual";
  return "monthly";
}

function approvalForStep(step: PracticePlanStep): ImApprovalGate {
  if (/\b(ledger|books|sage|xero|quickbooks|qbo)\b/i.test(step.step)) return LEDGER_GATE;
  return SEND_GATE;
}

function routineSteps(
  steps: readonly PracticePlanStep[],
  routine: ImRoutineMap["routine"],
  manifest: ImCapabilityManifest,
): ImRoutineMapStep[] {
  const picked =
    routine === "document_chase"
      ? steps.filter((step) =>
          /\b(chase|documents?|receipts?|invoices?|missing)\b/i.test(step.step),
        )
      : steps.filter((step) =>
          /\b(month-?end|management report|close pack|monthly pack|bookkeeping)\b/i.test(step.step),
        );
  const source = picked.length ? picked : steps.slice(0, 4);
  return source.map((step, index) => ({
    id: `${routine}-${index + 1}`,
    title: step.step,
    botOwner: botOwnerForStep(step, manifest),
    trigger: triggerForStep(step, routine),
    cadence: cadenceForStep(step),
    approvalGate: approvalForStep(step),
    sends: false as const,
  }));
}

const CASH_DEBTOR_MAP: ImRoutineMap = {
  kind: "routine_map",
  routine: "cash_debtor_early_warning",
  tags: ["action_items", "routine_map", "cash_debtor_early_warning"],
  steps: [
    {
      id: "cash_debtor_early_warning-1",
      title: "Detect cash or collections pressure from ledger data",
      botOwner: "Analyst",
      trigger: "event_cash_collections_risk",
      cadence: "monthly",
      approvalGate: SEND_GATE,
      sends: false,
    },
    {
      id: "cash_debtor_early_warning-2",
      title: "Draft collection or cash action (unsent)",
      botOwner: "Financial Manager",
      trigger: "event_prior_step_succeeded",
      cadence: "monthly",
      approvalGate: SEND_GATE,
      sends: false,
    },
    {
      id: "cash_debtor_early_warning-3",
      title: "Accountant approves before anything is sent",
      botOwner: "Accountant",
      trigger: "human_approval_gate",
      cadence: "monthly",
      approvalGate: SEND_GATE,
      sends: false,
    },
  ],
};

const TAX_DEADLINE_WATCH_MAP: ImRoutineMap = {
  kind: "routine_map",
  routine: "tax_deadline_watch",
  tags: ["action_items", "routine_map", "tax_deadline_watch"],
  steps: [
    {
      id: "tax_deadline_watch-1",
      title: "Watch VAT201, EMP201, provisional and annual tax deadlines (draft for review)",
      botOwner: "Tax Specialist",
      trigger: "event_tax_deadline_approaching",
      cadence: "monthly",
      approvalGate: SEND_GATE,
      sends: false,
    },
    {
      id: "tax_deadline_watch-2",
      title: "Draft workings or checklist for the accountant from Milōn data (draft for review)",
      botOwner: "Tax Specialist",
      trigger: "event_prior_step_succeeded",
      cadence: "monthly",
      approvalGate: SEND_GATE,
      sends: false,
    },
    {
      id: "tax_deadline_watch-3",
      title: "Draft unsent reminder — no SARS filing or login (draft for review)",
      botOwner: "Tax Specialist",
      trigger: "event_prior_step_succeeded",
      cadence: "monthly",
      approvalGate: SEND_GATE,
      sends: false,
    },
    {
      id: "tax_deadline_watch-4",
      title: "Accountant reviews before anything is sent",
      botOwner: "Accountant",
      trigger: "human_approval_gate",
      cadence: "monthly",
      approvalGate: SEND_GATE,
      sends: false,
    },
  ],
};

const BUDGET_DRIFT_MAP: ImRoutineMap = {
  kind: "routine_map",
  routine: "budget_actual_drift",
  tags: ["action_items", "routine_map", "budget_actual_drift"],
  steps: [
    {
      id: "budget_actual_drift-1",
      title: "Flag budget versus actual drift",
      botOwner: "Analyst",
      trigger: "event_budget_drift_check",
      cadence: "monthly",
      approvalGate: SEND_GATE,
      sends: false,
    },
    {
      id: "budget_actual_drift-2",
      title: "Draft commentary on the drift (unsent)",
      botOwner: "Advisor",
      trigger: "event_prior_step_succeeded",
      cadence: "monthly",
      approvalGate: SEND_GATE,
      sends: false,
    },
    {
      id: "budget_actual_drift-3",
      title: "Accountant reviews before anything is sent",
      botOwner: "Accountant",
      trigger: "human_approval_gate",
      cadence: "monthly",
      approvalGate: SEND_GATE,
      sends: false,
    },
  ],
};

function planHasFinanceTaxDeadlines(steps: readonly PracticePlanStep[]): boolean {
  return steps.some(
    (row) =>
      FINANCE_DEADLINE_SIGNALS.test(row.step) ||
      /\b(vat201|emp201|provisional|itr14|itr12|annual return)\b/i.test(row.step),
  );
}

export function buildRoutineMaps(
  plan: PracticeImplementationPlan,
  manifest: ImCapabilityManifest,
  country?: SetupPartnerCountry | null,
): ImRoutineMap[] {
  const steps = plan.steps.map((row) => classifyPracticeStep(row.step, { manifest }));
  const maps: ImRoutineMap[] = [
    {
      kind: "routine_map",
      routine: "document_chase",
      tags: ["action_items", "routine_map", "document_chase"],
      steps: routineSteps(steps, "document_chase", manifest),
    },
    {
      kind: "routine_map",
      routine: "monthly_pack",
      tags: ["action_items", "routine_map", "monthly_pack"],
      steps: routineSteps(steps, "monthly_pack", manifest),
    },
    CASH_DEBTOR_MAP,
    BUDGET_DRIFT_MAP,
  ];
  if (country === "ZA" && planHasFinanceTaxDeadlines(steps)) {
    maps.push(TAX_DEADLINE_WATCH_MAP);
  }
  return maps;
}

export function buildFirstValueMilestone(
  plan: PracticeImplementationPlan,
  pilots: readonly ImPilotClient[],
): ImFirstValueMilestone {
  const pilot = pilots[0];
  const monthly = plan.steps.some((step) =>
    /\b(month-?end|management report|monthly pack)\b/i.test(step.step),
  );
  const chase = plan.steps.some((step) => /\b(chase|missing documents?)\b/i.test(step.step));
  const kind = monthly || !chase ? "monthly_pack_draft" : "document_chase_draft";
  const title =
    kind === "monthly_pack_draft"
      ? "First monthly pack draft on a pilot client (unsent)"
      : "First document-chase draft on a pilot client (unsent)";
  return {
    kind,
    pilotClientId: pilot?.id ?? "pilot-unset",
    title,
    sent: false,
    approvalGate: SEND_GATE,
  };
}

/** Start integration chooses the clients. The checklist states that count. */
export function partnerPilotChecklistLine(count: number): string {
  if (count <= 0) return "Add a client, then start integration.";
  if (count === 1) return "Milōn starts the first drafts on one client.";
  return `Milōn starts the first drafts on ${Math.min(3, count)} clients.`;
}

export function buildPartnerChecklist(
  pilots: readonly ImPilotClient[],
  meta?: ImReplayFixtureMeta | null,
): string[] {
  const lines = [
    "Confirm Implementation Manager plan is saved.",
    partnerPilotChecklistLine(pilots.length),
    ...pilots.map(
      (row) => `Pilot: ${row.name}${row.hasLedger || row.hasUpload ? " (books on file)" : ""}`,
    ),
    "Review first monthly pack or document-chase draft before anything is sent.",
    "Log who approves any ledger posting on pilot clients.",
  ];
  if (meta?.hours_saved_estimate != null) {
    lines.push(`Partner hours-saved estimate on file: ${meta.hours_saved_estimate}.`);
  }
  return lines;
}

export function buildActivationPlan(input: {
  plan: PracticeImplementationPlan;
  country?: SetupPartnerCountry | null;
  pilots: readonly ImPilotClient[];
  meta?: ImReplayFixtureMeta | null;
  manifest?: ImCapabilityManifest;
}): ImActivationPlan {
  const manifest = input.manifest ?? buildCapabilityManifest(input.country);
  const pilots = pickPilotClients(input.pilots);
  const routineMaps = buildRoutineMaps(input.plan, manifest, input.country);
  return {
    partnerChecklist: buildPartnerChecklist(pilots, input.meta),
    firstValueMilestone: buildFirstValueMilestone(input.plan, pilots),
    routineMaps,
    hoursSavedEstimate:
      input.meta?.hours_saved_estimate === undefined ? null : input.meta.hours_saved_estimate,
    artifactShape: { kind: "routine_map", tagged: ["action_items", "routine_map"] },
  };
}

export function activationPlanSendsNothing(plan: ImActivationPlan): boolean {
  if (plan.firstValueMilestone.sent) return false;
  return plan.routineMaps.every((map) =>
    map.steps.every((step) => step.sends === false && step.approvalGate.sends === false),
  );
}

export function activationStepsHaveOwners(plan: ImActivationPlan): boolean {
  return plan.routineMaps.every(
    (map) => map.steps.length > 0 && map.steps.every((step) => step.botOwner.trim().length > 0),
  );
}
