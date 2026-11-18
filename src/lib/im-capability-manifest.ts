/**
 * Implementation Manager capability manifest — generated from agent tool lists,
 * Milōn coverage, and ledger/upload connectors. Classifiers read this manifest;
 * nothing here is a second handwritten catalogue.
 */
import {
  ADVISOR_TOOL_LABELS,
  ADVISOR_TOOLS,
} from "./agent-advisor.ts";
import {
  ANALYST_TOOL_LABELS,
  ANALYST_TOOLS,
} from "./agent-analyst.ts";
import {
  FM_TOOL_LABELS,
  FM_TOOLS,
  type FmToolName,
} from "./agent-financial-manager.ts";
import { SHARED_DELIVERABLE_TOOL_LABELS } from "./agent-shared-reads.ts";
/** Kept inline so Deno edge checks do not pull `connections-library-upload.ts`. */
const LIBRARY_UPLOAD_ACCEPT = ".pdf,.csv,.xlsx,.xls,.xlsm";
import { setupPartnerCoverage, type SetupPartnerCountry } from "./setup-partner.ts";
import type { PracticeGapBucket, PracticeGapEffort, PracticePlanStep } from "./setup-partner-plan.ts";
import { practiceGapSlug } from "./setup-partner-plan.ts";

export type ImConnectorKind = "ledger" | "upload";

export type ImConnector = {
  id: string;
  label: string;
  kind: ImConnectorKind;
  detail?: string;
};

export type ImAgentCapability = {
  agentKey: string;
  displayName: string;
  owns: string;
  tools: string[];
};

export type ImStepClassifier = {
  re: RegExp;
  capability: string;
  stepType: string;
  bucket: PracticeGapBucket;
  covers: string;
  effort: PracticeGapEffort;
  fitNote: string;
  /** Higher runs before bespoke signals such as “desktop”. */
  priority: number;
};

export type ImCapabilityManifest = {
  agents: ImAgentCapability[];
  connectors: ImConnector[];
  classifiers: ImStepClassifier[];
  bespokeSignals: RegExp;
  financeDeadlineSignals: RegExp;
};

export type ImCapabilityRegistryOverride = {
  extraAgentTools?: readonly { agentKey: string; tool: string; label?: string }[];
  extraClassifiers?: readonly ImStepClassifier[];
};

const TAX_READ_TOOLS = ["list_tax_drafts", "get_tax_draft", "list_tax_packs", "get_tax_pack"] as const;

const BASE_PRODUCT_GAPS: readonly Omit<ImStepClassifier, "fitNote" | "priority">[] = [
  {
    re: /\bpayroll\b/i,
    capability: "payroll",
    stepType: "payroll",
    bucket: "product_gap",
    covers: "Payroll journals",
    effort: "M",
  },
  {
    re: /\b(inventory|stock count)\b/i,
    capability: "inventory",
    stepType: "inventory",
    bucket: "product_gap",
    covers: "Inventory",
    effort: "L",
  },
  {
    re: /\b(consolidat|multi-entity|intercompany)\b/i,
    capability: "consolidation",
    stepType: "consolidation",
    bucket: "product_gap",
    covers: "Multi-entity consolidation",
    effort: "L",
  },
  {
    re: /\b(time tracking|engagement letter|\bwip\b)\b/i,
    capability: "practice-ops",
    stepType: "practice_ops",
    bucket: "product_gap",
    covers: "Practice operations",
    effort: "M",
  },
  {
    re: /\bdirect debit\b/i,
    capability: "collections",
    stepType: "direct_debit",
    bucket: "product_gap",
    covers: "Direct debit collection",
    effort: "M",
  },
];

/** Step patterns tied to Financial Manager tools in FM_TOOLS — no test override hook. */
const FM_TOOL_CLASSIFIERS: Partial<
  Record<FmToolName, Omit<ImStepClassifier, "fitNote" | "priority">>
> = {
  get_cash_13_week: {
    re: /\b13-?week cash(?:\s+forecast)?\b|\b(?:cash(?:\s*flow)?|cashflow)\s+forecast(?:s|ing)?\b|\bforecasting\s+cash(?:\s*flow)?\b/i,
    capability: "financial-manager",
    stepType: "cash_forecast",
    bucket: "covered",
    covers: "Financial Manager — 13-week cash forecast",
    effort: "S",
  },
  prepare_client_report: {
    re: /\bprepare client reports?\b/i,
    capability: "financial-manager",
    stepType: "client_report_prepare",
    bucket: "covered",
    covers: "Financial Manager — client report",
    effort: "S",
  },
};

function classifiersFromFmTools(): ImStepClassifier[] {
  const out: ImStepClassifier[] = [];
  for (const tool of FM_TOOLS) {
    const row = FM_TOOL_CLASSIFIERS[tool];
    if (!row) continue;
    out.push({ ...row, fitNote: FIT_COVERED(row.covers), priority: 78 });
  }
  return out;
}

const BASE_COVERED: readonly Omit<ImStepClassifier, "fitNote" | "priority">[] = [
  {
    re: /\b(?:cash(?:\s*flow)?|cashflow)\s+forecast(?:s|ing)?\b|\bforecasting\s+cash(?:\s*flow)?\b/i,
    capability: "financial-manager",
    stepType: "cash_forecast",
    bucket: "covered",
    covers: "Financial Manager — 13-week cash forecast",
    effort: "S",
  },
  {
    re: /\b(month-?end|close pack|books close)\b/i,
    capability: "financial-manager",
    stepType: "month_end_close",
    bucket: "covered",
    covers: "Financial Manager — month-end close pack",
    effort: "S",
  },
  {
    re: /\breview\b/i,
    capability: "financial-manager",
    stepType: "review",
    bucket: "covered",
    covers: "Financial Manager — draft review",
    effort: "S",
  },
  {
    re: /\bsign-?off\b|\bsignoff\b/i,
    capability: "sign-off",
    stepType: "sign_off",
    bucket: "covered",
    covers: "Accountant sign-off",
    effort: "S",
  },
  {
    re: /\b(deadlines?|due dates?|deadline tracking)\b/i,
    capability: "advisor",
    stepType: "deadlines",
    bucket: "covered",
    covers: "Advisor — deadline reminders (draft only)",
    effort: "S",
  },
  {
    re: /\b(client reports?|board reports?|management packs?|management reports?|bookkeeping|cash reporting|profit reporting|cash and profit)\b/i,
    capability: "analyst",
    stepType: "client_reporting",
    bucket: "covered",
    covers: "Analyst — client reporting",
    effort: "S",
  },
  {
    re: /\breconcil/i,
    capability: "financial-manager",
    stepType: "reconciliation",
    bucket: "covered",
    covers: "Financial Manager — bank reconciliation",
    effort: "S",
  },
];

const FIT_COVERED = (covers: string) =>
  `Already in Milōn: ${covers.replace(/\s+—\s+/g, ": ")}.`;
const FIT_GAP = "Fits the universal finance function. Not in Milōn yet.";

const BESPOKE_SIGNALS =
  /\b(desktop|remote desktop|anydesk|teamviewer|screen ?share|whatsapp|bespoke|one-off|one off|custom website|marketing campaign|legal case)\b/i;

const FINANCE_DEADLINE_SIGNALS =
  /\b(deadlines?|due dates?|deadline tracking)\b.*\b(vat|emp201|provisional|tax)\b|\b(vat|emp201|provisional)\b.*\bdeadlines?\b/i;

function toolLabels(tools: readonly string[], labels: Record<string, string>): string[] {
  return tools.map((name) => labels[name] ?? name);
}

function agentsFromCoverage(country?: SetupPartnerCountry | null): ImAgentCapability[] {
  const coverage = setupPartnerCoverage(country);
  const base: ImAgentCapability[] = coverage.map((row) => ({
    agentKey: row.agent.toLowerCase().replace(/\s+/g, "_"),
    displayName: row.agent,
    owns: row.owns,
    tools:
      row.agent === "Financial Manager"
        ? toolLabels(FM_TOOLS, FM_TOOL_LABELS)
        : row.agent === "Analyst"
          ? toolLabels(ANALYST_TOOLS, ANALYST_TOOL_LABELS)
          : row.agent === "Advisor"
            ? toolLabels(ADVISOR_TOOLS, ADVISOR_TOOL_LABELS)
            : row.agent === "Tax Specialist"
              ? toolLabels(TAX_READ_TOOLS, SHARED_DELIVERABLE_TOOL_LABELS)
              : [],
  }));
  return base;
}

const LEDGER_CONNECTORS: ImConnector[] = [
  { id: "xero", label: "Xero", kind: "ledger", detail: "Read-only sync" },
  { id: "qbo", label: "QuickBooks", kind: "ledger", detail: "Read-only sync" },
  { id: "sage", label: "Sage", kind: "ledger", detail: "Read-only sync" },
  {
    id: "library_upload",
    label: "Client library upload",
    kind: "upload",
    detail: LIBRARY_UPLOAD_ACCEPT,
  },
];

function classifiersFromBase(
  rows: readonly Omit<ImStepClassifier, "fitNote" | "priority">[],
  fit: (row: (typeof rows)[number]) => string,
  priority: number,
): ImStepClassifier[] {
  return rows.map((row) => ({
    ...row,
    fitNote: fit(row),
    priority,
  }));
}

/** Build the manifest from live registries, with optional test fixtures layered on. */
export function buildCapabilityManifest(
  country?: SetupPartnerCountry | null,
  override?: ImCapabilityRegistryOverride,
): ImCapabilityManifest {
  const agents = agentsFromCoverage(country);
  if (override?.extraAgentTools?.length) {
    for (const extra of override.extraAgentTools) {
      const row = agents.find((agent) => agent.agentKey === extra.agentKey);
      if (row && !row.tools.includes(extra.tool)) {
        row.tools.push(extra.label ?? extra.tool);
      }
    }
  }

  const classifiers = [
    ...classifiersFromBase(BASE_COVERED, (row) => FIT_COVERED(row.covers), 80),
    ...classifiersFromFmTools(),
    ...classifiersFromBase(BASE_PRODUCT_GAPS, () => FIT_GAP, 40),
    ...(override?.extraClassifiers ?? []),
  ].sort((a, b) => b.priority - a.priority);

  return {
    agents,
    connectors: LEDGER_CONNECTORS,
    classifiers,
    bespokeSignals: BESPOKE_SIGNALS,
    financeDeadlineSignals: FINANCE_DEADLINE_SIGNALS,
  };
}

function cleanStep(step: string): string {
  return step.replace(/\s+/g, " ").trim();
}

export function matchManifestClassifier(
  text: string,
  manifest: ImCapabilityManifest,
): ImStepClassifier | null {
  const clean = cleanStep(text);
  if (!clean) return null;
  for (const row of manifest.classifiers) {
    if (!row.re.test(clean)) continue;
    return row;
  }
  return null;
}

function stepOf(
  step: string,
  input: {
    stepType: string;
    capability: string;
    covers: string;
    bucket: PracticeGapBucket;
    fitNote: string;
    effort: PracticeGapEffort;
  },
): PracticePlanStep {
  return {
    step,
    step_type: input.stepType,
    capability: input.capability,
    covers: input.covers,
    bucket: input.bucket,
    fit_note: input.fitNote,
    effort: input.effort,
    dedupe_key: `${practiceGapSlug(input.capability)}--${practiceGapSlug(input.stepType)}`,
  };
}

/** Manifest-first classification helper used by the practice step classifier. */
export function practicePlanStepFromManifest(step: string, manifest: ImCapabilityManifest): PracticePlanStep | null {
  const text = cleanStep(step);
  if (!text) return null;
  if (manifest.financeDeadlineSignals.test(text)) {
    const deadline = manifest.classifiers.find((row) => row.stepType === "deadlines");
    if (deadline) {
      return stepOf(text, {
        stepType: deadline.stepType,
        capability: deadline.capability,
        covers: deadline.covers,
        bucket: deadline.bucket,
        fitNote: deadline.fitNote,
        effort: deadline.effort,
      });
    }
  }
  const matched = matchManifestClassifier(text, manifest);
  if (!matched) return null;
  return stepOf(text, {
    stepType: matched.stepType,
    capability: matched.capability,
    covers: matched.covers,
    bucket: matched.bucket,
    fitNote: matched.fitNote,
    effort: matched.effort,
  });
}

export function manifestBotForCapability(manifest: ImCapabilityManifest, capability: string): string {
  const key = capability.toLowerCase();
  if (key.includes("analyst")) return "Analyst";
  if (key.includes("advisor")) return "Advisor";
  if (key.includes("tax")) return "Tax Specialist";
  return "Financial Manager";
}