/**
 * Dividends tax draft-pack PDF. Our own layout, no SARS artwork or logo.
 * Import only via dynamic import(), next to @react-pdf/renderer.
 * This file is not filed and it is not emailed.
 */
import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { MilonMark } from "@/components/pdf/glyphs";
import { C } from "@/components/pdf/theme";
import { DTR_TITLE, dtrMoney, type DtrSheet } from "@/lib/tax-specialist/forms/dtr";
import { formatSampleDate } from "@/lib/tax-specialist/sample-compute";

Font.registerHyphenationCallback((word) => [word]);

export type DtrPdfProps = {
  clientName: string;
  sheet: DtrSheet;
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
  subtitle: { fontSize: 10, color: C.muted, marginTop: 2, marginBottom: 8 },
  note: { color: C.muted, fontSize: 8, marginBottom: 8 },
  metaRow: { flexDirection: "row", marginBottom: 2 },
  metaKey: { width: 140, color: C.muted },
  metaValue: { flex: 1, color: C.ink },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 4 },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: C.line,
    paddingVertical: 4,
  },
  label: { width: "46%", paddingRight: 8, color: C.ink },
  value: { width: "54%", color: C.ink },
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

function showDate(iso: string | null): string {
  return iso ? formatSampleDate(iso) : "";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={S.row} wrap={false}>
      <Text style={S.label}>{label}</Text>
      <Text style={S.value}>{value}</Text>
    </View>
  );
}

export function DtrPDF({ clientName, sheet, preparedOn }: DtrPdfProps) {
  return (
    <Document title={DTR_TITLE} creator="Milon">
      <Page size="A4" style={S.page}>
        <View style={S.brand}>
          <MilonMark fontSize={11} color={C.ink} />
        </View>
        <Text style={S.title}>{DTR_TITLE}</Text>
        <Text style={S.subtitle}>DTR01 and DTR02 for {clientName}. Nothing is filed.</Text>
        <Text style={S.note}>{sheet.ratesNote}</Text>
        <View style={S.section}>
          <Text style={S.sectionTitle}>DTR01</Text>
          <Row label="Declaration date" value={showDate(sheet.declarationDate)} />
          <Row label="Payment date" value={showDate(sheet.paymentDate)} />
          <Row label="Dividend amount" value={dtrMoney(sheet.amountCents)} />
          <Row label="Cash or in specie" value={sheet.kindLabel} />
          {sheet.inSpecieNote ? <Text style={S.note}>{sheet.inSpecieNote}</Text> : null}
          <Row label="Due date" value={showDate(sheet.dueDate)} />
        </View>
        <View style={S.section}>
          <Text style={S.sectionTitle}>DTR02</Text>
          {sheet.owners.length === 0 ? (
            <Text style={S.note}>No beneficial owners yet.</Text>
          ) : (
            sheet.owners.map((owner) => (
              <View key={owner.id}>
                <Row label={owner.label} value={dtrMoney(owner.amountCents)} />
                <Row label={`${owner.label} withholding`} value={owner.withholdingLabel} />
                {owner.note ? <Text style={S.note}>{owner.note}</Text> : null}
              </View>
            ))
          )}
          <Row label="Total withheld" value={sheet.totalWithheldLabel} />
        </View>
        {sheet.messages.length ? (
          <View style={S.section}>
            <Text style={S.sectionTitle}>Still to enter</Text>
            {sheet.messages.map((message) => (
              <Text key={message} style={S.note}>
                {message}
              </Text>
            ))}
          </View>
        ) : null}
        <View style={S.metaRow}>
          <Text style={S.metaKey}>Prepared</Text>
          <Text style={S.metaValue}>{showDate(preparedOn)}</Text>
        </View>
        <View style={S.footer} fixed>
          <Text>{DTR_TITLE}</Text>
        </View>
      </Page>
    </Document>
  );
}
