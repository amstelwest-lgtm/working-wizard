/** One prompt after a P&L import when no balance sheet is on file. */
export function BalanceSheetPrompt({
  onUpload,
  className,
}: {
  onUpload: () => void;
  className?: string;
}) {
  return (
    <div
      className={className}
      role="status"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 16,
        padding: "14px 16px",
        borderRadius: 12,
        border: "1px solid rgba(212,165,80,.45)",
      }}
    >
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
        Add the balance sheet to unlock cash and runway
      </p>
      <button
        type="button"
        onClick={onUpload}
        style={{
          border: 0,
          borderRadius: 8,
          background: "#d4a550",
          color: "#1b1300",
          fontWeight: 700,
          fontSize: 13,
          padding: "8px 14px",
          cursor: "pointer",
        }}
      >
        Upload
      </button>
    </div>
  );
}
