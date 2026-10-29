import { Text, View } from "@react-pdf/renderer";
import { C } from "@/components/pdf/theme";
import { pdfSafeText } from "@/lib/advisory-pack-pdf";
import type { AdvisoryPackContentV2 } from "@/lib/advisory-pack-schema";
import { PageBand } from "./pack-explainer";

function line(label: string, value: string | null | undefined) {
  const text = value?.trim();
  if (!text) return null;
  return (
    <Text
      key={label}
      style={{
        fontSize: 9.5,
        fontFamily: "Helvetica",
        color: C.body,
        marginBottom: 4,
        lineHeight: 1.4,
      }}
    >
      {pdfSafeText(`${label}: ${text}`)}
    </Text>
  );
}

export function PackNotes({ content }: { content: AdvisoryPackContentV2 }) {
  const section = content.sections.find((row) => row.key === "notes");
  return (
    <View break>
      <PageBand title="Notes and sign-off" />
      <Text
        style={{ fontSize: 12, fontFamily: "Helvetica-Bold", color: "#102A43", marginBottom: 6 }}
      >
        Data used
      </Text>
      {line("Source", content.sourceLabel)}
      {line("Books as of", content.figuresAsOf)}
      {line("Period", content.periodLabel)}
      <Text
        style={{
          fontSize: 12,
          fontFamily: "Helvetica-Bold",
          color: "#102A43",
          marginTop: 8,
          marginBottom: 6,
        }}
      >
        Assumptions
      </Text>
      {content.assumptions.length === 0 ? (
        <Text style={{ fontSize: 9.5, fontFamily: "Helvetica", color: C.muted }}>
          No forecast assumptions were frozen with this report.
        </Text>
      ) : (
        content.assumptions.map((item, index) => (
          <Text
            key={index}
            style={{ fontSize: 9.5, fontFamily: "Helvetica", color: C.body, marginBottom: 3 }}
          >
            {pdfSafeText(item)}
          </Text>
        ))
      )}
      <Text
        style={{
          fontSize: 12,
          fontFamily: "Helvetica-Bold",
          color: "#102A43",
          marginTop: 8,
          marginBottom: 6,
        }}
      >
        Data gaps
      </Text>
      {content.dataGaps.length === 0 ? (
        <Text style={{ fontSize: 9.5, fontFamily: "Helvetica", color: C.body }}>
          No open data gaps were frozen with this report.
        </Text>
      ) : (
        content.dataGaps.map((gap) => (
          <Text
            key={gap.id}
            style={{ fontSize: 9.5, fontFamily: "Helvetica", color: C.body, marginBottom: 3 }}
          >
            {pdfSafeText(`${gap.severity}: ${gap.title}`)}
          </Text>
        ))
      )}
      {section?.meaning ? (
        <Text
          style={{
            fontSize: 8.5,
            fontFamily: "Helvetica",
            color: C.muted,
            marginTop: 10,
            lineHeight: 1.4,
          }}
        >
          {pdfSafeText(section.meaning)}
        </Text>
      ) : null}
    </View>
  );
}
