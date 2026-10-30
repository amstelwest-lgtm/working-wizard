/**
 * Milōn IRP6 preparation sheet PDF. Our own layout, no SARS artwork or logo.
 * Import only via dynamic import(), next to @react-pdf/renderer.
 */
import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { MilonMark } from "@/components/pdf/glyphs";
import { C } from "@/components/pdf/theme";
import {
  IRP6_SECTIONS,
  irp6PeriodLabel,
  zaToday,
  type Irp6Adjustment,
  type Irp6Sheet,
} from "@/lib/tax-specialist/forms/irp6";
import { formatSampleCents, formatSampleDate } from "@/lib/tax-specialist/sample-compute";

Font.registerHyphenationCallback((word) => [word]);

export type Irp6PdfProps = {
  clientName: string;
  sheet: Irp6Sheet;
  adjustments: Irp6Adjustment[];
  approvedByName: string | null;
  approvedAt: string | null;
  preparedOn: string;
};

const S = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 40,
    paddingBottom: 64,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: C.body,
  },
  brand: { marginBottom: 10 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", color: C.ink },
  subtitle: { fontSize: 10, color: C.muted, marginTop: 2, marginBottom: 10 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 2 },
  metaKey: { width: 110, color: C.muted },
  metaValue: { flex: 1, color: C.ink },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 4 },
  head: {
    flexDirection: "row",
    borderBottomWidth: 0.75,
    borderBottomColor: C.line,
    paddingBottom: 3,
    color: C.muted,
    fontSize: 7.5,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: C.line,
    paddingVertical: 4,
  },
  label: { width: "33%", paddingRight: 6, color: C.ink },
  efiling: { width: "24%", paddingRight: 6 },
  value: { width: "23%", textAlign: "right", paddingRight: 8, color: C.ink },
  source: { width: "20%", color: C.muted, fontSize: 7.5 },
  note: { color: C.muted, fontSize: 7.5, marginTop: 1 },
  check: { marginTop: 3, fontSize: 8.5 },
  footer: {
    position: "absolute",
    left: 40,
    right: 40,
    bottom: 24,
    borderTopWidth: 0.75,
    borderTopColor: C.line,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    fontSize: 7.5,
    color: C.muted,
  },
  footerText: { flexDirection: "row", alignItems: "flex-end" },
});

/** Helvetica has no U+2212 minus or ō. */
function pdfText(value: string): string {
  return value.replace(/\u2212/g, "-").replace(/ō/g, "o");
}

function Footer() {
  return (
    <View style={S.footer} fixed>
      <View style={S.footerText}>
        <Text>Prepared by </Text>
        <MilonMark fontSize={7.5} color={C.muted} bold={false} />
        <Text style={{ marginLeft: 2.2 }}>
          for checking. Not a SARS return. Capture and submit on SARS eFiling.
        </Text>
      </View>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={S.metaRow}>
      <Text style={S.metaKey}>{label}</Text>
      <Text style={S.metaValue}>{pdfText(value)}</Text>
    </View>
  );
}

export function Irp6PDF({
  clientName,
  sheet,
  adjustments,
  approvedByName,
  approvedAt,
  preparedOn,
}: Irp6PdfProps) {
  const approval =
    approvedByName && approvedAt
      ? `Approved by ${approvedByName} on ${formatSampleDate(zaToday(new Date(approvedAt)))}`
      : "Not approved";
  return (
    <Document
      title={`IRP6 ${clientName} ${sheet.yearOfAssessment} P${sheet.period}`}
      creator="Milōn"
    >
      <Page size="A4" style={S.page}>
        <View style={S.brand}>
          <MilonMark fontSize={11} color={C.ink} />
        </View>
        <Text style={S.title}>IRP6 preparation sheet</Text>
        <Text style={S.subtitle}>Provisional tax return for a company, prepared for checking</Text>
        <Meta label="Client" value={clientName} />
        <Meta label="Year of assessment" value={String(sheet.yearOfAssessment)} />
        <Meta label="Period" value={irp6PeriodLabel(sheet.period)} />
        <Meta label="Due" value={formatSampleDate(sheet.due)} />
        <Meta label="Prepared" value={formatSampleDate(preparedOn)} />
        <Meta label="Status" value={approval} />
        {IRP6_SECTIONS.map((section) => (
          <View key={section.id} style={S.section} wrap={false}>
            <Text style={S.sectionTitle}>{section.title}</Text>
            {section.id === "adjustments" ? (
              <>
                <View style={S.head}>
                  <Text style={{ width: "57%" }}>Description</Text>
                  <Text style={S.value}>Amount</Text>
                  <Text style={S.source}>Added or deducted</Text>
                </View>
                {adjustments.length ? (
                  adjustments.map((row) => (
                    <View key={row.id} style={S.row}>
                      <Text style={{ width: "57%", color: C.ink }}>{pdfText(row.description)}</Text>
                      <Text style={S.value}>
                        {pdfText(formatSampleCents(Math.abs(row.amountCents ?? 0)))}
                      </Text>
                      <Text style={S.source}>{row.direction === "add" ? "Added" : "Deducted"}</Text>
                    </View>
                  ))
                ) : (
                  <View style={S.row}>
                    <Text style={{ color: C.muted }}>No adjustments.</Text>
                  </View>
                )}
              </>
            ) : (
              <>
                <View style={S.head}>
                  <Text style={S.label}>Line</Text>
                  <Text style={S.efiling}>eFiling field</Text>
                  <Text style={S.value}>Value</Text>
                  <Text style={S.source}>Source</Text>
                </View>
                {sheet.lines
                  .filter((line) => line.section === section.id)
                  .map((line) => (
                    <View key={line.id} style={S.row}>
                      <View style={S.label}>
                        <Text>{pdfText(line.label)}</Text>
                        {line.note ? <Text style={S.note}>{pdfText(line.note)}</Text> : null}
                      </View>
                      <Text style={S.efiling}>{line.efiling ?? "Working only"}</Text>
                      <Text style={S.value}>{pdfText(line.display || "Needs input")}</Text>
                      <Text style={S.source}>{pdfText(line.sourceLabel)}</Text>
                    </View>
                  ))}
              </>
            )}
          </View>
        ))}
        {sheet.checks.length ? (
          <View style={S.section} wrap={false}>
            <Text style={S.sectionTitle}>Checks</Text>
            {sheet.checks.map((check) => (
              <Text key={check.id} style={S.check}>
                {check.level === "ok"
                  ? "OK. "
                  : check.level === "warning"
                    ? "Look at this. "
                    : "Fix this. "}
                {pdfText(check.text)}
              </Text>
            ))}
          </View>
        ) : null}
        <Footer />
      </Page>
    </Document>
  );
}
