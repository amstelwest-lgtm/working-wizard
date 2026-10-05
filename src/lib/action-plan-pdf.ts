import type { AccountantProfile } from "@/contexts/accountant-profile";
import type { ActionPlanPdfItem } from "@/reports/action-plan";

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
