import { Text, View } from "@react-pdf/renderer";
import { TIER_META, tierForScore } from "@/components/pdf/theme";
import { pdfSafeText } from "@/lib/advisory-pack-pdf";
import type { AdvisoryPackContentV2 } from "@/lib/advisory-pack-schema";
import { ScoreRing } from "./score-ring";
import { DISPLAY, P, SANS } from "./pack-type";

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
    <View
      wrap={false}
      style={{
        minHeight: 600,
        justifyContent: "center",
        alignItems: "center",
        paddingTop: 8,
        paddingBottom: 8,
      }}
    >
      <Text
        style={{
          fontFamily: SANS,
          fontWeight: 700,
          fontSize: 9,
          color: P.cobalt,
          letterSpacing: 2.4,
          textAlign: "center",
        }}
      >
        ADVISORY
      </Text>
      <View style={{ width: 36, height: 1.25, backgroundColor: P.gold, marginTop: 8 }} />
      <Text
        style={{
          fontFamily: DISPLAY,
          fontWeight: 600,
          fontSize: 34,
          color: P.navy,
          textAlign: "center",
          marginTop: 10,
          lineHeight: 1.02,
        }}
      >
        Advisory Management Report
      </Text>
      <Text
        style={{
          fontFamily: DISPLAY,
          fontWeight: 500,
          fontStyle: "italic",
          fontSize: 16,
          color: P.royal,
          textAlign: "center",
          marginTop: 8,
        }}
      >
        {pdfSafeText(content.clientName)}
      </Text>
      <Text
        style={{
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: 10,
          color: P.navy,
          textAlign: "center",
          marginTop: 6,
        }}
      >
        {pdfSafeText(period)}
      </Text>
      <Text
        style={{
          fontFamily: SANS,
          fontSize: 9,
          color: P.muted,
          textAlign: "center",
          marginTop: 4,
        }}
      >
        {pdfSafeText(`Prepared by ${firm}${person ? `  ·  ${person}` : ""}`)}
      </Text>
      <Text
        style={{ fontFamily: SANS, fontSize: 9, color: P.muted, textAlign: "center", marginTop: 1 }}
      >
        {pdfSafeText(dateLabel)}
      </Text>

      <View style={{ marginTop: 18, alignItems: "center" }}>
        <ScoreRing score={score} size={148} />
        <View
          style={{
            marginTop: 8,
            backgroundColor: meta.color,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 4,
          }}
        >
          <Text
            style={{
              color: P.white,
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: 8,
              letterSpacing: 1.2,
            }}
          >
            {meta.label}
          </Text>
        </View>
      </View>

      <View
        style={{
          marginTop: 16,
          width: "100%",
          borderRadius: 10,
          borderWidth: 0.75,
          borderColor: P.line,
          backgroundColor: P.mist,
          paddingHorizontal: 18,
          paddingVertical: 12,
        }}
      >
        <Text
          style={{
            fontFamily: DISPLAY,
            fontWeight: 500,
            fontStyle: "italic",
            fontSize: 14,
            color: P.navy,
            textAlign: "center",
            lineHeight: 1.35,
          }}
        >
          {pdfSafeText(verdict || "Health, cash, and profit for this period.")}
        </Text>
      </View>
    </View>
  );
}
