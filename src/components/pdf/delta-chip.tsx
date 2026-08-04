/**
 * DeltaChip — small movement chip: ▲ +4.2% / ▼ −1.8% / → flat.
 * Green when the movement is good, red when bad, neutral otherwise.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C } from "./theme";
import { Arrow } from "./glyphs";

type Props = {
  /** Display text, e.g. "+4.2%" or "−3 d". */
  text: string;
  direction: "up" | "down" | "flat";
  /** Is the movement favourable? Undefined = neutral grey. */
  good?: boolean;
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2.5,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  text: { fontSize: 6.5, fontFamily: "Helvetica-Bold" },
});

export function DeltaChip({ text, direction, good }: Props) {
  const fg = good === undefined ? C.muted : good ? C.greenDeep : C.redDeep;
  const bg = good === undefined ? C.soft : good ? C.greenSoft : C.redSoft;
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Arrow dir={direction} color={fg} size={4} />
      <Text style={[styles.text, { color: fg }]}>{text}</Text>
    </View>
  );
}
