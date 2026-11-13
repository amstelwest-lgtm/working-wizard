/**
 * A lazy panel keeps this box until its chunk commits, so the card row
 * does not collapse to a one-line status and then jump.
 */
export function ReservedFallback({ label, height }: { label: string; height: number }) {
  return (
    <div
      role="status"
      aria-label={label}
      style={{
        boxSizing: "border-box",
        width: "100%",
        height,
        minHeight: height,
      }}
    />
  );
}
