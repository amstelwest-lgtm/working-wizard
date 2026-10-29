import { Text, View } from "@react-pdf/renderer";
import { ExecSummary, type HeadlineFigure } from "@/components/pdf/exec-summary";
import { C, fmtRandCompact, tierForScore, TIER_META } from "@/components/pdf/theme";
import { usePdfMarket } from "@/components/pdf/pdf-market";
import { pdfSafeText } from "@/lib/advisory-pack-pdf";
import type { AdvisoryPackContentV2 } from "@/lib/advisory-pack-schema";
import { PageBand } from "./pack-explainer";

function changeNote(
  current: number | null,
  prior: number | null,
  suffix: string,
): string | undefined {
  if (current == null || prior == null) return undefined;
  const delta = Math.round(current) - Math.round(prior);
  if (delta === 0) return `unchanged ${suffix}`;
  return `${delta > 0 ? "up" : "down"} ${Math.abs(delta)} ${suffix}`;
}

export function PackSummary({ content }: { content: AdvisoryPackContentV2 }) {
  const market = usePdfMarket();
  const health = content.health;
  const forecast = content.forecast;
  const profit = content.profit;
  const tier = TIER_META[tierForScore(health?.overall)];
  const netStep = profit?.steps.find(
    (step) => step.key === "netprofit" || step.label.startsWith("Net"),
  );
  const netAmount = netStep?.amount ?? null;
  const figures: HeadlineFigure[] = [
    {
      label: "Health",
      value: health?.overall == null ? "—" : String(Math.round(health.overall)),
      note: [
        tier.label,
        changeNote(health?.overall ?? null, health?.priorOverall ?? null, "since last pack"),
      ]
        .filter(Boolean)
        .join(" · "),
      good: tierForScore(health?.overall) === "healthy",
    },
    {
      label: "Cash",
      value:
        forecast?.openingBalance == null ? "—" : fmtRandCompact(forecast.openingBalance, market),
      note: [
        forecast?.lowestClosing == null
          ? null
          : `lowest ${fmtRandCompact(forecast.lowestClosing, market)}${
              forecast.lowestWeek == null ? "" : ` in week ${forecast.lowestWeek}`
            }`,
        forecast?.runwayWeeks == null ? null : `runway ${forecast.runwayWeeks} weeks`,
      ]
        .filter(Boolean)
        .join(" · "),
      good: forecast ? !forecast.breachesThreshold : undefined,
    },
    {
      label: "Profit",
      value: netAmount == null ? "—" : fmtRandCompact(netAmount, market),
      note: [
        profit?.margins.net == null ? null : `${(profit.margins.net * 100).toFixed(1)}% net margin`,
        profit?.margins.priorNet == null || profit.margins.net == null
          ? null
          : changeNote(
              profit.margins.net * 100,
              profit.margins.priorNet * 100,
              "pts since last pack",
            ),
      ]
        .filter(Boolean)
        .join(" · "),
      good: netAmount != null ? netAmount >= 0 : undefined,
    },
  ];
  const summary = content.sections.find((section) => section.key === "summary");
  const story = summary?.meaning?.trim() || "";
  const actions = (summary?.actions ?? []).slice(0, 3);
  return (
    <View break>
      <PageBand title="Summary" tag={health?.label ?? undefined} tagColor={tier.color} />
      <ExecSummary
        figures={figures}
        narrative={pdfSafeText(story || "Health, cash, and profit for this period.")}
      />
      <Text
        style={{ fontSize: 12, fontFamily: "Helvetica-Bold", color: "#102A43", marginBottom: 6 }}
      >
        The story in three sentences
      </Text>
      <Text
        style={{
          fontSize: 9.5,
          fontFamily: "Helvetica",
          color: C.body,
          lineHeight: 1.45,
          marginBottom: 12,
        }}
      >
        {pdfSafeText(story)}
      </Text>
      <Text
        style={{ fontSize: 12, fontFamily: "Helvetica-Bold", color: "#102A43", marginBottom: 6 }}
      >
        The three things to do next
      </Text>
      {actions.length === 0 ? (
        <Text style={{ fontSize: 9.5, fontFamily: "Helvetica", color: C.muted }}>
          No priorities have been accepted for this report yet.
        </Text>
      ) : (
        actions.map((action, index) => (
          <Text
            key={index}
            style={{
              fontSize: 9.5,
              fontFamily: "Helvetica",
              color: C.body,
              marginBottom: 4,
              lineHeight: 1.4,
            }}
          >
            {`${index + 1}. ${pdfSafeText(action)}`}
          </Text>
        ))
      )}
    </View>
  );
}
