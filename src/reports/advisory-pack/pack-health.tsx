import { Text, View } from "@react-pdf/renderer";
import { BenchmarkBar } from "@/components/pdf/benchmark-bar";
import { PillarBox } from "@/components/pdf/pillar-box";
import { Sparkline } from "@/components/pdf/sparkline";
import { C, TIER_META, tierForScore } from "@/components/pdf/theme";
import { PACK_SHOWS } from "@/lib/advisory-pack-copy";
import { fmtRatio } from "@/lib/advisory-pack";
import { pdfSafeText } from "@/lib/advisory-pack-pdf";
import type { AdvisoryPackContentV2 } from "@/lib/advisory-pack-schema";
import { PackExplainer, PageBand } from "./pack-explainer";

function markerScale(value: number, benchmark: number): { position: number; mark: number } {
  const max = Math.max(Math.abs(value), Math.abs(benchmark), 1) * 1.35;
  return {
    position: Math.max(0, Math.min(1, Math.abs(value) / max)),
    mark: Math.max(0, Math.min(1, Math.abs(benchmark) / max)),
  };
}

export function PackHealth({ content }: { content: AdvisoryPackContentV2 }) {
  const health = content.health;
  const tier = TIER_META[tierForScore(health?.overall)];
  const weakest = health?.weakest ?? null;
  const pillars = health?.pillars ?? [];
  const section = content.sections.find((row) => row.key === "health");
  const rows = [pillars.slice(0, 2), pillars.slice(2, 4)];
  return (
    <View break>
      <PageBand
        title="Health"
        tag={health?.overall == null ? null : `${Math.round(health.overall)} ${tier.label}`}
        tagColor={tier.color}
      />
      {rows.map((row, index) => (
        <View key={index} style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          {row.map((pillar) => {
            const weak = weakest != null && pillar.label === weakest;
            return (
              <View
                key={pillar.id}
                style={{
                  width: "48%",
                  borderRadius: 8,
                  borderWidth: weak ? 1.25 : 0,
                  borderColor: weak ? C.amber : "transparent",
                  padding: weak ? 2 : 0,
                }}
              >
                <PillarBox
                  pillar={pillar.id}
                  score={pillar.score}
                  counts={{ critical: 0, at_risk: 0, healthy: 0 }}
                />
                {pillar.prior != null ? (
                  <Text
                    style={{ fontSize: 7, fontFamily: "Helvetica", color: C.muted, marginTop: 2 }}
                  >
                    {`Prior ${Math.round(pillar.prior)}`}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}
      <Text
        style={{
          fontSize: 11,
          fontFamily: "Helvetica-Bold",
          color: "#102A43",
          marginTop: 6,
          marginBottom: 4,
        }}
      >
        Ratios that matter
      </Text>
      {content.ratios.slice(0, 8).map((ratio) => {
        const tone = TIER_META[tierForScore(ratio.score)];
        const scale = ratio.benchmark != null ? markerScale(ratio.value, ratio.benchmark) : null;
        return (
          <View
            key={ratio.name}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 3,
              borderBottomWidth: 0.4,
              borderBottomColor: C.hairline,
              gap: 6,
            }}
          >
            <View style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: tone.color }} />
            <Text style={{ flex: 1.4, fontSize: 8, fontFamily: "Helvetica", color: C.ink }}>
              {ratio.name}
            </Text>
            <Text
              style={{ width: 52, fontSize: 8, fontFamily: "Helvetica-Bold", textAlign: "right" }}
            >
              {ratio.formatted}
            </Text>
            <Text
              style={{
                width: 52,
                fontSize: 7.5,
                fontFamily: "Helvetica",
                color: C.muted,
                textAlign: "right",
              }}
            >
              {ratio.prior == null ? "" : fmtRatio(ratio.name, ratio.prior)}
            </Text>
            <View style={{ width: 70 }}>
              {scale ? (
                <BenchmarkBar
                  position={scale.position}
                  bandStart={scale.mark}
                  bandEnd={Math.min(1, scale.mark + 0.02)}
                  width={70}
                  markerColor={tone.color}
                />
              ) : null}
            </View>
            <Sparkline values={ratio.history} width={36} height={10} color={tone.color} />
          </View>
        );
      })}
      <PackExplainer
        clientName={content.clientName}
        shows={PACK_SHOWS.health}
        meaning={section?.meaning ?? ""}
        actions={section?.actions ?? []}
      />
    </View>
  );
}
