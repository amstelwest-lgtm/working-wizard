import { Text, View } from "@react-pdf/renderer";
import { C, TIER_META } from "@/components/pdf/theme";
import { pdfSafeText } from "@/lib/advisory-pack-pdf";
import type { AdvisoryPackContentV2 } from "@/lib/advisory-pack-schema";
import { PageBand } from "./pack-explainer";

const PILLAR_COLOR: Record<string, string> = {
  profit: TIER_META.at_risk.color,
  cash: "#0B5FFF",
  assets: "#2563EB",
  financing: "#102A43",
};

export function PackPriorities({ content }: { content: AdvisoryPackContentV2 }) {
  const items = content.recommendations.slice(0, 5);
  const section = content.sections.find((row) => row.key === "priorities");
  return (
    <View break>
      <PageBand title="Priorities" tag={items.length ? `${items.length} actions` : "None yet"} />
      {items.length === 0 ? (
        <View>
          <Text
            style={{
              fontSize: 9.5,
              fontFamily: "Helvetica",
              color: C.body,
              lineHeight: 1.4,
              marginBottom: 6,
            }}
          >
            {pdfSafeText(
              section?.meaning || "No recommendations have been accepted for this report yet.",
            )}
          </Text>
          {(section?.actions ?? []).map((action, index) => (
            <Text
              key={index}
              style={{ fontSize: 9.5, fontFamily: "Helvetica", color: C.body, marginBottom: 3 }}
            >
              {`${index + 1}. ${pdfSafeText(action)}`}
            </Text>
          ))}
        </View>
      ) : (
        items.map((item, index) => (
          <View
            key={item.id || index}
            wrap={false}
            style={{
              borderWidth: 0.75,
              borderColor: C.line,
              borderRadius: 8,
              padding: 8,
              marginBottom: 8,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text
                style={{ fontSize: 11, fontFamily: "Helvetica-Bold", color: "#102A43", flex: 1 }}
              >
                {`${index + 1}. ${pdfSafeText(item.title)}`}
              </Text>
              {item.pillar ? (
                <View
                  style={{
                    backgroundColor: PILLAR_COLOR[item.pillar] ?? "#0B5FFF",
                    borderRadius: 6,
                    paddingHorizontal: 6,
                    paddingVertical: 2,
                  }}
                >
                  <Text style={{ color: C.white, fontSize: 7, fontFamily: "Helvetica-Bold" }}>
                    {item.pillar.toUpperCase()}
                  </Text>
                </View>
              ) : null}
            </View>
            {item.problem ? (
              <Text style={{ fontSize: 9, fontFamily: "Helvetica", color: C.body, marginTop: 3 }}>
                {pdfSafeText(item.problem)}
              </Text>
            ) : null}
            {item.expectedImpact ? (
              <Text
                style={{ fontSize: 9, fontFamily: "Helvetica-Bold", color: C.ink, marginTop: 3 }}
              >
                {pdfSafeText(`Expected impact: ${item.expectedImpact}`)}
              </Text>
            ) : null}
            <Text style={{ fontSize: 8, fontFamily: "Helvetica", color: C.muted, marginTop: 3 }}>
              {[
                item.owner ? `Owner ${item.owner}` : null,
                item.dueDate ? `Target ${item.dueDate}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {item.metric ? (
              <Text
                style={{ fontSize: 8, fontFamily: "Helvetica", color: "#102A43", marginTop: 3 }}
              >
                {pdfSafeText(`How we will measure it: ${item.metric}`)}
              </Text>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}
