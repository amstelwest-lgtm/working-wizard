import { View, Text, StyleSheet } from "@react-pdf/renderer";

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
    borderRadius: 6,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  headerRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  headerCell: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  dataRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 0.5,
    borderTopColor: "#f3f4f6",
  },
  cell: {
    fontSize: 8,
    fontFamily: "Helvetica",
    color: "#374151",
  },
});

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  accentColor = "#1a1a2e",
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
            { backgroundColor: ri % 2 === 1 ? "#f9fafb" : "#ffffff" },
          ]}
        >
          {columns.map((col, ci) => {
            const raw = row[col.key];
            const display = col.render
              ? col.render(raw, row)
              : String(raw ?? "");
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
