import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { extractFinancials } from "@/lib/extract-financials.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FileDown, Mail, MessageCircle, Upload } from "lucide-react";
import { toast } from "sonner";
import { KpiTrendline, pctDelta } from "@/components/kpi-trendline";
import { BenchmarkBar } from "@/components/benchmark-bar";
import { computeRatios, BUSINESS_TYPE_TO_BENCHMARK, scoreTier } from "@/lib/ratios";
import { PDFUploadZone } from "@/components/pdf-upload-zone";
import { ExtractionReviewModal } from "@/components/extraction-review-modal";
import type { MergedExtractionResult } from "@/lib/extraction-types";
import type { MappedInputs } from "@/components/extraction-review-modal";
import { useMarketFormat } from "@/contexts/market";
import { formatMoney, localizeCopy, ZA_MARKET, type MoneyMarket } from "@/lib/market";

type Benchmark = { p25: number; p50: number; p75: number; unit: string; higher_is_better: boolean };

// Technical name (used in rows + snapshots) → metric_key in industry_benchmarks
const TECHNICAL_TO_METRIC_KEY: Record<string, string> = {
  "Net Margin": "netMargin",
  "Operating Margin": "operatingMargin",
  "Gross Margin": "grossMargin",
  "Return on Equity": "roe",
  "Return on Assets": "roa",
  "Asset Turnover": "assetTurnover",
  "Debtor Days": "debtorDays",
  "Inventory Days": "inventoryDays",
  "Creditor Days": "creditorDays",
  "Fixed Cost Ratio": "fixedCostRatio",
  "Sales-per-Employee Ratio": "salesPerEmployee",
};

type Inputs = {
  netIncome: string;
  ebt: string;
  ebit: string;
  revenue: string;
  totalAssets: string;
  equity: string;
  cogs: string;
  receivables: string;
  inventory: string;
  payables: string;
  fixedCosts: string;
  variableCosts: string;
  top5Revenue: string;
  laborCost: string;
  employees: string;
  operatingCashflow: string;
  ebitda: string;
  founderHours: string;
};

const DEFAULTS: Inputs = {
  netIncome: "120",
  ebt: "180",
  ebit: "220",
  revenue: "1000",
  totalAssets: "800",
  equity: "400",
  cogs: "600",
  receivables: "150",
  inventory: "120",
  payables: "90",
  fixedCosts: "300",
  variableCosts: "500",
  top5Revenue: "400",
  laborCost: "250",
  employees: "10",
  operatingCashflow: "180",
  ebitda: "240",
  founderHours: "2400",
};

const FIELD_LABELS: { key: keyof Inputs; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "cogs", label: "COGS" },
  { key: "ebit", label: "EBIT" },
  { key: "ebt", label: "EBT" },
  { key: "netIncome", label: "Net income" },
  { key: "ebitda", label: "EBITDA" },
  { key: "operatingCashflow", label: "Operating cash flow" },
  { key: "totalAssets", label: "Total assets" },
  { key: "equity", label: "Equity" },
  { key: "receivables", label: "Receivables (AR)" },
  { key: "inventory", label: "Inventory" },
  { key: "payables", label: "Payables (AP)" },
  { key: "fixedCosts", label: "Fixed costs" },
  { key: "variableCosts", label: "Variable costs" },
  { key: "top5Revenue", label: "Top-5 customer revenue" },
  { key: "laborCost", label: "Labor cost" },
  { key: "employees", label: "Employees" },
  { key: "founderHours", label: "Founder hours / yr" },
];

type RatioRow = {
  friendly: string;
  technical: string;
  formula: string;
  value: number;
  format: "pct" | "x" | "days" | "money";
  health: number;
  benchmark: string;
  nextSteps: string[];
};

function fmt(v: number, f: RatioRow["format"], market: MoneyMarket = ZA_MARKET) {
  if (!isFinite(v)) return "—";
  switch (f) {
    case "pct":
      return `${(v * 100).toFixed(1)}%`;
    case "x":
      return `${v.toFixed(2)}×`;
    case "days":
      return `${Math.round(v)} d`;
    case "money":
      return formatMoney(v, market);
  }
}

function healthCls(h: number) {
  if (!isFinite(h)) return "bg-slate-500 text-white";
  const tier = scoreTier(h);
  if (tier === "healthy") return "bg-emerald-600 text-white";
  if (tier === "at_risk") return "bg-amber-500 text-white";
  return "bg-rose-600 text-white";
}
function healthLabel(h: number) {
  if (!isFinite(h)) return "No data";
  const tier = scoreTier(h);
  if (tier === "healthy") return "Healthy";
  if (tier === "at_risk") return "Watch";
  return "Action";
}

type Contact = { email: string; phone: string };

export function AccountantRatiosPanel({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const { market } = useMarketFormat();
  const doExtract = useServerFn(extractFinancials);
  const [v, setV] = useState<Inputs>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [openRow, setOpenRow] = useState<RatioRow | null>(null);
  const [contact, setContact] = useState<Contact>({ email: "", phone: "" });
  const [contactOpen, setContactOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"email" | "whatsapp" | null>(null);
  const printRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<
    Array<{ period_label: string; period_date: string; ratios: Record<string, number> }>
  >([]);
  const [benchmarks, setBenchmarks] = useState<Record<string, Benchmark>>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingExtraction, setPendingExtraction] = useState<MergedExtractionResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Guards against the autosave effect firing the instant hydration finishes —
  // otherwise merely opening this panel bumps financials_updated_at and falsely
  // invalidates an accountant's sign-off with no real data change.
  const skipNextAutosave = useRef(false);

  const onUpload = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "csv" || file.type === "text/csv" || ext === "txt") {
      try {
        const result = await doExtract({ data: { fileName: file.name, text: await file.text() } });
        const extracted = (result as { financials?: Record<string, string> })?.financials ?? {};
        const filledKeys = Object.keys(extracted);
        if (filledKeys.length === 0) {
          toast.warning("Couldn't extract any figures from that file.");
        } else {
          setV((prev) => ({ ...prev, ...extracted }) as Inputs);
          toast.success(`Auto-filled ${filledKeys.length} fields from ${file.name}`);
        }
      } catch (e) {
        toast.error(`Upload failed: ${(e as Error).message}`);
      }
    } else if (ext === "xlsx" || ext === "xls") {
      try {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const parts: string[] = [];
        for (const name of wb.SheetNames) {
          parts.push(`--- Sheet: ${name} ---`);
          parts.push(XLSX.utils.sheet_to_csv(wb.Sheets[name]));
        }
        const result = await doExtract({ data: { fileName: file.name, text: parts.join("\n") } });
        const extracted = (result as { financials?: Record<string, string> })?.financials ?? {};
        const filledKeys = Object.keys(extracted);
        if (filledKeys.length === 0) {
          toast.warning("Couldn't extract any figures from that file.");
        } else {
          setV((prev) => ({ ...prev, ...extracted }) as Inputs);
          toast.success(`Auto-filled ${filledKeys.length} fields from ${file.name}`);
        }
      } catch (e) {
        toast.error(`Upload failed: ${(e as Error).message}`);
      }
    } else {
      toast.error("Unsupported file type. Use CSV, Excel, or PDF.");
    }
  };

  const applyExtraction = async (inputs: MappedInputs) => {
    const next: Inputs = { ...v };
    const map: Partial<Record<keyof Inputs, string | undefined>> = {
      revenue: inputs.revenue,
      cogs: inputs.cogs,
      ebit: inputs.ebit,
      ebt: inputs.ebt,
      netIncome: inputs.netIncome,
      ebitda: inputs.ebitda,
      operatingCashflow: inputs.operatingCashflow,
      totalAssets: inputs.totalAssets,
      equity: inputs.equity,
      receivables: inputs.receivables,
      inventory: inputs.inventory,
      payables: inputs.payables,
      fixedCosts: inputs.fixedCosts,
      laborCost: inputs.laborCost,
      employees: inputs.employees,
    };
    let filled = 0;
    for (const [k, val] of Object.entries(map)) {
      if (val !== undefined) {
        (next as Record<string, string>)[k] = val;
        filled++;
      }
    }
    setV(next);
    setUploadOpen(false);
    toast.success(`Populated ${filled} fields from extracted data`);

    // Save snapshot
    const now = new Date();
    const periodLabel = now.toLocaleString("en-US", { month: "short", year: "numeric" });
    const periodDate = now.toISOString().slice(0, 10);
    const ratios = computeRatios(next);
    const { error: snapErr } = await supabase.from("client_financial_snapshots").insert({
      client_id: clientId,
      period_label: periodLabel,
      period_date: periodDate,
      financials: next as never,
      ratios: ratios as never,
      source: "pdf_upload",
    });
    if (!snapErr) {
      setHistory((h) =>
        [...h, { period_label: periodLabel, period_date: periodDate, ratios }].slice(-6),
      );
    }
  };

  const onSaveSnapshot = async () => {
    const label = window.prompt(
      "Label for this snapshot (e.g. 'Apr 2026')",
      new Date().toLocaleString("en-US", { month: "short", year: "numeric" }),
    );
    if (!label) return;
    const dateStr = window.prompt(
      "Period date (YYYY-MM-DD)",
      new Date().toISOString().slice(0, 10),
    );
    if (!dateStr) return;
    const ratios = computeRatios(v);
    const { error } = await supabase.from("client_financial_snapshots").insert({
      client_id: clientId,
      period_label: label,
      period_date: dateStr,
      financials: v as never,
      ratios: ratios as never,
      source: "manual",
    });
    if (error) {
      toast.error(`Snapshot failed: ${error.message}`);
      return;
    }
    toast.success("Snapshot saved");
    const { data } = await supabase
      .from("client_financial_snapshots")
      .select("period_label, period_date, ratios")
      .eq("client_id", clientId)
      .order("period_date", { ascending: true })
      .limit(6);
    if (data) setHistory(data as never);
  };

  useEffect(() => {
    supabase
      .from("clients")
      .select("financials, contact_email, contact_phone, business_type")
      .eq("id", clientId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.financials) setV({ ...DEFAULTS, ...(data.financials as Partial<Inputs>) });
        setContact({ email: data?.contact_email ?? "", phone: data?.contact_phone ?? "" });
        skipNextAutosave.current = true;
        setLoaded(true);
        const bt = data?.business_type ? BUSINESS_TYPE_TO_BENCHMARK[data.business_type] : null;
        if (bt) {
          supabase
            .from("industry_benchmarks")
            .select("metric_key, p25, p50, p75, unit, higher_is_better")
            .eq("business_type", bt)
            .then(({ data: rows }) => {
              if (!rows) return;
              const map: Record<string, Benchmark> = {};
              for (const r of rows) {
                map[r.metric_key] = {
                  p25: Number(r.p25),
                  p50: Number(r.p50),
                  p75: Number(r.p75),
                  unit: r.unit,
                  higher_is_better: r.higher_is_better,
                };
              }
              setBenchmarks(map);
            });
        } else {
          setBenchmarks({});
        }
      });
    supabase
      .from("client_financial_snapshots")
      .select("period_label, period_date, ratios")
      .eq("client_id", clientId)
      .order("period_date", { ascending: true })
      .limit(6)
      .then(({ data }) => {
        if (data) setHistory(data as never);
      });
  }, [clientId]);

  useEffect(() => {
    if (!loaded) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    const t = setTimeout(async () => {
      const { error } = await supabase
        .from("clients")
        .update({ financials: v as never, financials_updated_at: new Date().toISOString() })
        .eq("id", clientId);
      if (error) {
        toast.error(`Save failed: ${error.message}`);
        return;
      }

      const now = new Date();
      const periodLabel = now.toLocaleString("en-US", { month: "short", year: "numeric" });
      const periodDate = now.toISOString().slice(0, 10);
      const ratios = computeRatios(v);

      const { data: existing } = await supabase
        .from("client_financial_snapshots")
        .select("id")
        .eq("client_id", clientId)
        .eq("period_label", periodLabel)
        .maybeSingle();

      if (existing?.id) {
        await supabase
          .from("client_financial_snapshots")
          .update({ financials: v as never, ratios: ratios as never })
          .eq("id", existing.id);
        setHistory((h) => {
          const idx = h.findIndex((s) => s.period_label === periodLabel);
          if (idx >= 0) {
            const next = [...h];
            next[idx] = { period_label: periodLabel, period_date: periodDate, ratios };
            return next;
          }
          return h;
        });
      } else {
        const { error: snapErr } = await supabase.from("client_financial_snapshots").insert({
          client_id: clientId,
          period_label: periodLabel,
          period_date: periodDate,
          financials: v as never,
          ratios: ratios as never,
          source: "auto",
        });
        if (!snapErr) {
          setHistory((h) =>
            [...h, { period_label: periodLabel, period_date: periodDate, ratios }].slice(-6),
          );
        }
      }
    }, 700);
    return () => clearTimeout(t);
  }, [v, loaded, clientId]);

  const rows = useMemo<RatioRow[]>(() => {
    const computed = computeRatios(v);
    const clamp = (x: number) => Math.max(0, Math.min(100, x));
    const hH = (val: number, target: number) => clamp((val / target) * 100);
    const hL = (val: number, max: number) => clamp(((max - val) / max) * 100);
    const hR = (val: number, lo: number, hi: number) => {
      if (val < lo) return clamp((val / lo) * 100);
      if (val > hi) return clamp(100 - ((val - hi) / hi) * 100);
      return 100;
    };

    const netMargin = computed["Net Margin"];
    const operatingMargin = computed["Operating Margin"];
    const grossMargin = computed["Gross Margin"];
    const assetTurnover = computed["Asset Turnover"];
    const equityMultiplier = computed["Equity Multiplier"];
    const roa = computed["Return on Assets"];
    const roe = computed["Return on Equity"];
    const debtorDays = computed["Debtor Days"];
    const inventoryDays = computed["Inventory Days"];
    const creditorDays = computed["Creditor Days"];
    const wcDays = computed["Working Capital Days"];
    const fcr = computed["Fixed Cost Ratio"];
    const dol = computed["Degree of Operating Leverage"];
    const cc = computed["Top-5 Customer Share"];
    const gpToLabor = computed["Gross Profit / Labor"];
    const spe = computed["Sales-per-Employee Ratio"];
    const ocfEbitda = computed["OCF / EBITDA"];
    const interestBurden = computed["Interest Burden"];
    const taxBurden = computed["Tax Burden"];

    return [
      {
        friendly: "Bottom-Line Strength",
        technical: "Net Margin",
        formula: "Net Income / Revenue",
        value: netMargin,
        format: "pct",
        health: hH(netMargin, 0.15),
        benchmark: "≥ 15%",
        nextSteps: [
          "Audit overheads — cut bottom 20% of non-revenue spend.",
          "Re-price the lowest-margin SKU/service.",
          "Move 10% of variable cost to performance-based supplier terms.",
        ],
      },
      {
        friendly: "Profit Power",
        technical: "Operating Margin",
        formula: "EBIT / Revenue",
        value: operatingMargin,
        format: "pct",
        health: hH(operatingMargin, 0.2),
        benchmark: "≥ 20%",
        nextSteps: [
          "Run a 30-day price test on the top product line.",
          "Renegotiate the 3 largest recurring supplier contracts.",
          "Cap discretionary spend at 5% of revenue this quarter.",
        ],
      },
      {
        friendly: "Gross Margin",
        technical: "Gross Margin",
        formula: "(Revenue − COGS) / Revenue",
        value: grossMargin,
        format: "pct",
        health: hH(grossMargin, 0.4),
        benchmark: "≥ 40%",
        nextSteps: [
          "Recost the top-3 SKUs at current input prices.",
          "Cut or reprice anything below 25% GM.",
          "Bundle low-margin items with high-margin add-ons.",
        ],
      },
      {
        friendly: "Shareholder Return",
        technical: "Return on Equity",
        formula: "Net Income / Equity (DuPont)",
        value: roe,
        format: "pct",
        health: hH(roe, 0.2),
        benchmark: "≥ 20%",
        nextSteps: [
          "Decide on a dividend vs. reinvestment policy.",
          "Push idle equity into a working-capital revolver.",
          "Set a 12-month ROE target with monthly check-ins.",
        ],
      },
      {
        friendly: "Asset Productivity",
        technical: "Return on Assets",
        formula: "Net Margin × Asset Turnover",
        value: roa,
        format: "pct",
        health: hH(roa, 0.1),
        benchmark: "≥ 10%",
        nextSteps: [
          "List underused assets — sell or sweat them.",
          "Move slow inventory before quarter-end.",
          "Consider leasing vs. owning for the next capex item.",
        ],
      },
      {
        friendly: "Asset Engine",
        technical: "Asset Turnover",
        formula: "Revenue / Total Assets",
        value: assetTurnover,
        format: "x",
        health: hH(assetTurnover, 1.5),
        benchmark: "≥ 1.5×",
        nextSteps: [
          "Defer non-essential capex this quarter.",
          "Convert idle assets into rentable capacity.",
          "Tighten the inventory reorder point by 15%.",
        ],
      },
      {
        friendly: "Leverage Level",
        technical: "Equity Multiplier",
        formula: "Total Assets / Equity",
        value: equityMultiplier,
        format: "x",
        health: hL(equityMultiplier, 4),
        benchmark: "≤ 4×",
        nextSteps: [
          "Refinance the highest-rate debt line.",
          "Pause new debt-funded purchases.",
          "Build a 3-month interest-coverage buffer.",
        ],
      },
      {
        friendly: "Debt Drag",
        technical: "Interest Burden",
        formula: "EBT / EBIT",
        value: interestBurden,
        format: "x",
        health: clamp(interestBurden * 100),
        benchmark: "→ 1.0×",
        nextSteps: [
          "Consolidate short-term debt into a single facility.",
          "Negotiate a rate cut on the largest loan.",
          "Stress-test cash flow at +2% rates.",
        ],
      },
      {
        friendly: "Tax Survival Rate",
        technical: "Tax Burden",
        formula: "Net Income / EBT",
        value: taxBurden,
        format: "x",
        health: clamp(taxBurden * 100),
        benchmark: "→ 1.0×",
        nextSteps: [
          "Review allowable deductions for the period.",
          "Time capex to optimise tax shields.",
          "Confirm provisional tax estimates are current.",
        ],
      },
      {
        friendly: "Customer Pay Speed",
        technical: "Debtor Days",
        formula: "AR / Revenue × 365",
        value: debtorDays,
        format: "days",
        health: hL(debtorDays, 90),
        benchmark: "≤ 90 d",
        nextSteps: [
          "Send statements weekly, not monthly.",
          "Offer 2% early-pay discount on invoices > 30 days.",
          "Move top-5 debtors to debit order or deposit.",
        ],
      },
      {
        friendly: "Stock Sitting Time",
        technical: "Inventory Days",
        formula: "Inventory / COGS × 365",
        value: inventoryDays,
        format: "days",
        health: hL(inventoryDays, 90),
        benchmark: "≤ 90 d",
        nextSteps: [
          "Run a clearance on items > 90 days on shelf.",
          "Drop two slowest SKUs.",
          "Switch top supplier to weekly drops.",
        ],
      },
      {
        friendly: "Supplier Pay Window",
        technical: "Creditor Days",
        formula: "AP / COGS × 365",
        value: creditorDays,
        format: "days",
        health: hR(creditorDays, 30, 60),
        benchmark: "30–60 d",
        nextSteps: [
          "Renegotiate terms to 45 days net.",
          "Schedule supplier payments weekly, not on demand.",
          "Use early-pay discounts only when > cost of capital.",
        ],
      },
      {
        friendly: "Cash Trapped Days",
        technical: "Working Capital Days",
        formula: "Debtor + Inventory − Creditor days",
        value: wcDays,
        format: "days",
        health: hL(wcDays, 90),
        benchmark: "≤ 90 d",
        nextSteps: [
          "Set a target WC-days number for the quarter.",
          "Tighten debtor terms by 10 days.",
          "Push creditor terms out by 10 days.",
        ],
      },
      {
        friendly: "Fixed-Cost Burden",
        technical: "Fixed Cost Ratio",
        formula: "Fixed Costs / Revenue",
        value: fcr,
        format: "pct",
        health: hL(fcr, 0.45),
        benchmark: "≤ 45%",
        nextSteps: [
          "Convert one fixed cost (e.g. office) to variable.",
          "Renegotiate the largest 2 fixed contracts.",
          "Sublet/share unused capacity.",
        ],
      },
      {
        friendly: "Downturn Risk",
        technical: "Degree of Operating Leverage",
        formula: "Contribution Margin / EBIT",
        value: dol,
        format: "x",
        health: hL(dol, 3),
        benchmark: "≤ 3×",
        nextSteps: [
          "Add a variable-pay layer to fixed roles.",
          "Build a 3-month cash reserve.",
          "Model a 20% revenue drop and act on the gap.",
        ],
      },
      {
        friendly: "Customer Dependency",
        technical: "Top-5 Customer Share",
        formula: "Top-5 Cust. Rev / Revenue",
        value: cc,
        format: "pct",
        health: hL(cc, 0.5),
        benchmark: "≤ 50%",
        nextSteps: [
          "Set a 90-day target to add 3 mid-size accounts.",
          "Lock top-5 in 12-month contracts.",
          "Productise to lower switching cost for new buyers.",
        ],
      },
      {
        friendly: "Labor ROI",
        technical: "Gross Profit / Labor",
        formula: "(Revenue − COGS) / Labor Cost",
        value: gpToLabor,
        format: "x",
        health: hH(gpToLabor, 2.5),
        benchmark: "≥ 2.5×",
        nextSteps: [
          "Tie 10% of pay to GP delivered.",
          "Automate the 3 most repetitive admin tasks.",
          "Review headcount vs. revenue per role.",
        ],
      },
      {
        friendly: "Sales per Employee",
        technical: "Sales-per-Employee Ratio",
        formula: "Revenue / Headcount",
        value: spe,
        format: "money",
        health: hH(spe, 200),
        benchmark: "≥ 200",
        nextSteps: [
          "Set per-role revenue contribution targets.",
          "Outsource non-core roles.",
          "Invest in tooling that lifts output 20%.",
        ],
      },
      {
        friendly: "Cash Quality",
        technical: "OCF / EBITDA",
        formula: "Operating Cash Flow / EBITDA",
        value: ocfEbitda,
        format: "x",
        health: hR(ocfEbitda, 0.75, 1.3),
        benchmark: "0.75–1.3×",
        nextSteps: [
          "Reconcile non-cash items in EBITDA monthly.",
          "Cut WC days to lift OCF.",
          "Flag revenue recognised but not collected.",
        ],
      },
    ];
  }, [v]);

  const sorted = useMemo(() => [...rows].sort((a, b) => a.health - b.health), [rows]);
  const worst3 = sorted.slice(0, 3);
  const best1 = sorted[sorted.length - 1];

  const set = (k: keyof Inputs) => (val: string) => setV((s) => ({ ...s, [k]: val }));

  const ensureContact = (action: "email" | "whatsapp") => {
    if (action === "email" && !contact.email) {
      setPendingAction(action);
      setContactOpen(true);
      return false;
    }
    if (action === "whatsapp" && !contact.phone) {
      setPendingAction(action);
      setContactOpen(true);
      return false;
    }
    return true;
  };

  const buildEmail = () => {
    const lows = worst3
      .map(
        (r, i) =>
          `${i + 1}. ${r.friendly} (${localizeCopy(r.technical, market)}): ${fmt(r.value, r.format, market)} — benchmark ${r.benchmark}\n   Suggested next step: ${localizeCopy(r.nextSteps[0], market)}`,
      )
      .join("\n\n");
    const high = best1
      ? `${best1.friendly}: ${fmt(best1.value, best1.format, market)} (benchmark ${best1.benchmark})`
      : "—";
    const subject = `${clientName} — financial health update & 3 priority actions`;
    const body = `Hi ${clientName},

I've just reviewed your latest numbers on Milōn. Quick summary:

What's working well
- ${high}

Where we should focus — top 3 immediate actions
${lows}

I'd like to set up a 30-minute call to walk through these and agree the next steps. What does your week look like?

Best,
Your Milōn accountant`;
    return { subject, body };
  };

  const buildWhatsapp = () => {
    const w = worst3[0];
    const wTxt = w
      ? `${w.friendly} is at ${fmt(w.value, w.format, market)} (benchmark ${w.benchmark}) — worth a closer look.`
      : "";
    const bTxt = best1
      ? `Good news: ${best1.friendly} is healthy at ${fmt(best1.value, best1.format, market)}.`
      : "";
    return `Hi ${clientName}, quick Milōn update.\n\n${bTxt}\n${wTxt}\n\nWant to set up a short call to discuss ${w?.friendly ?? "your numbers"}?`;
  };

  const onEmail = () => {
    if (!ensureContact("email")) return;
    const { subject, body } = buildEmail();
    window.location.href = `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const onWhatsapp = () => {
    if (!ensureContact("whatsapp")) return;
    const phone = contact.phone.replace(/[^0-9]/g, "");
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(buildWhatsapp())}`, "_blank");
  };

  const onPdf = async () => {
    try {
      toast("Generating PDF…");
      const { jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      const date = new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      pdf.setFontSize(16);
      pdf.setFont("helvetica", "bold");
      pdf.text(`${clientName} — Financial Ratios`, 14, 18);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Generated: ${date}`, 14, 25);

      const tableRows = rows.map((r) => {
        const health = !isFinite(r.health)
          ? "—"
          : scoreTier(r.health) === "healthy"
            ? "Healthy"
            : scoreTier(r.health) === "at_risk"
              ? "Watch"
              : "Action";
        return [
          r.friendly,
          localizeCopy(r.technical, market),
          fmt(r.value, r.format, market),
          r.benchmark,
          isFinite(r.health) ? `${Math.round(r.health)}%` : "—",
          health,
        ];
      });

      autoTable(pdf, {
        startY: 30,
        head: [["Ratio", "Technical Name", "Value", "Benchmark", "Health", "Status"]],
        body: tableRows,
        styles: { fontSize: 8, cellPadding: 2.5 },
        headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        columnStyles: {
          0: { fontStyle: "bold", cellWidth: 38 },
          1: { cellWidth: 36 },
          2: { halign: "right", cellWidth: 22 },
          3: { halign: "right", cellWidth: 22 },
          4: { halign: "right", cellWidth: 16 },
          5: { cellWidth: 18 },
        },
      });

      pdf.save(
        `${clientName.replace(/\s+/g, "-").toLowerCase()}-ratios-${new Date().toISOString().slice(0, 10)}.pdf`,
      );
      toast.success("PDF downloaded");
    } catch (e) {
      console.error("PDF export failed:", e);
      toast.error("PDF export failed — please try again.");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">Actions</CardTitle>
            <CardDescription>Export, email a draft, or WhatsApp the client.</CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={onPdf}>
              <FileDown className="h-4 w-4 mr-1" />
              Export PDF
            </Button>
            <Button size="sm" onClick={onEmail}>
              <Mail className="h-4 w-4 mr-1" />
              Email draft
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={onWhatsapp}
            >
              <MessageCircle className="h-4 w-4 mr-1" />
              WhatsApp
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-base">Financials (auto-saved)</CardTitle>
            <CardDescription>Edit the figures, or upload a statement to auto-fill.</CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={onSaveSnapshot}>
              Save snapshot
            </Button>
            <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
              <Upload className="h-4 w-4 mr-1" />
              Upload statement
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {FIELD_LABELS.map((f) => (
            <div key={f.key}>
              <Label className="text-xs text-muted-foreground">{f.label}</Label>
              <Input
                type="number"
                value={v[f.key]}
                onChange={(e) => set(f.key)(e.target.value)}
                className="h-8"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ratios — accountant summary</CardTitle>
          <CardDescription>
            Click any row to see suggested next steps for the client.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <div ref={printRef}>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b">
                <tr>
                  <th className="text-left p-3">Client-side name</th>
                  <th className="text-left p-3">Technical name</th>
                  <th className="text-left p-3">Formula</th>
                  <th className="text-right p-3 r">Value</th>
                  <th className="text-left p-3">6-mo trend</th>
                  <th className="text-left p-3">Benchmark</th>
                  <th className="text-left p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const series = history.map((h) => Number(h.ratios?.[r.technical] ?? NaN));
                  const fullSeries = [...series, r.value].filter((n) => isFinite(n));
                  const delta = pctDelta(fullSeries);
                  return (
                    <tr
                      key={r.technical}
                      className="border-b last:border-0 cursor-pointer hover:bg-accent/40"
                      onClick={() => setOpenRow(r)}
                    >
                      <td className="p-3 font-medium">{r.friendly}</td>
                      <td className="p-3 text-muted-foreground">
                        {localizeCopy(r.technical, market)}
                      </td>
                      <td className="p-3 text-muted-foreground font-mono text-xs">
                        {localizeCopy(r.formula, market)}
                      </td>
                      <td className="p-3 text-right font-semibold tabular-nums r">
                        {fmt(r.value, r.format, market)}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <KpiTrendline values={fullSeries} />
                          {delta !== null && (
                            <span
                              className={`text-xs ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                            >
                              {delta >= 0 ? "+" : ""}
                              {(delta * 100).toFixed(1)}%
                            </span>
                          )}
                          {delta === null && (
                            <span className="text-xs text-muted-foreground">
                              {fullSeries.length < 2 ? "needs 2+ snapshots" : "—"}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        {(() => {
                          const mk = TECHNICAL_TO_METRIC_KEY[r.technical];
                          const b = mk ? benchmarks[mk] : null;
                          return b ? (
                            <div className="flex flex-col gap-1">
                              <BenchmarkBar value={r.value} benchmark={b} width={140} />
                              <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                                25% {fmt(b.p25, r.format, market)} · 50%{" "}
                                {fmt(b.p50, r.format, market)} · 75% {fmt(b.p75, r.format, market)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">{r.benchmark}</span>
                          );
                        })()}
                      </td>
                      <td className="p-3">
                        <Badge className={healthCls(r.health)}>{healthLabel(r.health)}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!openRow} onOpenChange={(o) => !o && setOpenRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{openRow?.friendly}</DialogTitle>
            <DialogDescription>
              {openRow ? localizeCopy(openRow.technical, market) : ""} ·{" "}
              {openRow ? fmt(openRow.value, openRow.format, market) : ""} · benchmark{" "}
              {openRow?.benchmark}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs font-mono text-muted-foreground">
              {openRow ? localizeCopy(openRow.formula, market) : ""}
            </div>
            <div>
              <div className="text-sm font-semibold mb-2">Suggested next steps for the client</div>
              <ol className="list-decimal pl-5 space-y-1 text-sm">
                {openRow?.nextSteps.map((s, i) => (
                  <li key={i}>{localizeCopy(s, market)}</li>
                ))}
              </ol>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* PDF Upload dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-lg bg-slate-950 border-slate-800 text-slate-200">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Upload Financial Statement</DialogTitle>
            <DialogDescription className="text-slate-500">
              Upload up to 3 PDFs — income statement, balance sheet, and/or cash flow. CSV and Excel
              files are also supported via the manual field below.
            </DialogDescription>
          </DialogHeader>
          <PDFUploadZone
            onComplete={(extraction) => {
              setPendingExtraction(extraction);
              setReviewOpen(true);
            }}
            onError={(msg) => toast.error(msg)}
          />
          <div className="border-t border-slate-800 pt-3">
            <p className="text-[10px] text-slate-600 mb-2">
              Or upload CSV / Excel to auto-fill without AI review:
            </p>
            <input
              type="file"
              accept=".csv,.xlsx,.xls,text/csv"
              className="text-xs text-slate-400 file:mr-2 file:rounded file:border-0 file:bg-slate-800 file:px-2 file:py-1 file:text-xs file:text-slate-300 hover:file:bg-slate-700"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  onUpload(f);
                  setUploadOpen(false);
                }
                e.target.value = "";
              }}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Extraction review modal */}
      {pendingExtraction && (
        <ExtractionReviewModal
          result={pendingExtraction}
          open={reviewOpen}
          onClose={() => {
            setReviewOpen(false);
            setPendingExtraction(null);
          }}
          onConfirm={applyExtraction}
        />
      )}

      <Dialog open={contactOpen} onOpenChange={setContactOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Client contact details</DialogTitle>
            <DialogDescription>
              Saved to the client record so any team member can use them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Email</Label>
              <Input
                value={contact.email}
                onChange={(e) => setContact({ ...contact, email: e.target.value })}
                placeholder="client@company.com"
              />
            </div>
            <div>
              <Label className="text-xs">WhatsApp number (with country code)</Label>
              <Input
                value={contact.phone}
                onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                placeholder="+27821234567"
              />
            </div>
            <Button
              onClick={async () => {
                const { error } = await supabase
                  .from("clients")
                  .update({
                    contact_email: contact.email || null,
                    contact_phone: contact.phone || null,
                  })
                  .eq("id", clientId);
                if (error) {
                  toast.error(error.message);
                  return;
                }
                setContactOpen(false);
                if (pendingAction === "email") onEmail();
                if (pendingAction === "whatsapp") onWhatsapp();
                setPendingAction(null);
              }}
            >
              Save & continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
