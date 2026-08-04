/**
 * DataTable — refined generic table: deep-navy (or brand accent) header band,
 * hairline row separators, soft zebra striping.
 *
 * SSR safety: react-pdf primitives — only import via dynamic import().
 */

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { C } from "./theme";

export type TableColumn<T> = {
  header: string;
  key: keyof T;
  flex?: number;
  align?: "left" | "right" | "center";
  render?: (value: T[keyof T], row: T) => string;
};

type Props<T extends Record<string, unknown>> = {
  columns: TableColumn<T>[];
  rows: T[];
  accentColor?: string;
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 5,
    overflow: "hidden",
    borderWidth: 0.75,
    borderColor: C.line,
  },
  headerRow: { flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8 },
  headerCell: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: C.white,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  dataRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 7.5,
    borderTopWidth: 0.5,
    borderTopColor: C.hairline,
  },
  cell: { fontSize: 8, fontFamily: "Helvetica", color: C.body },
});

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  accentColor = C.blueDeep,
}: Props<T>) {
  return (
    <View style={styles.container}>
      <View style={[styles.headerRow, { backgroundColor: accentColor }]}>
        {columns.map((col, i) => (
          <Text
            key={i}
            style={[
              styles.headerCell,
              { flex: col.flex ?? 1, textAlign: col.align ?? "left" },
            ]}
          >
            {col.header}
          </Text>
        ))}
      </View>

      {rows.map((row, ri) => (
        <View
          key={ri}
          style={[
            styles.dataRow,
            { backgroundColor: ri % 2 === 1 ? C.soft : C.white },
          ]}
        >
          {columns.map((col, ci) => {
            const raw = row[col.key];
            const display = col.render ? col.render(raw, row) : String(raw ?? "");
            return (
              <Text
                key={ci}
                style={[
                  styles.cell,
                  { flex: col.flex ?? 1, textAlign: col.align ?? "left" },
                ]}
              >
                {display}
              </Text>
            );
          })}
        </View>
      ))}
    </View>
  );
}
