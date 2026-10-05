import type { AccountantProfile } from "@/contexts/accountant-profile";
import type { ActionPlanPdfItem } from "@/reports/action-plan";

export type DeliverablePdfSource = {
  title: string;
  status?: string | null;
  dueDate?: string | null;
  outcomeWhy?: string | null;
  ownerName?: string | null;
};

/**
 * The bot persist payload only lists rows inserted on this turn. The PDF is
 * the current deliverable: every item already on the active plan, plus any
 * just-created title the plan read has not returned yet.
 */
export function completeDeliverablePdfItems(
  planItems: DeliverablePdfSource[],
  created: Array<{ title?: string | null; outcomeWhy?: string | null }> = [],
): ActionPlanPdfItem[] {
  const fromPlan = planItems
    .filter((item) => item.title?.trim())
    .map((item) => ({
      title: item.title.trim(),
      status: item.status ?? "not_started",
      dueDate: item.dueDate ?? null,
      outcomeWhy: item.outcomeWhy ?? null,
      ownerName: item.ownerName ?? null,
    }));
  const seen = new Set(fromPlan.map((item) => item.title.toLowerCase()));
  const extras: ActionPlanPdfItem[] = created
    .filter((item) => item.title?.trim() && !seen.has(item.title.trim().toLowerCase()))
    .map((item) => ({
      title: item.title!.trim(),
      status: "not_started",
      outcomeWhy: item.outcomeWhy ?? null,
    }));
  return fromPlan.length ? [...fromPlan, ...extras] : extras;
}

export async function downloadActionPlanPdf(input: {
  clientName: string;
  periodLabel?: string | null;
  headline?: string | null;
  outcomeGoal?: string | null;
  items: ActionPlanPdfItem[];
  profile: AccountantProfile;
}): Promise<void> {
  const [{ pdf }, { ActionPlanPDF }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/reports/action-plan"),
  ]);
  const name = input.clientName.trim() || "Client";
  const period = input.periodLabel?.trim() || new Date().toLocaleString("en-US", { month: "long", year: "numeric" });
  const blob = await pdf(
    ActionPlanPDF({
      smeData: { name, period },
      accountantProfile: input.profile,
      headline: input.headline,
      outcomeGoal: input.outcomeGoal,
      items: input.items,
    }) as Parameters<typeof pdf>[0],
  ).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/\s+/g, "_")}_Action_Plan.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
