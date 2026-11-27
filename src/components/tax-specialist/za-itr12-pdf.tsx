/**
 * ITR12 capture-sheet PDF. Our own layout, no SARS artwork or logo.
 * Import only via dynamic import(), next to @react-pdf/renderer.
 * This file is not emailed to the client.
 */
import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { MilonMark } from "@/components/pdf/glyphs";
import { C } from "@/components/pdf/theme";
import { zaToday } from "@/lib/tax-specialist/forms/irp6";
import { CGT_BLANK_SCHEDULE } from "@/lib/tax-specialist/forms/cgt";
import { NIL_CONFIRMED_NOTE } from "@/lib/tax-specialist/forms/nil-mark";
import { ITR12_FOOTER, ITR12_SECTIONS, type Itr12Sheet } from "@/lib/tax-specialist/forms/itr12";
import { formatSampleCents, formatSampleDate } from "@/lib/tax-specialist/sample-compute";

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

function money(cents: number | null): string {
  return cents == null ? "Blank" : pdfText(formatSampleCents(cents));
}

function mark(value: boolean | null): string {
  if (value == null) return "Blank";
  return value ? "Yes" : "No";
}

function BusinessSection({ sheet }: { sheet: Itr12Sheet }) {
  const business = sheet.business;
  return (
    <View style={S.section}>
      <Text style={S.sectionTitle}>Local business, trade, or profession</Text>
      {business ? (
        <>
          {business.notes.map((note) => (
            <Text key={note} style={S.note}>
              {pdfText(note)}
            </Text>
          ))}
          <View style={S.row} wrap={false}>
            <Text style={S.label}>Gross income</Text>
            <Text style={S.value}>{money(business.grossIncomeCents)}</Text>
            <Text style={S.source}>Typed</Text>
          </View>
          {business.deductions.map((row) => (
            <View key={row.id} style={S.row} wrap={false}>
              <Text style={S.label}>{pdfText(row.label || "Deduction")}</Text>
              <Text style={S.value}>{money(row.amountCents)}</Text>
              <Text style={S.source}>Allowable deduction</Text>
            </View>
          ))}
          <View style={S.row} wrap={false}>
            <View style={S.label}>
              <Text>Home office</Text>
              <Text style={S.note}>
                {business.homeOffice
                  ? pdfText(business.homeOffice.note)
                  : "No home office claim. A blank claim is not zero."}
              </Text>
            </View>
            <Text style={S.value}>
              {business.homeOffice ? money(business.homeOffice.deductedCents) : "Blank"}
            </Text>
            <Text style={S.source}>
              {business.homeOffice
                ? `Equipped ${mark(business.homeOffice.specificallyEquipped)}. Exclusive ${mark(business.homeOffice.regularlyAndExclusivelyUsed)}.`
                : "s23(b)"}
            </Text>
          </View>
          {business.wear?.rows.map((row) => (
            <View key={row.id} style={S.row} wrap={false}>
              <View style={S.label}>
                <Text>
                  {pdfText(row.description)} ({row.sectionLabel})
                </Text>
                <Text style={S.note}>{pdfText(row.detail)}</Text>
              </View>
              <Text style={S.value}>{money(row.allowanceCents)}</Text>
              <Text style={S.source}>Asset register</Text>
            </View>
          ))}
          <View style={S.row} wrap={false}>
            <Text style={S.label}>Wear-and-tear</Text>
            <Text style={S.value}>{money(business.wearAndTearCents)}</Text>
            <Text style={S.source}>
              {business.wear ? "Asset register" : "Typed. A blank register is not zero."}
            </Text>
          </View>
          <View style={S.row} wrap={false}>
            <Text style={S.label}>Recoupment</Text>
            <Text style={S.value}>{money(business.recoupmentCents)}</Text>
            <Text style={S.source}>Not a scrapping allowance</Text>
          </View>
          <View style={S.row} wrap={false}>
            <Text style={S.label}>s20A ring-fence</Text>
            <Text style={S.value}>{mark(business.ringFenceS20A)}</Text>
            <Text style={S.source}>Indicator only. Not signed off.</Text>
          </View>
          <View style={S.row} wrap={false}>
            <Text style={S.label}>Net profit or loss</Text>
            <Text style={S.value}>{money(business.netProfitCents)}</Text>
            <Text style={S.source}>Draft for review</Text>
          </View>
        </>
      ) : (
        <Text style={S.note}>
          Blank. A blank schedule is not zero. Gross income, deductions, home office, and
          wear-and-tear stay blank.
        </Text>
      )}
    </View>
  );
}

function RentalSection({ sheet }: { sheet: Itr12Sheet }) {
  const rentals = sheet.rentals;
  return (
    <View style={S.section}>
      <Text style={S.sectionTitle}>Local rental income</Text>
      {rentals ? (
        <>
          {rentals.notes.map((note) => (
            <Text key={note} style={S.note}>
              {pdfText(note)}
            </Text>
          ))}
          {rentals.properties.map((property) => (
            <View key={property.id} wrap={false}>
              <Text style={S.sectionTitle}>{pdfText(property.description)}</Text>
              <View style={S.row}>
                <Text style={S.label}>Rent received</Text>
                <Text style={S.value}>{money(property.rentReceivedCents)}</Text>
                <Text style={S.source}>Typed</Text>
              </View>
              {(
                [
                  ["Rates", property.ratesCents],
                  ["Interest", property.interestCents],
                  ["Insurance", property.insuranceCents],
                  ["Repairs", property.repairsCents],
                  ["Levies", property.leviesCents],
                  ["Agent fees", property.agentFeesCents],
                  ["Wear-and-tear", property.wearAndTearCents],
                ] as const
              ).map(([label, cents]) => (
                <View key={label} style={S.row}>
                  <Text style={S.label}>{label}</Text>
                  <Text style={S.value}>{money(cents)}</Text>
                  <Text style={S.source}>Expense</Text>
                </View>
              ))}
              <View style={S.row}>
                <Text style={S.label}>Private use</Text>
                <Text style={S.value}>
                  {property.privateUsePercent == null ? "Blank" : `${property.privateUsePercent}%`}
                </Text>
                <Text style={S.source}>Typed</Text>
              </View>
              <View style={S.row}>
                <Text style={S.label}>Allowable expenses</Text>
                <Text style={S.value}>{money(property.allowableExpensesCents)}</Text>
                <Text style={S.source}>{pdfText(property.note)}</Text>
              </View>
              <View style={S.row}>
                <Text style={S.label}>Net rental</Text>
                <Text style={S.value}>{money(property.netCents)}</Text>
                <Text style={S.source}>This property</Text>
              </View>
              {property.nilConfirmed ? (
                <Text style={S.note}>{pdfText(NIL_CONFIRMED_NOTE)}</Text>
              ) : null}
            </View>
          ))}
          <View style={S.row} wrap={false}>
            <Text style={S.label}>Total net rental</Text>
            <Text style={S.value}>{money(rentals.totalNetCents)}</Text>
            <Text style={S.source}>All properties</Text>
          </View>
        </>
      ) : (
        <Text style={S.note}>
          Blank. A blank schedule is not zero. Rent, expenses, and private use stay blank.
        </Text>
      )}
    </View>
  );
}

function CapitalSection({ sheet }: { sheet: Itr12Sheet }) {
  const capital = sheet.capital;
  return (
    <View style={S.section}>
      <Text style={S.sectionTitle}>Capital gains</Text>
      {capital ? (
        <>
          {capital.rows.map((row) => (
            <View key={row.id} style={S.row} wrap={false}>
              <View style={S.label}>
                <Text>{pdfText(row.description || "Disposal")}</Text>
                <Text style={S.note}>
                  {row.dateAcquired || "Blank"} to {row.dateDisposed || "Blank"}
                  {row.primaryResidence == null
                    ? ""
                    : row.primaryResidence
                      ? ". Primary residence"
                      : ""}
                </Text>
              </View>
              <Text style={S.value}>{money(row.gainCents)}</Text>
              <Text style={S.source}>Proceeds {money(row.proceedsCents)}</Text>
            </View>
          ))}
          <View style={S.row} wrap={false}>
            <Text style={S.label}>Aggregate gain or loss</Text>
            <Text style={S.value}>{money(capital.aggregateCents)}</Text>
            <Text style={S.source}>Disposal register</Text>
          </View>
          <View style={S.row} wrap={false}>
            <Text style={S.label}>Annual exclusion</Text>
            <Text style={S.value}>{money(capital.annualExclusionCents)}</Text>
            <Text style={S.source}>Individual</Text>
          </View>
          <View style={S.row} wrap={false}>
            <Text style={S.label}>Primary residence exclusion</Text>
            <Text style={S.value}>{money(capital.primaryResidenceExclusionCents)}</Text>
            <Text style={S.source}>Of the gain</Text>
          </View>
          <View style={S.row} wrap={false}>
            <View style={S.label}>
              <Text>Taxable capital gain</Text>
              {capital.ratesNote ? <Text style={S.note}>{pdfText(capital.ratesNote)}</Text> : null}
            </View>
            <Text style={S.value}>{money(capital.taxableCapitalGainCents)}</Text>
            <Text style={S.source}>
              {capital.includedInTaxableIncome ? "Included in taxable income" : "Not included"}
            </Text>
          </View>
          {capital.lossCarriedForward ? (
            <View style={S.row} wrap={false}>
              <Text style={S.label}>Capital loss carried forward</Text>
              <Text style={S.value}>{money(capital.carriedForwardCents)}</Text>
              <Text style={S.source}>Not included</Text>
            </View>
          ) : null}
          {capital.notes.map((note) => (
            <Text key={note} style={S.note}>
              {pdfText(note)}
            </Text>
          ))}
        </>
      ) : (
        <Text style={S.note}>{CGT_BLANK_SCHEDULE}</Text>
      )}
      {sheet.assessedCapitalLossNilNote ? (
        <Text style={S.note}>{pdfText(sheet.assessedCapitalLossNilNote)}</Text>
      ) : null}
    </View>
  );
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
        <BusinessSection sheet={sheet} />
        <RentalSection sheet={sheet} />
        <CapitalSection sheet={sheet} />
        <View style={S.footer} fixed>
          <Text>{pdfText(ITR12_FOOTER)}</Text>
        </View>
      </Page>
    </Document>
  );
}
