import { Text, View } from "@react-pdf/renderer";
import { pdfSafeText } from "@/lib/advisory-pack-pdf";
import { DISPLAY, P, SANS } from "./pack-type";

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
    <View
      wrap={false}
      style={{
        marginTop: 10,
        borderRadius: 10,
        borderWidth: 0.75,
        borderColor: P.line,
        backgroundColor: P.mist,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
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
            {`${index + 1}.  ${pdfSafeText(line)}`}
          </Text>
        ))
      )}
    </View>
  );
}

const label = {
  fontSize: 8,
  fontFamily: SANS,
  fontWeight: 700,
  color: P.cobalt,
  letterSpacing: 0.4,
  marginTop: 7,
  marginBottom: 2,
} as const;

const body = {
  fontSize: 9,
  fontFamily: SANS,
  fontWeight: 400,
  color: P.body,
  lineHeight: 1.45,
} as const;

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
    <View style={{ alignItems: "center", marginBottom: 12 }}>
      <Text
        style={{
          fontFamily: DISPLAY,
          fontWeight: 600,
          fontSize: 26,
          color: P.navy,
          textAlign: "center",
          lineHeight: 1.05,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          width: 28,
          height: 1.25,
          backgroundColor: P.gold,
          marginTop: 6,
          marginBottom: tag ? 8 : 0,
        }}
      />
      {tag ? (
        <View
          style={{
            backgroundColor: tagColor ?? P.cobalt,
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 3,
          }}
        >
          <Text
            style={{
              color: P.white,
              fontSize: 8,
              fontFamily: SANS,
              fontWeight: 700,
              letterSpacing: 0.6,
            }}
          >
            {tag}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
