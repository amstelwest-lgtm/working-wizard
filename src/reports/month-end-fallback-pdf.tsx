/**
 * Short month-end PDF used only when the Management Report pack cannot be built.
 * Draft only. Nothing here is sent.
 */
import { Document, Page, StyleSheet, Text } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 12,
    color: "#102A43",
  },
  kicker: { fontSize: 9, letterSpacing: 1.2, color: "#8a6508", marginBottom: 8 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 8 },
  line: { marginBottom: 6 },
  figure: { marginBottom: 4 },
  note: { marginTop: 18, fontSize: 10 },
});

export function MonthEndFallbackPdf({
  clientName,
  period,
  figures,
}: {
  clientName: string;
  period: string;
  figures: Array<{ label: string; value: string }>;
}) {
  return (
    <Document title={`${clientName} month-end update`} subject="Month-end update">
      <Page size="A4" style={styles.page}>
        <Text style={styles.kicker}>MONTH-END UPDATE</Text>
        <Text style={styles.title}>{clientName}</Text>
        {period ? <Text style={styles.line}>{period}</Text> : null}
        {figures.map((figure) => (
          <Text key={figure.label} style={styles.figure}>
            {`${figure.label}: ${figure.value}`}
          </Text>
        ))}
        <Text style={styles.note}>Draft for accountant review. Not sent.</Text>
      </Page>
    </Document>
  );
}
