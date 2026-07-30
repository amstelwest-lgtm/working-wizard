// UploadFinancials.tsx
// Upload a PDF -> extract -> LET A HUMAN REVIEW AND CORRECT -> confirm import.
// The review step is the point: never auto-trust extracted financial figures.
//
// Styling here is deliberately minimal and uses inline styles so it drops into
// any project without Tailwind config. Swap these tokens for your MILŌN design
// system (dark / gold, Bebas Neue, Caveat) when you integrate.

import { useMemo, useState } from "react";
import type { ExtractionResult } from "../lib/financialSchema";

// --- theme tokens (replace with your MILŌN tokens) --------------------------
const T = {
  bg: "#111111",
  surface: "#1b1b1b",
  border: "#2e2e2e",
  text: "#ededed",
  muted: "#9a9a9a",
  gold: "#c9a227",
  error: "#e05252",
  warn: "#d9a441",
};

type ApiResponse = {
  data: ExtractionResult;
  issues: { check: string; message: string; difference: number | null; severity: string }[];
  autoImportSafe: boolean;
};

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export default function UploadFinancials({
  endpoint = "/api/extract-financials",
  onConfirm,
}: {
  endpoint?: string;
  onConfirm?: (result: ExtractionResult) => void;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "review" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [issues, setIssues] = useState<ApiResponse["issues"]>([]);

  async function handleFile(file: File) {
    if (file.type !== "application/pdf") {
      setError("Please upload a PDF.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      const pdfBase64 = await fileToBase64(file);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64, mimeType: "application/pdf" }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Request failed");
      const body: ApiResponse = await res.json();
      setResult(body.data);
      setIssues(body.issues);
      setStatus("review");
    } catch (e) {
      setError((e as Error).message);
      setStatus("error");
    }
  }

  // Editable headline figures live in local state via the result object.
  const bs = result?.current_period.figures.balance_sheet;
  const is = result?.current_period.figures.income_statement;

  // Live client-side balance check as the user edits.
  const liveBalance = useMemo(() => {
    if (!bs) return null;
    const eq = bs.equity.total;
    const liab = bs.total_liabilities;
    const assets = bs.total_assets;
    if (eq == null || liab == null || assets == null) return null;
    return Math.round((eq + liab - assets) * 100) / 100;
  }, [bs?.equity.total, bs?.total_liabilities, bs?.total_assets]);

  function setField(path: () => void) {
    path();
    setResult(result ? { ...result } : result); // trigger re-render
  }

  const card: React.CSSProperties = {
    background: T.surface,
    border: `1px solid ${T.border}`,
    borderRadius: 10,
    padding: 20,
    color: T.text,
    fontFamily: "system-ui, sans-serif",
    maxWidth: 720,
  };

  if (status === "idle" || status === "loading" || status === "error") {
    return (
      <div style={card}>
        <label
          style={{
            display: "block",
            border: `1.5px dashed ${T.border}`,
            borderRadius: 8,
            padding: "40px 20px",
            textAlign: "center",
            cursor: status === "loading" ? "default" : "pointer",
            color: T.muted,
          }}
        >
          {status === "loading" ? (
            "Reading statements…"
          ) : (
            <>
              <div style={{ color: T.text, marginBottom: 6 }}>Upload financial statements (PDF)</div>
              <div style={{ fontSize: 13 }}>Exported AFS or management accounts</div>
            </>
          )}
          <input
            type="file"
            accept="application/pdf"
            disabled={status === "loading"}
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </label>
        {status === "error" && (
          <p style={{ color: T.error, marginTop: 12 }}>{error}</p>
        )}
      </div>
    );
  }

  // --- review screen ---------------------------------------------------------
  if (!result || !bs || !is) return null;

  const Row = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: number | null;
    onChange: (v: number | null) => void;
  }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
      <span style={{ color: T.muted, fontSize: 14 }}>{label}</span>
      <input
        type="number"
        value={value ?? ""}
        placeholder="—"
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        style={{
          width: 160,
          textAlign: "right",
          background: T.bg,
          border: `1px solid ${T.border}`,
          borderRadius: 6,
          color: T.text,
          padding: "6px 8px",
          fontVariantNumeric: "tabular-nums",
        }}
      />
    </div>
  );

  return (
    <div style={card}>
      <div style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 18, color: T.gold }}>{result.entity_name ?? "Unknown entity"}</div>
        <div style={{ color: T.muted, fontSize: 13 }}>
          {result.current_period.period_end ?? "period unknown"} · {result.currency ?? "?"} ·{" "}
          {result.units ?? "actual"} · {result.statement_basis ?? "unknown"}
        </div>
      </div>

      {(issues.length > 0 || liveBalance) && (
        <div
          style={{
            background: "#241a1a",
            border: `1px solid ${T.error}`,
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          <strong style={{ color: T.error }}>Check before importing</strong>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: T.muted }}>
            {liveBalance !== null && liveBalance !== 0 && (
              <li>Balance sheet is out by {liveBalance.toLocaleString()} (Equity + Liabilities ≠ Assets).</li>
            )}
            {issues.map((i, n) => (
              <li key={n}>{i.message}{i.difference != null ? ` (out by ${i.difference.toLocaleString()})` : ""}</li>
            ))}
          </ul>
        </div>
      )}

      <h4 style={{ color: T.text, margin: "8px 0" }}>Income statement</h4>
      <Row label="Revenue" value={is.revenue} onChange={(v) => setField(() => (is.revenue = v))} />
      <Row label="Cost of sales" value={is.cost_of_sales} onChange={(v) => setField(() => (is.cost_of_sales = v))} />
      <Row label="Gross profit" value={is.gross_profit} onChange={(v) => setField(() => (is.gross_profit = v))} />
      <Row label="Operating profit" value={is.operating_profit} onChange={(v) => setField(() => (is.operating_profit = v))} />
      <Row label="Profit before tax" value={is.profit_before_tax} onChange={(v) => setField(() => (is.profit_before_tax = v))} />
      <Row label="Profit after tax" value={is.profit_after_tax} onChange={(v) => setField(() => (is.profit_after_tax = v))} />

      <h4 style={{ color: T.text, margin: "16px 0 8px" }}>Balance sheet</h4>
      <Row label="Total non-current assets" value={bs.non_current_assets.total} onChange={(v) => setField(() => (bs.non_current_assets.total = v))} />
      <Row label="Total current assets" value={bs.current_assets.total} onChange={(v) => setField(() => (bs.current_assets.total = v))} />
      <Row label="Total assets" value={bs.total_assets} onChange={(v) => setField(() => (bs.total_assets = v))} />
      <Row label="Total equity" value={bs.equity.total} onChange={(v) => setField(() => (bs.equity.total = v))} />
      <Row label="Total non-current liabilities" value={bs.non_current_liabilities.total} onChange={(v) => setField(() => (bs.non_current_liabilities.total = v))} />
      <Row label="Total current liabilities" value={bs.current_liabilities.total} onChange={(v) => setField(() => (bs.current_liabilities.total = v))} />
      <Row label="Total liabilities" value={bs.total_liabilities} onChange={(v) => setField(() => (bs.total_liabilities = v))} />

      {result.extraction_notes && (
        <p style={{ color: T.warn, fontSize: 13, marginTop: 12 }}>Note from extraction: {result.extraction_notes}</p>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button
          onClick={() => onConfirm?.(result)}
          style={{
            background: T.gold,
            color: "#111",
            border: "none",
            borderRadius: 8,
            padding: "10px 18px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Confirm &amp; import
        </button>
        <button
          onClick={() => { setStatus("idle"); setResult(null); setIssues([]); }}
          style={{
            background: "transparent",
            color: T.muted,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            padding: "10px 18px",
            cursor: "pointer",
          }}
        >
          Start over
        </button>
      </div>
    </div>
  );
}
