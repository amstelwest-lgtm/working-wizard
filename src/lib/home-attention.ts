/**
 * Needs attention on accountant client Home: one row per thing to act on,
 * each with one button. Built from the Financial Manager brief and the Home counts.
 * Order: books, cash, open actions, chase, drafts, the rest of the plan, reports.
 */
import { DRAFT_OUT_OF_DATE } from "@/lib/draft-figures";
import type { FinancialManagerBrief } from "@/lib/financial-manager-brief";
import { splitRegenerateNarrative } from "@/lib/health-snapshot";

export type AttentionItem =
  | { key: string; kind: "books"; label: string; title: string }
  | {
      key: string;
      kind: "cash";
      label: string;
      title: string;
      detail: string | null;
      chip: string | null;
    }
  | { key: string; kind: "hand"; label: string; title: string }
  | { key: string; kind: "chase"; label: string; title: string; detail: string }
  | {
      key: string;
      kind: "draft";
      label: string;
      title: string;
      detail: string | null;
      draftId: string;
      chip: string | null;
    }
  | { key: string; kind: "plan"; label: string; title: string }
  | { key: string; kind: "reports"; label: string; title: string };

export const ATTENTION_CTA: Record<Exclude<AttentionItem["kind"], "hand">, string> = {
  books: "Connect books",
  cash: "Open forecast",
  chase: "Draft chase",
  draft: "Review draft",
  plan: "Open action plan",
  reports: "Open reports",
};

export const HOME_ATTENTION_DRAFTS = 2;

export function homeAttentionItems(input: {
  brief: FinancialManagerBrief;
  /** "5 open, 1 overdue". Shown when the brief does not list every open action. */
  planHeading?: string | null;
  planMore?: boolean;
  reportsLine?: string | null;
  booksMissing?: boolean;
}): AttentionItem[] {
  const { brief } = input;
  const items: AttentionItem[] = [];
  if (input.booksMissing) {
    items.push({
      key: "books",
      kind: "books",
      label: "Books",
      title: "No accounting system connected",
    });
  }
  const cashAction = brief.actions.find(
    (action) => action.button === "open" && action.tab === "cash",
  );
  if (cashAction) {
    items.push({
      key: cashAction.id,
      kind: "cash",
      label: "Cash",
      title: cashAction.title,
      detail: cashAction.reason || null,
      chip: brief.cashFloorChip,
    });
  } else if (brief.cashFloorChip && brief.cashFloorLine) {
    items.push({
      key: "cash",
      kind: "cash",
      label: "Cash",
      title: brief.cashFloorLine,
      detail: null,
      chip: brief.cashFloorChip,
    });
  }
  for (const action of brief.actions) {
    if (action.button === "hand") {
      items.push({ key: action.id, kind: "hand", label: "Action plan", title: action.title });
    } else if (action.button === "chase") {
      items.push({
        key: action.id,
        kind: "chase",
        label: "Receivables",
        title: action.title,
        detail: action.reason,
      });
    }
  }
  for (const draft of brief.drafts.slice(0, HOME_ATTENTION_DRAFTS)) {
    const parts = splitRegenerateNarrative(draft.title);
    const stale = parts.action || Boolean(draft.refresh);
    items.push({
      key: `draft-${draft.id}`,
      kind: "draft",
      label: "Draft",
      title: draft.label ? `${draft.label} draft` : "Draft to review",
      detail: parts.lead || null,
      draftId: draft.id,
      chip: stale ? DRAFT_OUT_OF_DATE : null,
    });
  }
  const planHeading = input.planHeading?.trim() ?? "";
  if (input.planMore && planHeading) {
    items.push({ key: "plan", kind: "plan", label: "Action plan", title: planHeading });
  }
  const reports = input.reportsLine?.trim() ?? "";
  if (reports) items.push({ key: "reports", kind: "reports", label: "Reports", title: reports });
  return items;
}
