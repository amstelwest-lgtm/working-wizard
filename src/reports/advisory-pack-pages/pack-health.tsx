import { Text, View } from "@react-pdf/renderer";
import { HealthScoreGauge } from "@/components/pdf/health-score-gauge";
import { Sparkline } from "@/components/pdf/sparkline";
import { TIER_META, tierForScore } from "@/components/pdf/theme";
import { PACK_SHOWS } from "@/lib/advisory-pack-copy";
import { fmtRatio } from "@/lib/advisory-pack";
import { pdfSafeText } from "@/lib/advisory-pack-pdf";
import type { AdvisoryPackContentV2 } from "@/lib/advisory-pack-schema";
import { PackExplainer, PageBand } from "./pack-explainer";
import { ScoreRing } from "./score-ring";
import { DISPLAY, P, SANS } from "./pack-type";

export function PackHealth({ content }: { content: AdvisoryPackContentV2 }) {
  const health = content.health;
  const tier = TIER_META[tierForScore(health?.overall)];
  const weakest = health?.weakest ?? null;
  const pillars = health?.pillars ?? [];
  const section = content.sections.find((row) => row.key === "health");
  return (
    <View break>
      <PageBand
        title="Health"
        tag={health?.overall == null ? null : `${Math.round(health.overall)}  ${tier.label}`}
        tagColor={tier.color}
      />
      <View style={{ alignItems: "center", marginBottom: 12 }}>
        <ScoreRing score={health?.overall ?? null} size={108} />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {pillars.map((pillar) => {
          const weak = weakest != null && pillar.label === weakest;
          const tone = TIER_META[tierForScore(pillar.score)].color;
          return (
            <View
              key={pillar.id}
              style={{
                flex: 1,
                minHeight: 92,
                borderRadius: 10,
                borderWidth: weak ? 1.25 : 0.75,
                borderColor: weak ? tone : P.line,
                backgroundColor: P.white,
                paddingHorizontal: 6,
                paddingTop: 8,
                paddingBottom: 8,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: SANS,
                  fontWeight: 700,
                  fontSize: 6.5,
                  color: P.muted,
                  letterSpacing: 0.6,
                  textAlign: "center",
                }}
              >
                {pillar.label.toUpperCase()}
              </Text>
              <Text
                style={{
                  fontFamily: DISPLAY,
                  fontWeight: 600,
                  fontSize: 22,
                  color: tone,
                  textAlign: "center",
                  marginTop: 2,
                  lineHeight: 1.05,
                }}
              >
                {pillar.score == null ? "—" : String(Math.round(pillar.score))}
              </Text>
              <View style={{ width: "100%", marginTop: 6 }}>
                <HealthScoreGauge score={pillar.score} height={4} />
              </View>
              <Text
                style={{
                  fontFamily: SANS,
                  fontSize: 6.5,
                  color: P.muted,
                  textAlign: "center",
                  marginTop: 4,
                }}
              >
                {pillar.prior == null ? " " : `Prior ${Math.round(pillar.prior)}`}
              </Text>
            </View>
          );
        })}
      </View>

      <Text
        style={{
          fontFamily: DISPLAY,
          fontWeight: 600,
          fontSize: 16,
          color: P.navy,
          textAlign: "center",
          marginTop: 14,
          marginBottom: 6,
        }}
      >
        Ratios that matter
      </Text>
      <View
        style={{ borderRadius: 10, borderWidth: 0.75, borderColor: P.line, overflow: "hidden" }}
      >
        <View
          style={{
            flexDirection: "row",
            backgroundColor: P.cobalt,
            paddingHorizontal: 10,
            paddingVertical: 5,
          }}
        >
          <Text style={th}>Ratio</Text>
          <Text style={[th, { textAlign: "right" }]}>Now</Text>
          <Text style={[th, { textAlign: "right" }]}>Prior</Text>
          <Text style={[th, { flex: 0.8 }]}> </Text>
        </View>
        {content.ratios.slice(0, 8).map((ratio, index) => {
          const tone = TIER_META[tierForScore(ratio.score)].color;
          return (
            <View
              key={ratio.name}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingHorizontal: 10,
                paddingVertical: 4,
                backgroundColor: index % 2 === 1 ? P.mist : P.white,
              }}
            >
              <View style={{ flex: 1.4, flexDirection: "row", alignItems: "center", gap: 5 }}>
                <View style={{ width: 5, height: 5, borderRadius: 2, backgroundColor: tone }} />
                <Text style={{ fontFamily: SANS, fontWeight: 600, fontSize: 8, color: P.navy }}>
                  {ratio.name}
                </Text>
              </View>
              <Text style={num}>{ratio.formatted}</Text>
              <Text style={[num, { color: P.muted, fontWeight: 400 }]}>
                {ratio.prior == null ? "—" : fmtRatio(ratio.name, ratio.prior)}
              </Text>
              <View style={{ flex: 0.8, alignItems: "flex-end" }}>
                <Sparkline values={ratio.history} width={36} height={10} color={tone} />
              </View>
            </View>
          );
        })}
      </View>
      <PackExplainer
        clientName={content.clientName}
        shows={PACK_SHOWS.health}
        meaning={pdfSafeText(section?.meaning ?? "")}
        actions={section?.actions ?? []}
      />
    </View>
  );
}

const th = {
  flex: 1,
  fontFamily: SANS,
  fontWeight: 700,
  fontSize: 7,
  color: P.white,
  letterSpacing: 0.4,
} as const;

const num = {
  flex: 1,
  fontFamily: SANS,
  fontWeight: 700,
  fontSize: 8,
  color: P.navy,
  textAlign: "right" as const,
};
