import { Text, View } from "@react-pdf/renderer";
import { HealthScoreGauge } from "@/components/pdf/health-score-gauge";
import { C, TIER_META, tierForScore } from "@/components/pdf/theme";
import { pdfSafeText } from "@/lib/advisory-pack-pdf";
import type { AdvisoryPackContentV2 } from "@/lib/advisory-pack-schema";

export function PackCover({
  content,
  preparedBy,
  accountantName,
  dateLabel,
}: {
  content: AdvisoryPackContentV2;
  preparedBy: string;
  accountantName: string;
  dateLabel: string;
}) {
  const score = content.health?.overall ?? null;
  const tier = tierForScore(score);
  const meta = TIER_META[tier];
  const verdict =
    content.sections.find((section) => section.key === "summary")?.verdict?.trim() ||
    content.sections.find((section) => section.key === "summary")?.meaning ||
    "";
  const period = content.periodLabel?.trim() || "Period on file";
  const firm = preparedBy.trim() || "Your accountant";
  const person = accountantName.trim();
  return (
    <View>
      <Text
        style={{ fontSize: 11, fontFamily: "Helvetica-Bold", color: "#0B5FFF", letterSpacing: 1.2 }}
      >
        ADVISORY
      </Text>
      <Text
        style={{
          fontSize: 26,
          fontFamily: "Helvetica-Bold",
          color: "#102A43",
          marginTop: 6,
          lineHeight: 1.15,
        }}
      >
        Advisory Management Report
      </Text>
      <Text style={{ fontSize: 14, fontFamily: "Helvetica-Bold", color: C.ink, marginTop: 10 }}>
        {pdfSafeText(content.clientName)}
      </Text>
      <Text style={{ fontSize: 11, fontFamily: "Helvetica", color: C.body, marginTop: 4 }}>
        {pdfSafeText(period)}
      </Text>
      <Text style={{ fontSize: 9.5, fontFamily: "Helvetica", color: C.muted, marginTop: 8 }}>
        {pdfSafeText(`Prepared by ${firm}${person ? `, ${person}` : ""}`)}
      </Text>
      <Text style={{ fontSize: 9.5, fontFamily: "Helvetica", color: C.muted, marginTop: 2 }}>
        {pdfSafeText(dateLabel)}
      </Text>

      <View
        style={{
          marginTop: 28,
          borderRadius: 8,
          borderWidth: 0.75,
          borderColor: C.line,
          padding: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 18,
        }}
      >
        <View style={{ width: 150 }}>
          <Text style={{ fontSize: 42, fontFamily: "Helvetica-Bold", color: meta.color }}>
            {score == null ? "—" : String(Math.round(score))}
          </Text>
          <HealthScoreGauge score={score} height={8} />
          <View
            style={{
              marginTop: 8,
              alignSelf: "flex-start",
              backgroundColor: meta.color,
              borderRadius: 6,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}
          >
            <Text style={{ color: C.white, fontSize: 8, fontFamily: "Helvetica-Bold" }}>
              {meta.label}
            </Text>
          </View>
        </View>
        <Text
          style={{ flex: 1, fontSize: 12, fontFamily: "Helvetica", color: C.ink, lineHeight: 1.45 }}
        >
          {pdfSafeText(
            verdict || "The health, cash, and profit pages carry the figures for this period.",
          )}
        </Text>
      </View>
    </View>
  );
}
