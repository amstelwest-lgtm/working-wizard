import { Text, View } from "@react-pdf/renderer";
import { C } from "@/components/pdf/theme";
import { pdfSafeText } from "@/lib/advisory-pack-pdf";

const label = {
  fontSize: 8,
  fontFamily: "Helvetica-Bold",
  color: "#0B5FFF",
  marginTop: 6,
  marginBottom: 2,
} as const;

const body = {
  fontSize: 9.5,
  fontFamily: "Helvetica",
  color: C.body,
  lineHeight: 1.4,
} as const;

export function PackExplainer({
  clientName,
  shows,
  meaning,
  actions,
}: {
  clientName: string;
  shows: string;
  meaning: string;
  actions: string[];
}) {
  const todo = actions
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2);
  return (
    <View style={{ marginTop: 4 }}>
      <Text style={label}>What this shows</Text>
      <Text style={body}>{pdfSafeText(shows)}</Text>
      <Text style={label}>What it means for {pdfSafeText(clientName)}</Text>
      <Text style={body}>
        {pdfSafeText(
          meaning || "The figures on this page are the ones signed off for this report.",
        )}
      </Text>
      <Text style={label}>What to do</Text>
      {todo.length === 0 ? (
        <Text style={body}>No action is linked to this page yet.</Text>
      ) : (
        todo.map((line, index) => (
          <Text key={index} style={body}>
            {"• "}
            {pdfSafeText(line)}
          </Text>
        ))
      )}
    </View>
  );
}

export function PageBand({
  title,
  tag,
  tagColor,
}: {
  title: string;
  tag?: string | null;
  tagColor?: string;
}) {
  return (
    <View
      style={{
        backgroundColor: "#EEF4FF",
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginBottom: 10,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <Text style={{ fontSize: 16, fontFamily: "Helvetica-Bold", color: "#102A43" }}>{title}</Text>
      {tag ? (
        <View
          style={{
            backgroundColor: tagColor ?? "#0B5FFF",
            borderRadius: 6,
            paddingHorizontal: 8,
            paddingVertical: 3,
          }}
        >
          <Text style={{ color: C.white, fontSize: 8, fontFamily: "Helvetica-Bold" }}>{tag}</Text>
        </View>
      ) : null}
    </View>
  );
}
