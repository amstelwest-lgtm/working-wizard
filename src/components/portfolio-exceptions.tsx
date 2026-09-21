/**
 * Portfolio by exception (P2.3) — the accountant's one screen.
 *
 * Which clients need a human today, and why, ranked. Each exception deep-links
 * to the studio tab that resolves it. Hidden when the firm has no clients.
 * Practice home passes hideWhenClear so an empty book does not render a card.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import type { PortfolioRow } from "@/lib/portfolio";
import { getFirmPortfolio, type PortfolioResult } from "@/lib/portfolio.functions";

type Props = {
  firmId: string | null;
  refreshKey?: string | number;
  className?: string;
  /**
   * Practice home: skip the all-clear card. Render a thin strip only when a
   * client actually needs a human today.
   */
  hideWhenClear?: boolean;
};

const SEV_CLASS: Record<1 | 2 | 3, string> = {
  1: "border-rose-400/50 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  2: "border-[#b7872a]/45 bg-[#d4a550]/15 text-[#7a5a0e] dark:text-[#f1d28b]",
  3: "border-slate-300/70 bg-slate-500/10 text-slate-600 dark:border-white/15 dark:text-slate-300",
};

export function PortfolioExceptions({ firmId, refreshKey, className, hideWhenClear }: Props) {
  const fetch = useServerFn(getFirmPortfolio);
  const [data, setData] = useState<PortfolioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (!firmId) return;
    const mine = ++seq.current;
    setLoading(true);
    fetch({ data: { firmId } })
      .then((res) => {
        if (mine === seq.current) setData(res);
      })
      .catch(() => {
        if (mine === seq.current) setData(null);
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
    // refreshKey is intentionally a dependency.
  }, [firmId, refreshKey, fetch]);

  if (!firmId || (!data && !loading)) return null;
  if (data && data.rows.length === 0) return null;

  const attention = data ? data.rows.filter((r) => r.exceptions.some((e) => e.severity <= 2)) : [];
  const quiet = data ? data.rows.filter((r) => !r.exceptions.some((e) => e.severity <= 2)) : [];
  const visible: PortfolioRow[] = showAll ? [...attention, ...quiet] : attention;

  if (hideWhenClear) {
    if (!data || attention.length === 0) return null;
    const shown = attention.slice(0, 3);
    const more = attention.length - shown.length;
    return (
      <section
        className={["attn-strip", className].filter(Boolean).join(" ")}
        id="portfolio-exceptions"
        data-attention={attention.length}
      >
        <h2>Needs attention</h2>
        <ul>
          {shown.map((r) => {
            const reasons = r.exceptions
              .filter((e) => e.severity <= 2)
              .map((e) => e.label)
              .join(" · ");
            const first = r.exceptions.find((e) => e.severity <= 2);
            return (
              <li key={r.clientId}>
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: r.clientId }}
                  search={{ tab: first?.tab } as never}
                  className="attn-strip-row"
                  data-client={r.clientId}
                >
                  <span className="attn-strip-name">{r.name}</span>
                  <span className="attn-strip-reason">{reasons || r.stateLabel}</span>
                  <span className="attn-strip-go">Open →</span>
                </Link>
              </li>
            );
          })}
          {more > 0 ? (
            <li className="attn-strip-more">and {more} more in the client list</li>
          ) : null}
        </ul>
      </section>
    );
  }

  const shell = [
    "rounded-2xl border border-[#b7872a]/25 bg-white/70 p-4 shadow-sm dark:border-[#d4a550]/20 dark:bg-white/[0.035]",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={shell} id="portfolio-exceptions" data-attention={attention.length}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="block text-[9.5px] font-bold uppercase tracking-[0.22em] text-[#9a7014] dark:text-[#e1b85e]">
            Portfolio
          </span>
          <h3 className="mt-0.5 text-[15px] font-bold leading-tight text-slate-900 dark:text-[#f4e7c2]">
            {loading && !data ? (
              "Checking every client…"
            ) : attention.length === 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> All{" "}
                {data?.summary.clients} clients are moving on their own
              </span>
            ) : (
              `${attention.length} of ${data?.summary.clients} clients need you`
            )}
          </h3>
          {data ? (
            <p className="mt-1 text-[12px] text-slate-600 dark:text-slate-300/80">
              {[
                data.summary.packsWaiting
                  ? `${data.summary.packsWaiting} pack${data.summary.packsWaiting === 1 ? "" : "s"} to sign off`
                  : null,
                data.summary.blockingData ? `${data.summary.blockingData} blocked on data` : null,
                data.summary.overdue ? `${data.summary.overdue} with overdue actions` : null,
                data.summary.wentBackwards
                  ? `${data.summary.wentBackwards} with a move that went backwards`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || "Nothing is blocking, overdue or unreviewed."}
            </p>
          ) : null}
        </div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden /> : null}
      </div>

      {visible.length > 0 ? (
        <ul className="mt-3 divide-y divide-[#b7872a]/15 dark:divide-white/10">
          {visible.map((r) => (
            <li
              key={r.clientId}
              className="flex flex-wrap items-start justify-between gap-2 py-2.5"
              data-client={r.clientId}
            >
              <div className="min-w-0">
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: r.clientId }}
                  className="text-[13.5px] font-semibold text-slate-900 underline-offset-2 hover:underline dark:text-[#f4e7c2]"
                >
                  {r.name}
                </Link>
                <span className="ml-2 text-[11px] text-slate-500 dark:text-slate-400">
                  {r.stateLabel}
                  {r.daysInState !== null ? ` · ${r.daysInState}d` : ""}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {r.exceptions.length === 0 ? (
                  <span className="text-[11px] text-slate-400">nothing outstanding</span>
                ) : (
                  r.exceptions.map((e) => (
                    <Link
                      key={e.kind}
                      to="/clients/$clientId"
                      params={{ clientId: r.clientId }}
                      search={{ tab: e.tab } as never}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10.5px] font-semibold ${SEV_CLASS[e.severity]}`}
                      data-exception={e.kind}
                    >
                      {e.severity === 1 ? <AlertTriangle className="h-3 w-3" aria-hidden /> : null}
                      {e.label}
                    </Link>
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {data && quiet.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-slate-500 dark:text-slate-400"
          aria-expanded={showAll}
        >
          {showAll ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          )}
          {showAll ? "Hide" : "Show"} {quiet.length} quiet client{quiet.length === 1 ? "" : "s"}
        </button>
      ) : null}
    </section>
  );
}
