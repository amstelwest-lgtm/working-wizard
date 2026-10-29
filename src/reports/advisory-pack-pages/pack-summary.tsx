import { Text, View } from "@react-pdf/renderer";
import { fmtRandCompact, tierForScore, TIER_META } from "@/components/pdf/theme";
import { usePdfMarket } from "@/components/pdf/pdf-market";
import { pdfSafeText } from "@/lib/advisory-pack-pdf";
import type { AdvisoryPackContentV2 } from "@/lib/advisory-pack-schema";
import { PageBand } from "./pack-explainer";
import { DISPLAY, P, SANS } from "./pack-type";

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

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <View
      style={{
        flex: 1,
        borderRadius: 10,
        borderWidth: 0.75,
        borderColor: P.line,
        backgroundColor: P.white,
        paddingVertical: 12,
        paddingHorizontal: 8,
        alignItems: "center",
      }}
    >
      <Text
        style={{
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: 7.5,
          color: P.cobalt,
          letterSpacing: 1,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: DISPLAY,
          fontWeight: 600,
          fontSize: 22,
          color: P.navy,
          textAlign: "center",
          marginTop: 4,
          lineHeight: 1.05,
        }}
      >
        {value}
      </Text>
      {note ? (
        <Text
          style={{
            fontFamily: SANS,
            fontSize: 7.5,
            color: P.muted,
            textAlign: "center",
            marginTop: 4,
            lineHeight: 1.3,
          }}
        >
          {note}
        </Text>
      ) : null}
    </View>
  );
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
  const summary = content.sections.find((section) => section.key === "summary");
  const story = summary?.meaning?.trim() || "";
  const actions = (summary?.actions ?? []).slice(0, 3);
  const cashNote = [
    forecast?.lowestClosing == null
      ? null
      : `lowest ${fmtRandCompact(forecast.lowestClosing, market)}${
          forecast.lowestWeek == null ? "" : ` · week ${forecast.lowestWeek}`
        }`,
    forecast?.runwayWeeks == null ? null : `runway ${forecast.runwayWeeks} weeks`,
  ]
    .filter(Boolean)
    .join("\n");
  const profitNote = [
    profit?.margins.net == null ? null : `${(profit.margins.net * 100).toFixed(1)}% net margin`,
    profit?.margins.priorNet == null || profit.margins.net == null
      ? null
      : changeNote(profit.margins.net * 100, profit.margins.priorNet * 100, "pts"),
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <View break style={{ minHeight: 540, justifyContent: "center" }}>
      <PageBand title="Summary" tag={health?.label ?? tier.label} tagColor={tier.color} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Tile
          label="HEALTH"
          value={health?.overall == null ? "—" : String(Math.round(health.overall))}
          note={[
            tier.label,
            changeNote(health?.overall ?? null, health?.priorOverall ?? null, "pts"),
          ]
            .filter(Boolean)
            .join("\n")}
        />
        <Tile
          label="CASH"
          value={
            forecast?.openingBalance == null ? "—" : fmtRandCompact(forecast.openingBalance, market)
          }
          note={cashNote}
        />
        <Tile
          label="PROFIT"
          value={netAmount == null ? "—" : fmtRandCompact(netAmount, market)}
          note={profitNote}
        />
      </View>
      <View
        style={{
          marginTop: 12,
          borderRadius: 10,
          borderWidth: 0.75,
          borderColor: P.line,
          paddingHorizontal: 14,
          paddingVertical: 12,
        }}
      >
        <Text style={head}>The story in three sentences</Text>
        <Text style={copy}>
          {pdfSafeText(story || "Health, cash, and profit for this period.")}
        </Text>
        <Text style={[head, { marginTop: 10 }]}>The three things to do next</Text>
        {actions.length === 0 ? (
          <Text style={copy}>No priorities have been accepted for this report yet.</Text>
        ) : (
          actions.map((action, index) => (
            <Text key={index} style={copy}>
              {`${index + 1}.  ${pdfSafeText(action)}`}
            </Text>
          ))
        )}
      </View>
    </View>
  );
}

const head = {
  fontFamily: DISPLAY,
  fontWeight: 600,
  fontSize: 16,
  color: P.navy,
  textAlign: "center" as const,
  marginBottom: 6,
};

const copy = {
  fontFamily: SANS,
  fontSize: 9.5,
  color: P.body,
  lineHeight: 1.45,
  textAlign: "center" as const,
};
