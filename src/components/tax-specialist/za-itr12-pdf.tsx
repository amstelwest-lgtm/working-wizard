/**
 * ITR12 capture-sheet PDF. Our own layout, no SARS artwork or logo.
 * Import only via dynamic import(), next to @react-pdf/renderer.
 * This file is not emailed to the client.
 */
import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { MilonMark } from "@/components/pdf/glyphs";
import { C } from "@/components/pdf/theme";
import { zaToday } from "@/lib/tax-specialist/forms/irp6";
import {
  ITR12_FOOTER,
  ITR12_SECTIONS,
  type Itr12Sheet,
} from "@/lib/tax-specialist/forms/itr12";
import { formatSampleDate } from "@/lib/tax-specialist/sample-compute";

Font.registerHyphenationCallback((word) => [word]);

export type Itr12PdfProps = {
  clientName: string;
  sheet: Itr12Sheet;
  approvedByName: string | null;
  approvedAt: string | null;
  preparedOn: string;
};

const S = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 40,
    paddingBottom: 72,
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
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: C.line,
    paddingVertical: 4,
  },
  label: { width: "46%", paddingRight: 6, color: C.ink },
  value: { width: "28%", textAlign: "right", paddingRight: 8, color: C.ink },
  source: { width: "26%", color: C.muted, fontSize: 7.5 },
  note: { color: C.muted, fontSize: 7.5, marginTop: 1 },
  footer: {
    position: "absolute",
    left: 40,
    right: 40,
    bottom: 24,
    borderTopWidth: 0.75,
    borderTopColor: C.line,
    paddingTop: 6,
    fontSize: 7.5,
    color: C.muted,
  },
});

function pdfText(value: string): string {
  return value.replace(/\u2212/g, "-").replace(/ō/g, "o");
}

export function Itr12PDF({
  clientName,
  sheet,
  approvedByName,
  approvedAt,
  preparedOn,
}: Itr12PdfProps) {
  const approval =
    approvedByName && approvedAt
      ? `Approved by ${approvedByName} on ${formatSampleDate(zaToday(new Date(approvedAt)))}`
      : "Not approved";
  return (
    <Document title={`ITR12 ${clientName} ${sheet.yearOfAssessment}`} creator="Milon">
      <Page size="A4" style={S.page}>
        <View style={S.brand}>
          <MilonMark fontSize={11} color={C.ink} />
        </View>
        <Text style={S.title}>ITR12 preparation sheet</Text>
        <Text style={S.subtitle}>
          Individual income tax, prepared for checking. Not a SARS return.
        </Text>
        <View style={S.metaRow}>
          <Text style={S.metaKey}>Client</Text>
          <Text style={S.metaValue}>{pdfText(clientName)}</Text>
        </View>
        <View style={S.metaRow}>
          <Text style={S.metaKey}>Year of assessment</Text>
          <Text style={S.metaValue}>{String(sheet.yearOfAssessment)}</Text>
        </View>
        <View style={S.metaRow}>
          <Text style={S.metaKey}>Prepared</Text>
          <Text style={S.metaValue}>{formatSampleDate(preparedOn)}</Text>
        </View>
        <View style={S.metaRow}>
          <Text style={S.metaKey}>Status</Text>
          <Text style={S.metaValue}>{pdfText(approval)}</Text>
        </View>
        {ITR12_SECTIONS.map((section) => (
          <View key={section.id} style={S.section} wrap={false}>
            <Text style={S.sectionTitle}>{section.title}</Text>
            {section.id === "queries" ? (
              sheet.queries.length ? (
                sheet.queries.map((query) => (
                  <Text key={query.id} style={S.note}>
                    {query.resolved ? "Resolved. " : "Open. "}
                    {pdfText(query.text)}
                  </Text>
                ))
              ) : (
                <Text style={S.note}>No queries.</Text>
              )
            ) : (
              sheet.lines
                .filter((line) => line.section === section.id)
                .map((line) => (
                  <View key={line.id} style={S.row}>
                    <View style={S.label}>
                      <Text>{pdfText(line.label)}</Text>
                      {line.note ? <Text style={S.note}>{pdfText(line.note)}</Text> : null}
                    </View>
                    <Text style={S.value}>{pdfText(line.display || "Needs input")}</Text>
                    <Text style={S.source}>{pdfText(line.sourceLabel)}</Text>
                  </View>
                ))
            )}
          </View>
        ))}
        <View style={S.footer} fixed>
          <Text>{pdfText(ITR12_FOOTER)}</Text>
        </View>
      </Page>
    </Document>
  );
}
