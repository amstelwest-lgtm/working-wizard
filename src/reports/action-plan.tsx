/**
 * Action Plan PDF — same branded shell as the other accountant reports.
 * Import only via dynamic import().
 */
import { Text, View, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData } from "@/components/pdf/pdf-document";
import { ReportTitle } from "@/components/pdf/report-title";
import { C } from "@/components/pdf/theme";

export type ActionPlanPdfItem = {
  title: string;
  status?: string | null;
  dueDate?: string | null;
  outcomeWhy?: string | null;
  ownerName?: string | null;
};

export type ActionPlanPDFProps = {
  smeData: SmeData;
  accountantProfile: AccountantProfile;
  headline?: string | null;
  outcomeGoal?: string | null;
  items: ActionPlanPdfItem[];
  sample?: boolean;
};

const S = StyleSheet.create({
  goal: {
    fontSize: 10,
    fontFamily: "Helvetica",
    color: C.body,
    marginBottom: 12,
    lineHeight: 1.45,
  },
  row: {
    borderWidth: 0.75,
    borderColor: C.line,
    borderRadius: 4,
    padding: 8,
    marginBottom: 6,
  },
  title: { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 2 },
  meta: { fontSize: 8, fontFamily: "Helvetica", color: C.muted, marginBottom: 2 },
  why: { fontSize: 8.5, fontFamily: "Helvetica", color: C.body, lineHeight: 1.4 },
  empty: { fontSize: 9, fontFamily: "Helvetica", color: C.muted },
});

function statusLabel(status: string | null | undefined): string {
  if (status === "in_progress") return "In progress";
  if (status === "done") return "Done";
  if (status === "blocked") return "Blocked";
  if (status === "not_started") return "Not started";
  return status ? status : "Open";
}

export function ActionPlanPDF({
  smeData,
  accountantProfile,
  headline,
  outcomeGoal,
  items,
  sample,
}: ActionPlanPDFProps) {
  return (
    <PDFDocument
      title="Action Plan"
      subject="Action Plan"
      smeData={smeData}
      accountantProfile={accountantProfile}
      draft
      sample={sample}
    >
      <ReportTitle kicker="Advisory" title="Action Plan" subtitle={smeData.period} />
      {outcomeGoal ? <Text style={S.goal}>{outcomeGoal}</Text> : null}
      {headline ? <Text style={S.goal}>{headline}</Text> : null}
      {items.length === 0 ? (
        <Text style={S.empty}>No actions on this plan yet.</Text>
      ) : (
        items.map((item, i) => (
          <View key={`${item.title}-${i}`} style={S.row}>
            <Text style={S.title}>{item.title}</Text>
            <Text style={S.meta}>
              {statusLabel(item.status)}
              {item.dueDate ? ` · due ${item.dueDate}` : ""}
              {item.ownerName ? ` · ${item.ownerName}` : ""}
            </Text>
            {item.outcomeWhy ? <Text style={S.why}>{item.outcomeWhy}</Text> : null}
          </View>
        ))
      )}
    </PDFDocument>
  );
}
