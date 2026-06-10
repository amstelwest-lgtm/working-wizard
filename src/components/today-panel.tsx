import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askYourNumbers } from "@/lib/ai.functions";
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  Sparkles,
  TrendingUp,
  Wallet,
  ListChecks,
  Target,
  Send,
  Activity,
  Users,
} from "lucide-react";
import { toast } from "sonner";

export type TodayAlert = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
};

export type TodayTask = {
  id: string;
  title: string;
  employeeName?: string | null;
  dueDate?: string | null;
};

type Props = {
  clientId: string | null;
  clientName?: string | null;
  businessType?: string | null;
  cashRunwayWeeks?: number | null;
  ratios: Record<string, { value: number; format: "x" | "pct" | "days" | "money" }>;
  healthMap: Record<string, number>;
  financials: Record<string, number | string | null | undefined>;
  topTasks: TodayTask[];
  topNextSteps: Array<{ key: string; title: string; ratioName: string; icon: string; impactLine: string }>;
  onOpenNextSteps: () => void;
  onOpenTasks: () => void;
  onOpenCash: () => void;
};

function deriveAlerts(
  cashRunwayWeeks: number | null | undefined,
  ratios: Props["ratios"],
  healthMap: Record<string, number>,
): TodayAlert[] {
  const out: TodayAlert[] = [];
  if (typeof cashRunwayWeeks === "number" && cashRunwayWeeks < 8) {
    out.push({
      id: "runway",
      severity: cashRunwayWeeks < 4 ? "high" : "medium",
      title: `Cash runway only ${cashRunwayWeeks.toFixed(1)} weeks`,
      detail: "Tighten collections, defer non-essential spend, and review the 13-week forecast now.",
    });
  }
  const dd = ratios.debtorDays?.value;
  if (isFinite(dd) && dd > 60) {
    out.push({
      id: "debtors",
      severity: dd > 90 ? "high" : "medium",
      title: `Debtor days at ${dd.toFixed(0)}`,
      detail: "Customers are paying slowly. Chase the top 5 overdue invoices today.",
    });
  }
  const om = ratios.operatingMargin?.value;
  if (isFinite(om) && om < 0.05) {
    out.push({
      id: "margin",
      severity: om < 0 ? "high" : "medium",
      title: `Operating margin ${(om * 100).toFixed(1)}%`,
      detail: "Margins are thin. Identify the lowest-margin product/service and reprice or cut.",
    });
  }
  const cc = ratios.customerConcentration?.value;
  if (isFinite(cc) && cc > 0.5) {
    out.push({
      id: "concentration",
      severity: cc > 0.7 ? "high" : "medium",
      title: `Top-5 customers = ${(cc * 100).toFixed(0)}% of revenue`,
      detail: "Heavy dependence — losing one client is existential. Diversify pipeline.",
    });
  }
  const ocf = ratios.ocfToEbitda?.value;
  if (isFinite(ocf) && ocf < 0.6) {
    out.push({
      id: "ocf",
      severity: "medium",
      title: `Profits not converting to cash (${(ocf * 100).toFixed(0)}%)`,
      detail: "Working capital is absorbing earnings. Audit AR, inventory, and prepayments.",
    });
  }
  if (out.length === 0) {
    const sorted = Object.entries(healthMap)
      .filter(([, v]) => isFinite(v))
      .sort((a, b) => a[1] - b[1])
      .slice(0, 2);
    for (const [k, v] of sorted) {
      if (v < 60)
        out.push({
          id: `weak-${k}`,
          severity: v < 30 ? "high" : "low",
          title: `Watch: ${k}`,
          detail: `Health score ${v.toFixed(0)}/100 — open the dashboard for fixes.`,
        });
    }
  }
  return out.slice(0, 4);
}

function MetricTile({
  label,
  value,
  unit,
  hint,
  accent,
  Icon,
  onClick,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  accent: "gold" | "blue" | "green" | "red";
  Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  onClick?: () => void;
}) {
  const accentVar =
    accent === "gold"
      ? "var(--accent-gold)"
      : accent === "blue"
        ? "var(--accent-blue)"
        : accent === "green"
          ? "var(--accent-green)"
          : "var(--accent-red)";
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-xl border border-slate-200 bg-white p-4 text-left transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
      style={{ boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ background: accentVar }}
      />
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">
          <Icon className="h-3.5 w-3.5" style={{ color: accentVar }} />
          {label}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300 transition-transform group-hover:translate-x-0.5" />
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span
          className="text-[28px] font-semibold leading-none tracking-tight text-slate-900 dark:text-slate-50"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
      {hint && <div className="mt-1.5 text-[11px] text-slate-500">{hint}</div>}
    </button>
  );
}

export function TodayPanel(props: Props) {
  const {
    clientId, clientName, businessType, cashRunwayWeeks,
    ratios, healthMap, financials, topTasks, topNextSteps,
  } = props;
  const ask = useServerFn(askYourNumbers);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [askOpen, setAskOpen] = useState(false);

  const alerts = useMemo(() => deriveAlerts(cashRunwayWeeks, ratios, healthMap), [cashRunwayWeeks, ratios, healthMap]);
  const nba = topNextSteps[0];

  const ratioSnapshot = useMemo(() => {
    const out: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(ratios)) {
      if (isFinite(v.value)) out[k] = v.format === "pct" ? Number((v.value * 100).toFixed(2)) : Number(v.value.toFixed(2));
    }
    return out;
  }, [ratios]);

  const submit = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setAnswer("");
    try {
      const res = await ask({
        data: {
          clientId: clientId ?? undefined,
          question: question.trim(),
          context: {
            clientName: clientName ?? undefined,
            businessType: businessType ?? undefined,
            cashRunwayWeeks: cashRunwayWeeks ?? null,
            ratios: ratioSnapshot,
            financials: Object.fromEntries(
              Object.entries(financials).filter(([, v]) => v !== undefined && v !== null && v !== ""),
            ),
            alerts: alerts.map((a) => `${a.title}: ${a.detail}`),
          },
        },
      });
      setAnswer(res.answer || "No answer.");
    } catch (e: any) {
      toast.error(e?.message ?? "Ask failed");
    } finally {
      setLoading(false);
    }
  };

  const sevDot = (s: TodayAlert["severity"]) =>
    s === "high" ? "var(--accent-red)" : s === "medium" ? "#d97706" : "var(--accent-blue)";

  const hasRunway = typeof cashRunwayWeeks === "number" && isFinite(cashRunwayWeeks);
  const om = ratios.operatingMargin?.value;
  const dd = ratios.debtorDays?.value;

  return (
    <div className="space-y-5">
      {/* Section header */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">Today</p>
          <h2
            className="mt-1 text-[22px] leading-tight tracking-tight text-slate-900 dark:text-slate-50"
            style={{ fontFamily: "var(--font-display)" }}
          >
            What needs your attention
          </h2>
        </div>
      </div>

      {/* Hero metric strip */}
      <div id="wizard-today-metrics" className="grid gap-3 sm:grid-cols-3">
        <MetricTile
          label="Cash runway"
          value={hasRunway ? cashRunwayWeeks!.toFixed(1) : "—"}
          unit="weeks"
          hint={hasRunway ? (cashRunwayWeeks! >= 13 ? "Healthy · 13+ weeks" : cashRunwayWeeks! >= 8 ? "Sufficient" : cashRunwayWeeks! >= 4 ? "Tight" : "Critical") : "Add cash & burn to compute"}
          accent="gold"
          Icon={Wallet}
          onClick={props.onOpenCash}
        />
        <MetricTile
          label="Operating margin"
          value={isFinite(om) ? `${(om * 100).toFixed(1)}%` : "—"}
          hint={isFinite(om) ? (om >= 0.15 ? "Strong" : om >= 0.05 ? "Acceptable" : "Under pressure") : "Awaiting inputs"}
          accent="blue"
          Icon={Activity}
          onClick={props.onOpenNextSteps}
        />
        <MetricTile
          label="Debtor days"
          value={isFinite(dd) ? dd.toFixed(0) : "—"}
          unit="days"
          hint={isFinite(dd) ? (dd <= 30 ? "Fast collection" : dd <= 60 ? "On terms" : "Slow — chase AR") : "Awaiting inputs"}
          accent={isFinite(dd) && dd > 60 ? "red" : "green"}
          Icon={Users}
          onClick={props.onOpenNextSteps}
        />
      </div>

      {/* Next best action */}
      <button
        id="wizard-today-nba"
        type="button"
        onClick={props.onOpenNextSteps}
        className="group flex w-full items-start gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
        style={{ boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}
      >
        <span
          className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
          style={{ background: "rgba(201,150,43,0.12)", color: "var(--accent-gold)" }}
        >
          <Target className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Next best move
          </div>
          {nba ? (
            <>
              <div
                className="mt-1 text-[17px] leading-snug text-slate-900 dark:text-slate-50"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {nba.title}
              </div>
              <div className="mt-1 text-[12px] text-slate-500">{nba.ratioName} · {nba.impactLine}</div>
            </>
          ) : (
            <div className="mt-1 text-sm text-slate-500">Add your numbers to see prioritised actions.</div>
          )}
        </div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5" />
      </button>

      {/* Alerts */}
      <section id="wizard-today-alerts" className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" style={{ boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
            <AlertTriangle className="h-3.5 w-3.5" style={{ color: "var(--accent-red)" }} />
            Alerts
            <span className="text-slate-400">· {alerts.length}</span>
          </div>
        </header>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {alerts.length === 0 && (
            <li className="flex items-center gap-2 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
              <TrendingUp className="h-4 w-4" style={{ color: "var(--accent-green)" }} />
              No critical alerts. Keep the discipline.
            </li>
          )}
          {alerts.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={a.id === "runway" ? props.onOpenCash : props.onOpenNextSteps}
                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <span
                  aria-hidden
                  className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: sevDot(a.severity) }}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">{a.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-[12px] text-slate-500">{a.detail}</div>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Open tasks */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" style={{ boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
            <ListChecks className="h-3.5 w-3.5" style={{ color: "var(--accent-blue)" }} />
            Open tasks
          </div>
          <button onClick={props.onOpenTasks} className="text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
            View all →
          </button>
        </header>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {topTasks.length === 0 && (
            <li className="px-4 py-3 text-sm text-slate-500">Nothing assigned. Use “Assign” on any KPI to delegate.</li>
          )}
          {topTasks.slice(0, 3).map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={props.onOpenTasks}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">{t.title}</div>
                  <div className="mt-0.5 text-[12px] text-slate-500">
                    {t.employeeName ?? "Unassigned"}
                  </div>
                </div>
                <div className="shrink-0 text-[11px] tabular-nums text-slate-500">
                  {t.dueDate ?? ""}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Ask your numbers — collapsed search bar */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" style={{ boxShadow: "0 1px 2px rgba(15,23,42,0.04)" }}>
        {!askOpen ? (
          <button
            type="button"
            onClick={() => setAskOpen(true)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50"
          >
            <Sparkles className="h-4 w-4" style={{ color: "var(--accent-gold)" }} />
            Ask anything about your numbers…
          </button>
        ) : (
          <div className="space-y-3 p-4">
            <div className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
              <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--accent-gold)" }} />
              Ask your numbers
            </div>
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. Can I afford to hire a junior next month? What's killing my margin?"
              className="min-h-[80px]"
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              {[
                "Can I afford a new hire this quarter?",
                "What's my biggest cash leak?",
                "Where am I weakest vs industry?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => setQuestion(q)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={submit} disabled={loading || !question.trim()}>
                <Send className="mr-2 h-4 w-4" /> {loading ? "Thinking…" : "Ask"}
              </Button>
              <button
                type="button"
                onClick={() => { setAskOpen(false); setAnswer(""); }}
                className="text-[12px] text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              >
                Cancel
              </button>
            </div>
            {answer && (
              <div className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
                {answer}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
