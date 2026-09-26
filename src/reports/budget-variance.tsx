/**
 * BudgetVariancePDF — FY budget versus uploaded month actuals.
 *
 * SSR safety: Only import via dynamic import() — never at top level of an
 * SSR-rendered module.
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AccountantProfile } from "@/contexts/accountant-profile";
import { PDFDocument, type SmeData, type ReportSignoffStamp } from "@/components/pdf/pdf-document";
import { ReportTitle } from "@/components/pdf/report-title";
import { SectionHeader } from "@/components/pdf/section-header";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { DraftNotice } from "@/components/pdf/watermark";
import { C, fmtRand, resolveTheme } from "@/components/pdf/theme";
import { formatVariancePct } from "@/lib/budget.variance";
import type { BudgetPdfModel, BudgetPdfRow } from "@/lib/budget-pdf";
import { formatDate, ZA_MARKET, type ResolvedMarket } from "@/lib/market";

export type BudgetVariancePDFProps = {
  smeData: SmeData;
  model: BudgetPdfModel;
  accountantProfile: AccountantProfile;
  isDemo?: boolean;
  /** Live client with no current budget sign-off. */
  draft?: boolean;
  reviewSignoff?: ReportSignoffStamp | null;
  market?: ResolvedMarket;
};

const styles = StyleSheet.create({
  table: {
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 0.75,
    borderColor: C.line,
    marginBottom: 4,
  },
  headerRow: { flexDirection: "row", paddingHorizontal: 10, paddingVertical: 7 },
  headerCell: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: C.white,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  dataRow: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderTopWidth: 0.5,
    borderTopColor: C.hairline,
    alignItems: "center",
  },
  cell: { fontSize: 8, fontFamily: "Helvetica", color: C.body },
  cellStrong: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.ink },
  varTag: { fontSize: 6.5, fontFamily: "Helvetica-Bold", letterSpacing: 0.3 },
  varAmt: { fontSize: 7.5, fontFamily: "Helvetica", marginTop: 1 },
  note: { fontSize: 7, fontFamily: "Helvetica", color: C.muted, marginBottom: 8, lineHeight: 1.4 },
  yearNote: {
    fontSize: 7.5,
    fontFamily: "Helvetica",
    color: C.body,
    marginTop: 8,
    marginBottom: 4,
    lineHeight: 1.45,
  },
  notesBox: {
    borderWidth: 0.75,
    borderColor: C.line,
    borderRadius: 5,
    backgroundColor: C.soft,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  noteItem: { marginBottom: 8 },
  noteMeta: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: C.muted, marginBottom: 2 },
  noteText: { fontSize: 8, fontFamily: "Helvetica", color: C.body, lineHeight: 1.45 },
  emptyNotes: { fontSize: 8, fontFamily: "Helvetica", color: C.muted, lineHeight: 1.45 },
});

function signedMoney(n: number, market: ResolvedMarket): string {
  if (n > 0) return `+${fmtRand(n, market)}`;
  return fmtRand(n, market);
}

function overUnder(delta: number): string {
  if (Math.abs(delta) < 1) return "In line";
  return delta > 0 ? "Over" : "Under";
}

function signalColor(signal: BudgetPdfRow["signal"]): string {
  if (signal === "favourable") return C.greenDeep;
  if (signal === "adverse") return C.redDeep;
  return C.muted;
}

function VarianceTable({
  rows,
  accent,
  market,
}: {
  rows: BudgetPdfRow[];
  accent: string;
  market: ResolvedMarket;
}) {
  const cols = [
    { label: "Line", flex: 2.1, align: "left" as const },
    { label: "Budget", flex: 1.25, align: "right" as const },
    { label: "Actual", flex: 1.25, align: "right" as const },
    { label: "Variance", flex: 1.45, align: "right" as const },
    { label: "%", flex: 0.7, align: "right" as const },
  ];
  return (
    <View style={styles.table}>
      <View style={[styles.headerRow, { backgroundColor: accent }]}>
        {cols.map((c) => (
          <Text key={c.label} style={[styles.headerCell, { flex: c.flex, textAlign: c.align }]}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((row, ri) => {
        const strong = row.emphasis;
        const color = signalColor(row.signal);
        return (
          <View
            key={`${row.label}-${ri}`}
            style={[
              styles.dataRow,
              {
                backgroundColor: row.material ? C.redSoft : ri % 2 === 1 ? C.soft : C.white,
              },
            ]}
          >
            <Text style={[strong ? styles.cellStrong : styles.cell, { flex: 2.1 }]}>
              {row.label}
            </Text>
            <Text style={[styles.cell, { flex: 1.25, textAlign: "right" }]}>
              {fmtRand(row.budget, market)}
            </Text>
            <Text style={[styles.cell, { flex: 1.25, textAlign: "right" }]}>
              {row.actual == null ? "—" : fmtRand(row.actual, market)}
            </Text>
            <View style={{ flex: 1.45, alignItems: "flex-end" }}>
              {row.delta == null ? (
                <Text style={styles.cell}>—</Text>
              ) : (
                <>
                  <Text style={[styles.varTag, { color }]}>{overUnder(row.delta)}</Text>
                  <Text style={[styles.varAmt, { color }]}>{signedMoney(row.delta, market)}</Text>
                </>
              )}
            </View>
            <Text style={[styles.cell, { flex: 0.7, textAlign: "right", color }]}>
              {row.deltaPct == null ? "—" : formatVariancePct(row.deltaPct)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function summaryFigure(row: BudgetPdfRow, market: ResolvedMarket): HeadlineFigure {
  if (row.actual == null || row.delta == null) {
    return {
      label: row.label,
      value: fmtRand(row.budget, market),
      note: "Budget",
    };
  }
  const good = row.signal === "favourable" ? true : row.signal === "adverse" ? false : undefined;
  const direction =
    row.signal === "inline" || Math.abs(row.delta) < 1 ? "flat" : row.delta > 0 ? "up" : "down";
  return {
    label: row.label,
    value: signedMoney(row.delta, market),
    direction,
    good,
    note: `${formatVariancePct(row.deltaPct)} vs budget`,
  };
}

export function BudgetVariancePDF({
  smeData,
  model,
  accountantProfile,
  isDemo,
  draft,
  reviewSignoff,
  market = ZA_MARKET,
}: BudgetVariancePDFProps) {
  const theme = resolveTheme(accountantProfile);
  const prepared = formatDate(new Date(), market, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const figures = model.summary.map((row) => summaryFigure(row, market));
  const subtitle = `${model.periodLabel} · ${model.scenarioLabel} scenario · ${model.currency} · Prepared ${prepared}`;

  return (
    <PDFDocument
      title={`Budget & Variance — ${smeData.name}`}
      subject="Budget and variance"
      smeData={smeData}
      accountantProfile={accountantProfile}
      isDemo={isDemo}
      draft={draft}
      reviewSignoff={reviewSignoff}
      market={market}
    >
      <ReportTitle
        kicker="Advisory Report · Budget"
        title="Budget & Variance"
        subtitle={subtitle}
        isDemo={isDemo}
      />
      {draft && !isDemo ? <DraftNotice /> : null}

      <ExecSummary figures={figures} narrative={model.headline} />

      <Text style={styles.yearNote}>
        {model.comparedLabel}. {model.fullYearNote}
      </Text>

      {model.sections.map((section) => (
        <View key={section.title}>
          <SectionHeader title={section.title} color={theme.accent} />
          {section.note ? <Text style={styles.note}>{section.note}</Text> : null}
          <VarianceTable rows={section.rows} accent={theme.accent} market={market} />
        </View>
      ))}

      <SectionHeader title="Partner notes" color={theme.accent} />
      <View style={styles.notesBox}>
        {model.notes.length === 0 ? (
          <Text style={styles.emptyNotes}>
            Partner notes — none on this budget yet. Notes saved on the Budget tab appear here.
          </Text>
        ) : (
          model.notes.map((note, i) => (
            <View
              key={`${note.at}-${i}`}
              style={i === model.notes.length - 1 ? undefined : styles.noteItem}
            >
              <Text style={styles.noteMeta}>
                {note.by} ·{" "}
                {formatDate(note.at, market, { day: "numeric", month: "short", year: "numeric" })}
              </Text>
              <Text style={styles.noteText}>{note.text}</Text>
            </View>
          ))
        )}
      </View>
    </PDFDocument>
  );
}
