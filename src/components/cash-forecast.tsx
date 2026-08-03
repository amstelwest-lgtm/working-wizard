import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Maximize2, X, Download, SlidersHorizontal, Upload } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine } from "recharts";
// jsPDF + autoTable are dynamically imported inside exportPDF to avoid blocking initial hydration.

type Frequency =
  | "recurring-weekly"
  | "recurring-monthly"
  | "once-off"
  | "split-weeks"
  | "split-months";

type LineItem = {
  id: string;
  name: string;
  amount: string;
  frequency: Frequency;
  startWeek: number;
  splitCount: number;
};

const WEEKS = 13;

const FREQ_LABEL: Record<Frequency, string> = {
  "recurring-weekly": "Recurring (weekly)",
  "recurring-monthly": "Recurring (monthly)",
  "once-off": "Once-off",
  "split-weeks": "Split over N weeks",
  "split-months": "Split over N months",
};

const newId = () => Math.random().toString(36).slice(2, 9);

const makeLine = (name: string): LineItem => ({
  id: newId(),
  name,
  amount: "",
  frequency: "recurring-monthly",
  startWeek: 1,
  splitCount: 3,
});

const DEFAULT_REVENUE: LineItem[] = [
  { ...makeLine("Recurring sales"), frequency: "recurring-monthly" },
  { ...makeLine("Once-off sales"), frequency: "once-off" },
  { ...makeLine("Project / milestone revenue"), frequency: "split-months" },
];

const EXPENSE_PRESETS = [
  "Cost of sales (COS)",
  "Interest",
  "Loan capital repayment",
  "Rent",
  "Salaries & wages",
];

const DEFAULT_EXPENSES: LineItem[] = EXPENSE_PRESETS.map((n) => makeLine(n));
const DEFAULT_OTHER: LineItem[] = [makeLine("Other expenses")];

function distribute(line: LineItem): number[] {
  const out = new Array(WEEKS).fill(0);
  const amt = parseFloat(line.amount) || 0;
  if (amt === 0) return out;
  const start = Math.max(1, Math.min(WEEKS, line.startWeek)) - 1;
  switch (line.frequency) {
    case "recurring-weekly":
      for (let i = start; i < WEEKS; i++) out[i] = amt;
      break;
    case "recurring-monthly":
      for (let i = start; i < WEEKS; i += 4) out[i] = amt;
      break;
    case "once-off":
      out[start] = amt;
      break;
    case "split-weeks": {
      const n = Math.max(1, line.splitCount);
      const per = amt / n;
      for (let i = start; i < Math.min(WEEKS, start + n); i++) out[i] = per;
      break;
    }
    case "split-months": {
      const n = Math.max(1, line.splitCount);
      const per = amt / n;
      for (let i = 0; i < n; i++) {
        const w = start + i * 4;
        if (w < WEEKS) out[w] = per;
      }
      break;
    }
  }
  return out;
}

function fmtR(n: number) {
  return `R ${n.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`;
}

function LineEditor({
  line,
  onChange,
  onRemove,
  tone,
}: {
  line: LineItem;
  onChange: (l: LineItem) => void;
  onRemove?: () => void;
  tone: "revenue" | "expense";
}) {
  const accent =
    tone === "revenue" ? "border-emerald-700/40 bg-emerald-950/30" : "border-rose-800/40 bg-rose-950/20";
  const showSplit = line.frequency === "split-weeks" || line.frequency === "split-months";
  return (
    <div className={`grid gap-2 rounded-lg border p-3 md:grid-cols-12 ${accent}`}>
      <div className="md:col-span-3">
        <Label className="text-[10px] uppercase tracking-wider text-slate-400">Line item</Label>
        <Input
          value={line.name}
          onChange={(e) => onChange({ ...line, name: e.target.value })}
          className="bg-slate-950/60 text-slate-100"
        />
      </div>
      <div className="md:col-span-2">
        <Label className="text-[10px] uppercase tracking-wider text-slate-400">Amount (R)</Label>
        <Input
          type="number"
          value={line.amount}
          onChange={(e) => onChange({ ...line, amount: e.target.value })}
          className="bg-slate-950/60 text-slate-100"
        />
      </div>
      <div className="md:col-span-3">
        <Label className="text-[10px] uppercase tracking-wider text-slate-400">Frequency</Label>
        <Select
          value={line.frequency}
          onValueChange={(v) => onChange({ ...line, frequency: v as Frequency })}
        >
          <SelectTrigger className="bg-slate-950/60 text-slate-100">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FREQ_LABEL) as Frequency[]).map((k) => (
              <SelectItem key={k} value={k}>
                {FREQ_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="md:col-span-2">
        <Label className="text-[10px] uppercase tracking-wider text-slate-400">Start week</Label>
        <Input
          type="number"
          min={1}
          max={WEEKS}
          value={line.startWeek}
          onChange={(e) => onChange({ ...line, startWeek: parseInt(e.target.value) || 1 })}
          className="bg-slate-950/60 text-slate-100"
        />
      </div>
      <div className="md:col-span-2">
        {showSplit ? (
          <>
            <Label className="text-[10px] uppercase tracking-wider text-slate-400">
              {line.frequency === "split-weeks" ? "# weeks" : "# months"}
            </Label>
            <Input
              type="number"
              min={1}
              value={line.splitCount}
              onChange={(e) => onChange({ ...line, splitCount: parseInt(e.target.value) || 1 })}
              className="bg-slate-950/60 text-slate-100"
            />
          </>
        ) : (
          <div />
        )}
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="mt-1 h-7 w-full text-rose-300 hover:bg-rose-900/30 hover:text-rose-200"
          >
            <Trash2 className="h-3 w-3" /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}

export function CashForecastPanel({ clientId, simplified }: { clientId?: string; simplified?: boolean } = {}) {
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [openingBalance, setOpeningBalance] = useState("0");
  const [revenue, setRevenue] = useState<LineItem[]>(DEFAULT_REVENUE);
  const [expenses, setExpenses] = useState<LineItem[]>(DEFAULT_EXPENSES);
  const [other, setOther] = useState<LineItem[]>(DEFAULT_OTHER);
  const [revAdj, setRevAdj] = useState(100); // %
  const [expAdj, setExpAdj] = useState(100); // %
  const [collectDelay, setCollectDelay] = useState(0); // weeks shift inflows right
  const [headcountDelta, setHeadcountDelta] = useState(0); // +/- people
  const [avgSalary, setAvgSalary] = useState("0"); // monthly per head
  const [fixedCostDelta, setFixedCostDelta] = useState("0"); // monthly +/- $
  const [revGrowthPct, setRevGrowthPct] = useState(0); // % per week, compounding
  const [capexAmount, setCapexAmount] = useState("0");
  const [capexWeek, setCapexWeek] = useState(1);
  const [loaded, setLoaded] = useState(!clientId);

  useEffect(() => {
    if (!clientId) return;
    supabase.from("clients").select("cashflow").eq("id", clientId).maybeSingle()
      .then(({ data }) => {
        const cf = data?.cashflow as {
          startDate?: string; openingBalance?: string;
          revenue?: LineItem[]; expenses?: LineItem[]; other?: LineItem[];
          revAdj?: number; expAdj?: number; collectDelay?: number;
          headcountDelta?: number; avgSalary?: string; fixedCostDelta?: string;
          revGrowthPct?: number; capexAmount?: string; capexWeek?: number;
        } | null;
        if (cf) {
          if (cf.startDate) setStartDate(cf.startDate);
          if (cf.openingBalance != null) setOpeningBalance(cf.openingBalance);
          if (cf.revenue) setRevenue(cf.revenue);
          if (cf.expenses) setExpenses(cf.expenses);
          if (cf.other) setOther(cf.other);
          if (cf.revAdj != null) setRevAdj(cf.revAdj);
          if (cf.expAdj != null) setExpAdj(cf.expAdj);
          if (cf.collectDelay != null) setCollectDelay(cf.collectDelay);
          if (cf.headcountDelta != null) setHeadcountDelta(cf.headcountDelta);
          if (cf.avgSalary != null) setAvgSalary(cf.avgSalary);
          if (cf.fixedCostDelta != null) setFixedCostDelta(cf.fixedCostDelta);
          if (cf.revGrowthPct != null) setRevGrowthPct(cf.revGrowthPct);
          if (cf.capexAmount != null) setCapexAmount(cf.capexAmount);
          if (cf.capexWeek != null) setCapexWeek(cf.capexWeek);
        }
        setLoaded(true);
      });
  }, [clientId]);

  useEffect(() => {
    if (!clientId || !loaded) return;
    const t = setTimeout(async () => {
      const payload = { startDate, openingBalance, revenue, expenses, other, revAdj, expAdj, collectDelay, headcountDelta, avgSalary, fixedCostDelta, revGrowthPct, capexAmount, capexWeek };
      const { error } = await supabase
        .from("clients")
        .update({ cashflow: payload as never, last_forecast_at: new Date().toISOString() })
        .eq("id", clientId);
      if (error) toast.error(`Cash forecast save failed: ${error.message}`);
    }, 800);
    return () => clearTimeout(t);
  }, [clientId, loaded, startDate, openingBalance, revenue, expenses, other, revAdj, expAdj, collectDelay, headcountDelta, avgSalary, fixedCostDelta, revGrowthPct, capexAmount, capexWeek]);

  const weeks = useMemo(() => {
    const d = new Date(startDate);
    return Array.from({ length: WEEKS }, (_, i) => {
      const w = new Date(d);
      w.setDate(d.getDate() + i * 7);
      return w.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });
    });
  }, [startDate]);

  const computeScenario = (opts: {
    rMul: number; eMul: number; shift: number;
    headcountDelta: number; avgSalary: number; fixedCostDelta: number;
    revGrowthPct: number; capexAmount: number; capexWeek: number;
  }) => {
    const shift = Math.max(0, Math.min(WEEKS - 1, Math.round(opts.shift)));
    const shiftVals = (vals: number[]) => {
      if (!shift) return vals;
      const out = new Array(WEEKS).fill(0);
      for (let i = 0; i < WEEKS; i++) {
        const j = i + shift;
        if (j < WEEKS) out[j] += vals[i];
      }
      return out;
    };
    const growthMul = (i: number) => Math.pow(1 + opts.revGrowthPct / 100, i);
    const revRows = revenue.map((l) => ({
      name: l.name,
      vals: shiftVals(distribute(l).map((v) => v * opts.rMul)).map((v, i) => v * growthMul(i)),
    }));
    const expRows = [...expenses, ...other].map((l) => ({
      name: l.name,
      vals: distribute(l).map((v) => v * opts.eMul),
    }));
    const headcountWeekly = (opts.headcountDelta * opts.avgSalary) / 4.33;
    const fixedWeekly = opts.fixedCostDelta / 4.33;
    const scenarioRows: { name: string; vals: number[] }[] = [];
    if (headcountWeekly !== 0) {
      scenarioRows.push({
        name: `Headcount Δ (${opts.headcountDelta > 0 ? "+" : ""}${opts.headcountDelta})`,
        vals: new Array(WEEKS).fill(headcountWeekly),
      });
    }
    if (fixedWeekly !== 0) {
      scenarioRows.push({ name: `Fixed cost Δ`, vals: new Array(WEEKS).fill(fixedWeekly) });
    }
    if (opts.capexAmount !== 0) {
      const w = Math.max(1, Math.min(WEEKS, opts.capexWeek)) - 1;
      const capvals = new Array(WEEKS).fill(0);
      capvals[w] = opts.capexAmount;
      scenarioRows.push({ name: `Capex (W${w + 1})`, vals: capvals });
    }
    const allExpRows = [...expRows, ...scenarioRows];
    const inflow = new Array(WEEKS).fill(0);
    const outflow = new Array(WEEKS).fill(0);
    revRows.forEach((r) => r.vals.forEach((v, i) => (inflow[i] += v)));
    allExpRows.forEach((r) => r.vals.forEach((v, i) => (outflow[i] += v)));
    const net = inflow.map((v, i) => v - outflow[i]);
    const opening = parseFloat(openingBalance) || 0;
    const closing: number[] = [];
    let bal = opening;
    for (let i = 0; i < WEEKS; i++) {
      bal += net[i];
      closing.push(bal);
    }
    return { revRows, expRows: allExpRows, inflow, outflow, net, closing, opening };
  };

  const calc = useMemo(() => computeScenario({
    rMul: revAdj / 100, eMul: expAdj / 100, shift: collectDelay,
    headcountDelta, avgSalary: parseFloat(avgSalary) || 0,
    fixedCostDelta: parseFloat(fixedCostDelta) || 0,
    revGrowthPct, capexAmount: parseFloat(capexAmount) || 0, capexWeek,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [revenue, expenses, other, openingBalance, revAdj, expAdj, collectDelay, headcountDelta, avgSalary, fixedCostDelta, revGrowthPct, capexAmount, capexWeek]);

  const baseCalc = useMemo(() => computeScenario({
    rMul: 1, eMul: 1, shift: 0,
    headcountDelta: 0, avgSalary: 0, fixedCostDelta: 0,
    revGrowthPct: 0, capexAmount: 0, capexWeek: 1,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [revenue, expenses, other, openingBalance]);

  const updateAt = (
    list: LineItem[],
    setList: (l: LineItem[]) => void,
    idx: number,
    next: LineItem,
  ) => {
    const c = [...list];
    c[idx] = next;
    setList(c);
  };

  const [fullscreen, setFullscreen] = useState(false);
  const lowestBal = Math.min(...calc.closing);

  const exportPDF = async () => {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(16);
    doc.text("13-Week Cash Forecast", 40, 40);
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text(
      `Start: ${startDate}   Opening: ${fmtR(calc.opening)}   Closing W13: ${fmtR(calc.closing[WEEKS - 1])}   Lowest: ${fmtR(lowestBal)}`,
      40,
      58,
    );
    doc.text(
      `Scenario  -  Revenue: ${revAdj}%   Expenses: ${expAdj}%   Collection delay: ${collectDelay}w`,
      40,
      72,
    );
    const head = [["Item", ...weeks.map((w, i) => `W${i + 1}\n${w}`)]];
    const body: (string | number)[][] = [];
    calc.revRows.forEach((r) => body.push([r.name, ...r.vals.map((v) => (v ? fmtR(v) : "—"))]));
    body.push(["Total inflow", ...calc.inflow.map((v) => fmtR(v))]);
    calc.expRows.forEach((r) =>
      body.push([r.name, ...r.vals.map((v) => (v ? `(${fmtR(v)})` : "—"))]),
    );
    body.push(["Total outflow", ...calc.outflow.map((v) => `(${fmtR(v)})`)]);
    body.push(["Net cash", ...calc.net.map((v) => fmtR(v))]);
    body.push(["Closing balance", ...calc.closing.map((v) => fmtR(v))]);
    autoTable(doc, {
      head,
      body,
      startY: 90,
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillAlignment: "center", fillColor: [30, 41, 59], textColor: 255 } as never,
      columnStyles: { 0: { cellWidth: 110, fontStyle: "bold" } },
      didParseCell: (d) => {
        const last = body.length - 1;
        if (d.section === "body" && d.row.index === last) {
          d.cell.styles.fillColor = [12, 74, 110];
          d.cell.styles.textColor = 255;
          d.cell.styles.fontStyle = "bold";
        }
      },
    });
    doc.save(`cash-forecast-${startDate}.pdf`);
  };

  // ── Simplified view: 4-week snapshot (net movement + closing balance only) ──
  if (simplified) {
    const SIMPLE_WEEKS = 4;
    const weekLabels = weeks.slice(0, SIMPLE_WEEKS);
    const net4    = calc.net.slice(0, SIMPLE_WEEKS);
    const close4  = calc.closing.slice(0, SIMPLE_WEEKS);
    return (
      <div className="space-y-4">
        <Card className="border-2 border-slate-700/40 bg-slate-900/70 shadow-xl">
          <CardHeader className="border-b border-slate-700/30 pb-3">
            <CardTitle className="text-slate-100 text-sm">4-Week Cash Snapshot</CardTitle>
            <CardDescription className="text-slate-400 text-xs">
              Net movement and closing balance · Opening: {fmtR(calc.opening)}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700/40 text-slate-400">
                  <th className="py-2 pr-3 text-left">Row</th>
                  {weekLabels.map((w, i) => (
                    <th key={i} className="py-2 text-right">
                      W{i + 1}
                      <div className="text-[9px] font-normal text-slate-500">{w}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-800/40 font-semibold text-slate-100">
                  <td className="py-2 pr-3">Net movement</td>
                  {net4.map((v, i) => (
                    <td key={i} className={`py-2 text-right ${v < 0 ? "text-rose-300" : "text-emerald-300"}`}>
                      {fmtR(v)}
                    </td>
                  ))}
                </tr>
                <tr className="bg-sky-950/30 font-bold text-sky-100">
                  <td className="py-2 pr-3">Closing balance</td>
                  {close4.map((v, i) => (
                    <td key={i} className={`py-2 text-right ${v < 0 ? "text-rose-300" : "text-sky-200"}`}>
                      {fmtR(v)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={fullscreen ? "fixed inset-0 z-[100] overflow-auto bg-slate-950 p-3 sm:p-5" : "space-y-5"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="md:hidden text-xs text-sky-300">
          {fullscreen ? "Tip: rotate your phone to landscape." : ""}
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportPDF}
            className="border-emerald-700/50 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50"
          >
            <Download className="h-3 w-3" /> Export PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFullscreen((f) => !f)}
            className="border-sky-700/50 bg-sky-950/40 text-sky-200 hover:bg-sky-900/50"
          >
            {fullscreen ? (<><X className="h-3 w-3" /> Exit full screen</>) : (<><Maximize2 className="h-3 w-3" /> Full screen</>)}
          </Button>
        </div>
      </div>
      <div className="space-y-5">
      <Card id="wizard-cash-table" className="border-2 border-slate-700/40 bg-slate-900/70 shadow-xl">
        <CardHeader className="border-b border-slate-700/30">
          <CardTitle className="text-slate-100">Weekly Forecast</CardTitle>
          <CardDescription className="text-slate-400">
            Closing balance per week. Red = shortfall, act early.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto pt-5">
          <table className="w-full min-w-[900px] text-xs">
            <thead>
              <tr className="border-b border-slate-700/40 text-slate-400">
                <th className="sticky left-0 bg-slate-900/70 px-2 py-2 text-left">Item</th>
                {weeks.map((w, i) => (
                  <th key={i} className="px-2 py-2 text-right">
                    W{i + 1}
                    <div className="text-[9px] font-normal text-slate-500">{w}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calc.revRows.map((r, i) => (
                <tr key={`r${i}`} className="border-b border-slate-800/40 text-emerald-200">
                  <td className="sticky left-0 bg-slate-900/70 px-2 py-1">{r.name}</td>
                  {r.vals.map((v, j) => (
                    <td key={j} className="px-2 py-1 text-right">
                      {v ? fmtR(v) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-b border-slate-700/60 bg-emerald-950/20 font-semibold text-emerald-200">
                <td className="sticky left-0 bg-slate-900/90 px-2 py-1">Total inflow</td>
                {calc.inflow.map((v, j) => (
                  <td key={j} className="px-2 py-1 text-right">
                    {fmtR(v)}
                  </td>
                ))}
              </tr>
              {calc.expRows.map((r, i) => (
                <tr key={`e${i}`} className="border-b border-slate-800/40 text-rose-200">
                  <td className="sticky left-0 bg-slate-900/70 px-2 py-1">{r.name}</td>
                  {r.vals.map((v, j) => (
                    <td key={j} className="px-2 py-1 text-right">
                      {v ? `(${fmtR(v)})` : "—"}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-b border-slate-700/60 bg-rose-950/20 font-semibold text-rose-200">
                <td className="sticky left-0 bg-slate-900/90 px-2 py-1">Total outflow</td>
                {calc.outflow.map((v, j) => (
                  <td key={j} className="px-2 py-1 text-right">
                    ({fmtR(v)})
                  </td>
                ))}
              </tr>
              <tr className="border-b border-slate-700/60 font-semibold text-slate-100">
                <td className="sticky left-0 bg-slate-900/90 px-2 py-1">Net cash</td>
                {calc.net.map((v, j) => (
                  <td
                    key={j}
                    className={`px-2 py-1 text-right ${v < 0 ? "text-rose-300" : "text-emerald-300"}`}
                  >
                    {fmtR(v)}
                  </td>
                ))}
              </tr>
              <tr className="bg-sky-950/30 font-bold text-sky-100">
                <td className="sticky left-0 bg-slate-900/90 px-2 py-1">Closing balance</td>
                {calc.closing.map((v, j) => (
                  <td
                    key={j}
                    className={`px-2 py-1 text-right ${v < 0 ? "text-rose-300" : "text-sky-200"}`}
                  >
                    {fmtR(v)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card id="wizard-cash-scenario" className="border-2 border-amber-700/40 bg-slate-900/70 shadow-xl">
        <CardHeader className="border-b border-slate-700/30">
          <CardTitle className="flex items-center gap-2 text-amber-200">
            <SlidersHorizontal className="h-4 w-4" /> Scenario Sliders
          </CardTitle>
          <CardDescription className="text-slate-400">
            Stress-test the forecast. What if revenue drops 20%? What if customers pay 2 weeks late?
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 pt-5 md:grid-cols-3">
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <Label className="uppercase tracking-wider text-slate-400">Revenue</Label>
              <span className={`font-bold ${revAdj < 100 ? "text-rose-300" : revAdj > 100 ? "text-emerald-300" : "text-slate-200"}`}>{revAdj}%</span>
            </div>
            <Slider value={[revAdj]} min={50} max={150} step={5} onValueChange={(v) => setRevAdj(v[0])} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <Label className="uppercase tracking-wider text-slate-400">Expenses</Label>
              <span className={`font-bold ${expAdj > 100 ? "text-rose-300" : expAdj < 100 ? "text-emerald-300" : "text-slate-200"}`}>{expAdj}%</span>
            </div>
            <Slider value={[expAdj]} min={50} max={150} step={5} onValueChange={(v) => setExpAdj(v[0])} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <Label className="uppercase tracking-wider text-slate-400">Collection delay</Label>
              <span className={`font-bold ${collectDelay > 0 ? "text-rose-300" : "text-slate-200"}`}>+{collectDelay}w</span>
            </div>
            <Slider value={[collectDelay]} min={0} max={6} step={1} onValueChange={(v) => setCollectDelay(v[0])} />
          </div>
          <div className="md:col-span-3 mt-2 border-t border-slate-700/40 pt-4 grid gap-5 md:grid-cols-3">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-slate-400">Headcount Δ (people)</Label>
              <div className="mt-1 flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setHeadcountDelta(headcountDelta - 1)}>−</Button>
                <Input type="number" value={headcountDelta} onChange={(e) => setHeadcountDelta(parseInt(e.target.value) || 0)} className="bg-slate-950/60 text-slate-100 text-center" />
                <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={() => setHeadcountDelta(headcountDelta + 1)}>+</Button>
              </div>
              <Label className="mt-2 block text-[10px] uppercase tracking-wider text-slate-400">Avg monthly salary (R)</Label>
              <Input type="number" value={avgSalary} onChange={(e) => setAvgSalary(e.target.value)} className="bg-slate-950/60 text-slate-100" />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-slate-400">Fixed cost Δ (monthly R, +/-)</Label>
              <Input type="number" value={fixedCostDelta} onChange={(e) => setFixedCostDelta(e.target.value)} className="bg-slate-950/60 text-slate-100" />
              <div className="mt-3 mb-1 flex items-center justify-between text-xs">
                <Label className="uppercase tracking-wider text-slate-400">Revenue growth / week</Label>
                <span className={`font-bold ${revGrowthPct < 0 ? "text-rose-300" : revGrowthPct > 0 ? "text-emerald-300" : "text-slate-200"}`}>{revGrowthPct > 0 ? "+" : ""}{revGrowthPct}%</span>
              </div>
              <Slider value={[revGrowthPct]} min={-10} max={10} step={0.5} onValueChange={(v) => setRevGrowthPct(v[0])} />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-slate-400">One-off capex (R)</Label>
              <Input type="number" value={capexAmount} onChange={(e) => setCapexAmount(e.target.value)} className="bg-slate-950/60 text-slate-100" />
              <Label className="mt-2 block text-[10px] uppercase tracking-wider text-slate-400">In week #</Label>
              <Input type="number" min={1} max={WEEKS} value={capexWeek} onChange={(e) => setCapexWeek(parseInt(e.target.value) || 1)} className="bg-slate-950/60 text-slate-100" />
            </div>
          </div>

          <div className="md:col-span-3 mt-2 border-t border-slate-700/40 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-[10px] uppercase tracking-wider text-slate-400">Closing balance: base vs scenario</Label>
              <div className="text-[10px] text-slate-500">Dashed = base · Solid = scenario</div>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={weeks.map((w, i) => ({ week: `W${i + 1}`, label: w, base: Math.round(baseCalc.closing[i]), scenario: Math.round(calc.closing[i]) }))}
                  margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="week" stroke="#94a3b8" fontSize={10} />
                  <YAxis stroke="#94a3b8" fontSize={10} tickFormatter={(v) => `R${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => fmtR(v)}
                  />
                  <ReferenceLine y={0} stroke="#f43f5e" strokeDasharray="2 2" />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="base" name="Base" stroke="#94a3b8" strokeDasharray="5 5" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="scenario" name="Scenario" stroke="#38bdf8" dot={false} strokeWidth={2.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-700/40 pt-4">
            <div className="flex flex-wrap gap-3 text-xs">
              <div className="rounded-md border border-sky-700/40 bg-sky-950/30 px-3 py-1.5">
                <span className="text-slate-400">Closing W13: </span>
                <span className="font-bold text-slate-100">{fmtR(calc.closing[WEEKS - 1])}</span>
                <span className={`ml-2 ${calc.closing[WEEKS - 1] - baseCalc.closing[WEEKS - 1] >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  ({calc.closing[WEEKS - 1] - baseCalc.closing[WEEKS - 1] >= 0 ? "+" : ""}{fmtR(calc.closing[WEEKS - 1] - baseCalc.closing[WEEKS - 1])} vs base)
                </span>
              </div>
              <div className="rounded-md border border-amber-700/40 bg-amber-950/30 px-3 py-1.5">
                <span className="text-slate-400">Lowest balance: </span>
                <span className={`font-bold ${Math.min(...calc.closing) < 0 ? "text-rose-300" : "text-emerald-300"}`}>{fmtR(Math.min(...calc.closing))}</span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRevAdj(100); setExpAdj(100); setCollectDelay(0);
                setHeadcountDelta(0); setAvgSalary("0"); setFixedCostDelta("0");
                setRevGrowthPct(0); setCapexAmount("0"); setCapexWeek(1);
              }}
              className="text-slate-400 hover:text-slate-100"
            >
              Reset all scenarios
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card id="wizard-cash-setup" className="border-2 border-slate-700/40 bg-slate-900/70 shadow-xl">
        <CardHeader className="border-b border-slate-700/30">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-slate-100">13-Week Cash Forecast</CardTitle>
              <CardDescription className="text-slate-400">
                Forecast every cent of cash in and out of the bank for the next 13 weeks. Catch a
                shortfall before it hits.
              </CardDescription>
            </div>
            <div>
              <input
                type="file"
                accept=".csv,.txt"
                className="hidden"
                id="cf-csv-import"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  file.text().then((raw) => {
                    const rows = raw.split(/\r?\n/).map((r) => r.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));
                    const newRev: typeof DEFAULT_REVENUE = [];
                    const newExp: typeof DEFAULT_EXPENSES = [];
                    for (const row of rows) {
                      if (row.length < 2) continue;
                      const name = row[0];
                      const amt = parseFloat(row[1].replace(/[^0-9.\-]/g, ""));
                      if (!name || !isFinite(amt)) continue;
                      const typeHint = (row[2] ?? "").toLowerCase();
                      const isExpense = amt < 0 || typeHint.startsWith("exp") || typeHint.startsWith("cost");
                      const line: LineItem = { id: newId(), name, amount: String(Math.abs(amt)), frequency: "recurring-monthly", startWeek: 1, splitCount: 3 };
                      if (isExpense) newExp.push(line); else newRev.push(line);
                    }
                    if (newRev.length) setRevenue(newRev);
                    if (newExp.length) setExpenses(newExp);
                    if (!newRev.length && !newExp.length) {
                      toast.warning("No valid rows found. Use format: Name, Amount, [revenue|expense]");
                    } else {
                      toast.success(`Imported ${newRev.length} revenue + ${newExp.length} expense lines`);
                    }
                    e.target.value = "";
                  });
                }}
              />
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs"
                onClick={() => document.getElementById("cf-csv-import")?.click()}
              >
                <Upload className="h-3.5 w-3.5" />
                Import CSV
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-400">
                Forecast start date
              </Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-slate-950/60 text-slate-100"
              />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wider text-slate-400">
                Opening bank balance (R)
              </Label>
              <Input
                type="number"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                className="bg-slate-950/60 text-slate-100"
              />
            </div>
            <div className="rounded-lg border border-sky-800/40 bg-sky-950/30 p-3">
              <div className="text-[10px] uppercase tracking-wider text-sky-300">
                Projected closing (week 13)
              </div>
              <div className="text-xl font-bold text-slate-100">
                {fmtR(calc.closing[WEEKS - 1])}
              </div>
              <div
                className={`text-xs ${lowestBal < 0 ? "text-rose-300" : "text-emerald-300"}`}
              >
                Lowest balance: {fmtR(lowestBal)}{" "}
                {lowestBal < 0 ? "⚠ shortfall" : "✓ in the black"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-2 border-emerald-800/40 bg-slate-900/70 shadow-xl">
        <CardHeader className="border-b border-slate-700/30">
          <CardTitle className="text-emerald-300">Revenue Inputs</CardTitle>
          <CardDescription className="text-slate-400">
            Add every cash inflow. Pick how it lands across the 13 weeks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-5">
          {revenue.map((l, i) => (
            <LineEditor
              key={l.id}
              line={l}
              tone="revenue"
              onChange={(n) => updateAt(revenue, setRevenue, i, n)}
              onRemove={revenue.length > 1 ? () => setRevenue(revenue.filter((_, x) => x !== i)) : undefined}
            />
          ))}
          <Button
            variant="outline"
            onClick={() => setRevenue([...revenue, makeLine("New revenue line")])}
            className="w-full border-emerald-700/50 bg-emerald-950/30 text-emerald-200 hover:bg-emerald-900/40"
          >
            <Plus className="h-4 w-4" /> Add revenue line
          </Button>
        </CardContent>
      </Card>

      <Card className="border-2 border-rose-800/40 bg-slate-900/70 shadow-xl">
        <CardHeader className="border-b border-slate-700/30">
          <CardTitle className="text-rose-300">Expense Inputs</CardTitle>
          <CardDescription className="text-slate-400">
            5 main expense slots, plus catch-all "other expenses". Add as many lines as you need.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-5">
          <div className="text-[10px] font-bold uppercase tracking-wider text-rose-300/70">
            Main expenses
          </div>
          {expenses.map((l, i) => (
            <LineEditor
              key={l.id}
              line={l}
              tone="expense"
              onChange={(n) => updateAt(expenses, setExpenses, i, n)}
            />
          ))}
          <div className="mt-4 text-[10px] font-bold uppercase tracking-wider text-rose-300/70">
            Other expenses
          </div>
          {other.map((l, i) => (
            <LineEditor
              key={l.id}
              line={l}
              tone="expense"
              onChange={(n) => updateAt(other, setOther, i, n)}
              onRemove={other.length > 1 ? () => setOther(other.filter((_, x) => x !== i)) : undefined}
            />
          ))}
          <Button
            variant="outline"
            onClick={() => setOther([...other, makeLine("Other expense")])}
            className="w-full border-rose-700/50 bg-rose-950/30 text-rose-200 hover:bg-rose-900/40"
          >
            <Plus className="h-4 w-4" /> Add other expense line
          </Button>
        </CardContent>
      </Card>

      </div>
    </div>
  );
}
