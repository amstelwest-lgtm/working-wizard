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
import {
  mergeNeedsAttention,
  needsAttentionToday,
  todayAttentionAction,
  type AttentionItem,
  type MergedAttention,
} from "@/lib/portfolio-dashboard";
import { clientHomeSearch } from "@/lib/client-home-search";
import { canonicalizeAccountantSearch } from "@/lib/client-route-search";

/** Studio page that resolves this row. Overdue plan work opens the Overdue page. */
function attentionSearch(row: Pick<MergedAttention, "tab" | "section" | "overdue">) {
  return canonicalizeAccountantSearch({
    tab: row.tab,
    section: row.section ?? (row.tab === "plan" && row.overdue ? "overdue" : undefined),
  });
}

type Props = {
  firmId: string | null;
  refreshKey?: string | number;
  className?: string;
  /**
   * Practice home: skip the all-clear card. Render call-cards only when a
   * client actually needs a human today.
   */
  hideWhenClear?: boolean;
  /**
   * Health alerts from the practice book. Merged with pack sign-off into the
   * one Needs attention strip so the dashboard does not show two queues.
   * Ignored when `queue` is set.
   */
  healthItems?: AttentionItem[];
  /**
   * Practice home: the queue `practiceNeedsAttention` already counted.
   * When set, the strip renders these rows and does not fetch a second book.
   */
  queue?: readonly MergedAttention[];
  /** Chase → opens a draft for this client. It does not send. */
  onChase?: (clientId: string, name: string) => void;
  /**
   * The needs-attention page draws the heading itself so it stays up while
   * the queue is still loading. The list then renders without a second title.
   */
  showHeading?: boolean;
};

const SEV_CLASS: Record<1 | 2 | 3, string> = {
  1: "border-rose-400/50 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  2: "border-[#B7791F]/40 bg-[#B7791F]/10 text-[#8A5A12] dark:text-[#F0D59A]",
  3: "border-slate-300/70 bg-slate-500/10 text-slate-600 dark:border-white/15 dark:text-slate-300",
};

function wantsChase(row: MergedAttention): boolean {
  return row.tab === "plan" && row.overdue;
}

export function PortfolioExceptions({
  firmId,
  refreshKey,
  className,
  hideWhenClear,
  healthItems,
  queue,
  onChase,
  showHeading = true,
}: Props) {
  const fetch = useServerFn(getFirmPortfolio);
  const [data, setData] = useState<PortfolioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const seq = useRef(0);
  const externalQueue = queue !== undefined;

  useEffect(() => {
    if (externalQueue || !firmId) return;
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
  }, [externalQueue, firmId, refreshKey, fetch]);

  if (!firmId) return null;

  if (hideWhenClear) {
    const merged = needsAttentionToday(
      queue ?? mergeNeedsAttention(healthItems ?? [], data?.rows ?? []),
    );
    if ((!data && loading && merged.length === 0) || merged.length === 0) return null;
    const shown = showHeading ? merged.slice(0, 6) : merged;
    const more = merged.length - shown.length;
    const list = (
      <ul className={showHeading ? "flex flex-col gap-2" : "mt-3 flex flex-col gap-2"}>
        {shown.map((row) => {
          const search = attentionSearch(row);
          const extra = row.detail.trim();
          const showDetail = extra.length > 0 && !row.reason.includes(extra);
          const chase = wantsChase(row);
          const why = showDetail ? `${row.reason} · ${extra}` : row.reason;
          return (
            <li
              key={row.clientId}
                className="flex items-stretch gap-3 rounded-xl border border-[color:var(--line)] bg-white px-3.5 py-3 dark:bg-[#102A43]"
              data-client={row.clientId}
              data-reason={row.reason}
            >
              <span
                className={`w-1 shrink-0 self-stretch rounded-full ${
                  row.bucket === "review" ? "bg-[#C43D4B]" : "bg-[#B7791F]"
                }`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1 self-center">
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: row.clientId }}
                  search={search}
                    className="block truncate text-[15px] font-bold no-underline hover:underline"
                >
                  {row.name}
                </Link>
                <p className="attn-strip-reason mb-0 mt-0.5 truncate" title={why}>
                  {row.reason}
                  {showDetail ? <span className="attn-strip-detail"> · {extra}</span> : null}
                </p>
              </div>
              {chase ? (
                <button
                  type="button"
                  className="btn gold mini self-center shrink-0"
                  aria-label={`Chase ${row.name}`}
                  onClick={() => onChase?.(row.clientId, row.name)}
                >
                  {todayAttentionAction(row)}
                </button>
              ) : (
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: row.clientId }}
                  search={search}
                  className="btn gold mini self-center shrink-0"
                  aria-label={`Open ${row.name}`}
                >
                  {todayAttentionAction(row)}
                </Link>
              )}
            </li>
          );
        })}
        {more > 0 ? (
          <li>
            <Link to="/practice/needs-attention" className="btn ghost mini">
              See {more} more
            </Link>
          </li>
        ) : null}
      </ul>
    );
    if (!showHeading) return list;
    return (
      <section
        className={[
          "rounded-2xl border border-[color:var(--line)] bg-white p-4 shadow-sm dark:bg-[#102A43]",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        id="needs-attention"
        aria-label="Needs attention today"
        data-attention={merged.length}
        data-today="true"
      >
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="m-0 text-[15px] font-bold leading-tight text-[#102A43] dark:text-[#F4F7FB]">
            Needs attention today
          </h2>
          <span className="text-[12px] font-semibold tabular-nums text-[#3D5270] dark:text-[#9FB3C8]">
            {merged.length === 1 ? "1 client" : `${merged.length} clients`}
          </span>
        </div>
        {list}
      </section>
    );
  }

  if (!data && !loading) return null;
  if (data && data.rows.length === 0) return null;

  const attention = data ? data.rows.filter((r) => r.exceptions.some((e) => e.severity <= 2)) : [];
  const quiet = data ? data.rows.filter((r) => !r.exceptions.some((e) => e.severity <= 2)) : [];
  const visible: PortfolioRow[] = showAll ? [...attention, ...quiet] : attention;

  const shell = [
    "rounded-2xl border border-[#DBEAFE] bg-white p-4 shadow-sm dark:border-[#1e3a5f] dark:bg-[#102A43]",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={shell} id="portfolio-exceptions" data-attention={attention.length}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="block text-xs font-bold uppercase tracking-[0.22em] text-[#102A43] dark:text-[#F4F7FB]">
            Portfolio
          </span>
          <h3 className="mt-0.5 text-[15px] font-bold leading-tight text-slate-900 dark:text-[#F4F7FB]">
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
        <ul className="mt-3 divide-y divide-[#DBEAFE] dark:divide-[#1e3a5f]">
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
                  search={clientHomeSearch()}
                  className="text-[13.5px] font-semibold text-[#102A43] underline-offset-2 hover:underline dark:text-[#F4F7FB]"
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
                      search={canonicalizeAccountantSearch({ tab: e.tab, section: e.section })}
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
