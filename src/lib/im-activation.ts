/**
 * Activation plan from a confirmed practice map. Pure. Nothing is sent
 * and nothing is written to a ledger.
 */
import type { CapabilityManifest } from "@/lib/im-capability-manifest.ts";
import { matchCapability } from "@/lib/im-capability-manifest.ts";
import {
  classifyPracticeStep,
  type PracticeGapBucket,
  type PracticeImplementationPlan,
  type PracticePlanStep,
} from "@/lib/setup-partner-plan.ts";

export type PilotClient = {
  id: string;
  name: string;
  ledger: "xero" | "qbo" | "sage" | null;
  hasUpload: boolean;
};

export type RoutineStep = {
  title: string;
  botOwner: string;
  approval: boolean;
  /** Drafts stay here. This planner never marks a step sent. */
  sent: false;
};

export type RoutineMap = {
  id: "document_chase" | "monthly_pack" | "deadline_watch";
  title: string;
  /** Deadline watch is reminders. It never files a return. */
  filing: false;
  steps: RoutineStep[];
};

export type ActivationTask = {
  title: string;
  clientId: string;
  botOwner: string;
  approval: boolean;
  sent: false;
};

export type FirstValue = {
  kind: "management_pack" | "document_chase";
  clientId: string;
  title: string;
  sent: false;
};

export type ActivationPlan = {
  plan: PracticeImplementationPlan;
  checklist: string[];
  pilots: Array<PilotClient & { editable: true }>;
  tasks: ActivationTask[];
  routines: RoutineMap[];
  firstValue: FirstValue | null;
  /** Partner estimate times completed runs. Blank when either number is missing. */
  hoursSaved: number | null;
};

const FILING_RE = /\b(sars|e-?filing|submit(?:ted)? to|file the return)\b/i;
const TAX_WORK_RE = /\b(vat|emp\d*|provisional|annual return|sales tax return)\b/i;
const REMINDER_RE = /\b(remind|deadline|due date)\b/i;

export function hoursSaved(
  partnerEstimate: number | null | undefined,
  completedRuns: number | null | undefined,
): number | null {
  if (typeof partnerEstimate !== "number" || !Number.isFinite(partnerEstimate) || partnerEstimate < 0) {
    return null;
  }
  if (typeof completedRuns !== "number" || !Number.isFinite(completedRuns) || completedRuns < 0) {
    return null;
  }
  return partnerEstimate * completedRuns;
}

/** Manifest match wins. A lone "desktop" does not make a covered deadline bespoke. */
export function classifyWithManifest(step: string, manifest: CapabilityManifest): PracticePlanStep {
  const text = step.replace(/\s+/g, " ").trim();
  const withoutDesktop = text.replace(/\bdesktops?\b/gi, " ");
  const base = classifyPracticeStep(withoutDesktop);
  if (FILING_RE.test(text) || (TAX_WORK_RE.test(text) && !REMINDER_RE.test(text))) {
    const gap = classifyPracticeStep(text.replace(/\bdesktops?\b/gi, " "));
    return { ...gap, bucket: "product_gap", step: text };
  }
  const hit = matchCapability(text, manifest);
  if (hit && (base.bucket === "bespoke" || hit.kind === "tool")) {
    return {
      ...base,
      step: text,
      bucket: "covered",
      capability: hit.agent,
      step_type: hit.id,
      covers: hit.label,
      fit_note: `Already in Milōn: ${hit.label}.`,
    };
  }
  if (base.bucket !== "bespoke") return { ...base, step: text };
  return classifyPracticeStep(text);
}

function ownerFor(step: PracticePlanStep, manifest: CapabilityManifest): string {
  const hit = matchCapability(step.step, manifest);
  if (hit?.agent) return hit.agent;
  if (step.capability === "advisor" || step.step_type === "deadlines") return "advisor";
  if (step.capability === "analyst" || step.step_type === "client_reporting") return "analyst";
  return manifest.agents.includes("financial_manager") ? "financial_manager" : manifest.agents[0] ?? "financial_manager";
}

function routine(input: {
  id: RoutineMap["id"];
  title: string;
  steps: Array<{ title: string; botOwner: string; approval?: boolean }>;
}): RoutineMap {
  return {
    id: input.id,
    title: input.title,
    filing: false,
    steps: input.steps.map((step) => ({
      title: step.title,
      botOwner: step.botOwner,
      approval: Boolean(step.approval),
      sent: false as const,
    })),
  };
}

export function suggestPilots(clients: readonly PilotClient[]): Array<PilotClient & { editable: true }> {
  const ready = clients.filter((client) => client.ledger != null || client.hasUpload);
  const count = ready.length >= 3 ? 3 : ready.length;
  return ready.slice(0, count).map((client) => ({ ...client, editable: true as const }));
}

export function planActivation(input: {
  plan: PracticeImplementationPlan;
  clients: readonly PilotClient[];
  manifest: CapabilityManifest;
  partnerHoursEstimate?: number | null;
  completedRuns?: number | null;
}): ActivationPlan {
  const pilots = suggestPilots(input.clients);
  const pilot = pilots[0] ?? null;
  const ledgers = new Set(input.clients.map((client) => client.ledger).filter((ledger) => ledger != null));
  const checklist: string[] = [];
  if (ledgers.size > 1) checklist.push("Which ledger does each pilot use?");
  checklist.push("Who reviews the pack before it is approved?");
  checklist.push("Accountant approves each draft before anything is sent.");
  for (const step of input.plan.steps) {
    if (step.bucket !== "client_setup") continue;
    if (checklist.some((line) => line.toLowerCase() === step.step.toLowerCase())) continue;
    checklist.push(step.step);
  }

  const pack = input.plan.steps.find((step) => /pack|report/i.test(step.step));
  const firstKind: FirstValue["kind"] = pack ? "management_pack" : "document_chase";
  const firstValue: FirstValue | null = pilot
    ? {
        kind: firstKind,
        clientId: pilot.id,
        title: firstKind === "management_pack" ? "Management pack draft" : "Document chase draft",
        sent: false,
      }
    : null;

  const tasks: ActivationTask[] = [];
  if (pilot) {
    for (const step of input.plan.steps) {
      if (step.bucket === "bespoke") continue;
      tasks.push({
        title: step.step,
        clientId: pilot.id,
        botOwner: ownerFor(step, input.manifest),
        approval: step.bucket === "client_setup" || /review|sign/i.test(step.step),
        sent: false,
      });
    }
    if (tasks.length === 0) {
      tasks.push({
        title: firstValue?.title ?? "Document chase draft",
        clientId: pilot.id,
        botOwner: "financial_manager",
        approval: true,
        sent: false,
      });
    }
  }

  const routines: RoutineMap[] = [
    routine({
      id: "document_chase",
      title: "Document chase",
      steps: [
        { title: "Draft the document request", botOwner: "financial_manager" },
        { title: "Accountant approves the chase draft", botOwner: "financial_manager", approval: true },
      ],
    }),
    routine({
      id: "monthly_pack",
      title: "Monthly pack",
      steps: [
        { title: "Draft the management pack", botOwner: "analyst" },
        { title: "Check the pack figures", botOwner: "financial_manager" },
        { title: "Accountant approves the pack draft", botOwner: "analyst", approval: true },
      ],
    }),
  ];
  if (input.plan.steps.some((step) => REMINDER_RE.test(step.step))) {
    routines.push(
      routine({
        id: "deadline_watch",
        title: "Deadline reminders",
        steps: [
          { title: "Draft a reminder for the partner", botOwner: "advisor" },
          { title: "Accountant approves the reminder", botOwner: "advisor", approval: true },
        ],
      }),
    );
  }

  return {
    plan: input.plan,
    checklist,
    pilots,
    tasks,
    routines,
    firstValue,
    hoursSaved: hoursSaved(input.partnerHoursEstimate, input.completedRuns),
  };
}

export function bucketOf(step: PracticePlanStep): PracticeGapBucket {
  return step.bucket;
}
