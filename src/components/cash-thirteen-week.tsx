import { useEffect, useRef, useState } from "react";
import { figureSourceChipLabel } from "@/lib/ledger-link-copy";
import { cn } from "@/lib/utils";
import { parseEditableAmount } from "@/lib/cash-week-overrides";

const WEEKS = 13;

export type CashWeekLine = {
  id: string;
  name: string;
  vals: number[];
  bucket?: "revenue" | "expenses" | "other";
};

type CellKind = "in" | "out" | "signed" | "balance";
type RowTone = "plain" | "in" | "out" | "net" | "close" | "floor";

type GridRow = {
  key: string;
  name: string;
  chip: string;
  values: number[];
  total: number | null;
  kind: CellKind;
  blankZero: boolean;
  tone: RowTone;
  strong?: boolean;
  editable?: { bucket: "revenue" | "expenses" | "other"; id: string };
};

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function showMoney(
  value: number,
  fmt: (n: number) => string,
  kind: CellKind,
  blankZero: boolean,
): string {
  if (!Number.isFinite(value) || (blankZero && Math.abs(value) < 0.005)) return "—";
  const body = fmt(Math.abs(value));
  if (kind === "out") return `(${body})`;
  if (value < -0.005) return `(${body})`;
  return fmt(value);
}

function ForecastAmountCell({
  symbol,
  value,
  display,
  onCommit,
}: {
  symbol: string;
  value: number;
  display: string;
  onCommit: (next: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const begin = () => {
    setDraft(value ? String(value) : "");
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    onCommit(parseEditableAmount(draft));
  };

  if (editing) {
    return (
      <span className="inline-flex items-baseline justify-end gap-0.5">
        <span className="text-[inherit] opacity-80">{symbol}</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
            }
          }}
          inputMode="decimal"
          aria-label="Edit amount"
          className="w-[4.75rem] border-0 border-b border-[#d4af37] bg-transparent p-0 text-right text-xs tabular-nums text-inherit outline-none"
        />
      </span>
    );
  }

  return (
    <button
      type="button"
      title="Double-click to edit"
      onDoubleClick={(e) => {
        e.preventDefault();
        begin();
      }}
      className="milon-forecast-amount w-full cursor-text border-0 bg-transparent p-0 text-right text-inherit decoration-[#d4af37]/70 decoration-dotted underline-offset-2 hover:underline"
    >
      {display}
    </button>
  );
}

function SourceChip({ source }: { source: string }) {
  const label = figureSourceChipLabel(source);
  if (!label) return null;
  return (
    <span className="inline-flex max-w-full truncate rounded-full border border-[#d4af37]/40 bg-[#d4af37]/12 px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.08em] text-[#7a5a16] dark:text-[#e7c56a]">
      {label}
    </span>
  );
}

const TONE_BG: Record<RowTone, string> = {
  plain: "bg-[#fbf8f1] dark:bg-[#10161f]",
  in: "bg-[#e7f6ee] dark:bg-[#10241c]",
  out: "bg-[#fbeeee] dark:bg-[#2a1619]",
  net: "bg-[#fbf8f1] dark:bg-[#10161f]",
  close: "bg-[#f6edd8] dark:bg-[#231f14]",
  floor: "bg-[#f6f3ea] dark:bg-[#141a22]",
};

const TIGHT_BG = "bg-[#fde8e6] dark:bg-[#3c1c22]";
const HEAD_BG = "bg-[#f3ecdc] dark:bg-[#1b170f]";
const HEAD_TIGHT = "bg-[#f6d2cf] dark:bg-[#4a2228]";

function tightOf(closing: number, floor: number): "negative" | "floor" | null {
  if (closing < 0) return "negative";
  if (closing < floor) return "floor";
  return null;
}

export function CashThirteenWeekGrid({
  weeks,
  opening,
  receipts,
  payments,
  inflow,
  outflow,
  net,
  closing,
  floor,
  floorNote,
  symbol,
  format,
  openingChip,
  flowChip,
  onCommit,
}: {
  weeks: string[];
  opening: number;
  receipts: CashWeekLine[];
  payments: CashWeekLine[];
  inflow: number[];
  outflow: number[];
  net: number[];
  closing: number[];
  floor: number;
  floorNote?: string | null;
  symbol: string;
  format: (n: number) => string;
  openingChip: string;
  flowChip: string;
  onCommit: (
    bucket: "revenue" | "expenses" | "other",
    id: string,
    weekIndex: number,
    value: number | null,
  ) => void;
}) {
  const openings = closing.map((_, index) => (index === 0 ? opening : closing[index - 1]!));
  const tight = closing.map((value) => tightOf(value, floor));
  const visibleReceipts = receipts.filter((line) => line.vals.some((value) => value));
  const visiblePayments = payments.filter((line) => line.vals.some((value) => value));

  const lineRow = (
    line: CashWeekLine,
    kind: CellKind,
    tone: RowTone,
  ): GridRow => ({
    key: line.id,
    name: line.name,
    chip: flowChip,
    values: line.vals,
    total: sum(line.vals),
    kind,
    blankZero: true,
    tone,
    editable: line.bucket ? { bucket: line.bucket, id: line.id } : undefined,
  });

  const sections: Array<{ label: string; rows: GridRow[] }> = [
    {
      label: "",
      rows: [
        {
          key: "opening",
          name: "Opening cash",
          chip: openingChip,
          values: openings,
          total: null,
          kind: "balance",
          blankZero: false,
          tone: "plain",
        },
      ],
    },
    {
      label: "Receipts",
      rows: [
        ...visibleReceipts.map((line) => lineRow(line, "in", "plain")),
        {
          key: "total-receipts",
          name: "Total receipts",
          chip: flowChip,
          values: inflow,
          total: sum(inflow),
          kind: "in",
          blankZero: false,
          tone: "in",
          strong: true,
        },
      ],
    },
    {
      label: "Payments",
      rows: [
        ...visiblePayments.map((line) => lineRow(line, "out", "plain")),
        {
          key: "total-payments",
          name: "Total payments",
          chip: flowChip,
          values: outflow,
          total: sum(outflow),
          kind: "out",
          blankZero: false,
          tone: "out",
          strong: true,
        },
      ],
    },
    {
      label: "",
      rows: [
        {
          key: "net",
          name: "Net cash flow",
          chip: flowChip,
          values: net,
          total: sum(net),
          kind: "signed",
          blankZero: false,
          tone: "net",
          strong: true,
        },
        {
          key: "closing",
          name: "Closing cash",
          chip: openingChip,
          values: closing,
          total: closing[WEEKS - 1] ?? null,
          kind: "signed",
          blankZero: false,
          tone: "close",
          strong: true,
        },
        {
          key: "floor",
          name: "Runway floor",
          chip: "assumption",
          values: Array.from({ length: WEEKS }, () => floor),
          total: floor,
          kind: "balance",
          blankZero: false,
          tone: "floor",
        },
      ],
    },
  ];

  const money = (value: number, row: GridRow) => showMoney(value, format, row.kind, row.blankZero);

  return (
    <div>
      <p className="mb-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        Week commencing. Opening plus receipts minus payments equals closing.
        {floorNote ? ` Floor ${floorNote}.` : ""}
      </p>
      <div
        className="cash-13w-scroll max-h-[min(70vh,680px)] overflow-auto overscroll-x-contain rounded-lg border border-amber-900/10 dark:border-slate-800"
        tabIndex={0}
        aria-label="13-week cash model"
      >
        <table className="w-full min-w-[1280px] border-separate border-spacing-0 text-xs tabular-nums">
          <caption className="sr-only">
            Thirteen week cash forecast with a total column. Weeks that close below the runway floor
            are marked.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className={cn(
                  "sticky left-0 top-0 z-40 min-w-[148px] border-b border-amber-900/15 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 shadow-[4px_0_8px_-6px_rgba(0,0,0,0.35)] dark:border-slate-700 dark:text-slate-400",
                  HEAD_BG,
                )}
              >
                Line
              </th>
              {weeks.map((label, index) => {
                const flag = tight[index];
                return (
                  <th
                    key={label + index}
                    scope="col"
                    data-cash-tight={flag ?? undefined}
                    aria-label={
                      flag === "negative"
                        ? `${label}, week ${index + 1}, negative closing cash`
                        : flag
                          ? `${label}, week ${index + 1}, under the runway floor`
                          : `${label}, week ${index + 1}`
                    }
                    className={cn(
                      "sticky top-0 z-20 min-w-[92px] whitespace-nowrap border-b border-amber-900/15 px-2 py-2 text-right dark:border-slate-700",
                      flag ? HEAD_TIGHT : HEAD_BG,
                    )}
                  >
                    <span
                      className={cn(
                        "block text-[11px] font-semibold tabular-nums",
                        flag ? "text-[#9b2c2c] dark:text-[#ffb4b4]" : "text-slate-800 dark:text-slate-100",
                      )}
                    >
                      {label}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 block text-[9px] font-medium uppercase tracking-wider",
                        flag ? "text-[#c0392b] dark:text-[#ef6b6b]" : "text-slate-400 dark:text-slate-500",
                      )}
                    >
                      W{index + 1}
                    </span>
                  </th>
                );
              })}
              <th
                scope="col"
                className={cn(
                  "sticky top-0 z-20 min-w-[108px] border-b border-l border-amber-900/20 px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:border-slate-700 dark:text-slate-400",
                  HEAD_BG,
                )}
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <SectionRows
                key={section.label || section.rows[0]?.key}
                label={section.label}
                rows={section.rows}
                tight={tight}
                symbol={symbol}
                money={money}
                onCommit={onCommit}
                floorNote={section.rows.some((row) => row.key === "floor") ? floorNote : null}
              />
            ))}
          </tbody>
        </table>
      </div>
      {visibleReceipts.length + visiblePayments.length === 0 ? (
        <p className="mt-3 text-center text-sm text-slate-500 dark:text-slate-400">
          The weekly model fills in once a forecast line is entered.
        </p>
      ) : null}
    </div>
  );
}

function SectionRows({
  label,
  rows,
  tight,
  symbol,
  money,
  onCommit,
  floorNote,
}: {
  label: string;
  rows: GridRow[];
  tight: Array<"negative" | "floor" | null>;
  symbol: string;
  money: (value: number, row: GridRow) => string;
  onCommit: CashThirteenWeekGridProps["onCommit"];
  floorNote?: string | null;
}) {
  return (
    <>
      {label ? (
        <tr>
          <th
            scope="colgroup"
            className="sticky left-0 z-30 bg-[#fbf8f1] px-3 pb-1 pt-3 text-left text-[10px] font-bold uppercase tracking-[0.18em] text-[#b8860b] shadow-[4px_0_8px_-6px_rgba(0,0,0,0.35)] dark:bg-[#10161f]"
          >
            {label}
          </th>
          {tight.map((flag, index) => (
            <td
              key={index}
              className={flag ? TIGHT_BG : "bg-[#fbf8f1] dark:bg-[#10161f]"}
            />
          ))}
          <td className="border-l border-amber-900/10 bg-[#fbf8f1] dark:border-slate-800 dark:bg-[#10161f]" />
        </tr>
      ) : null}
      {rows.map((row) => (
        <tr key={row.key}>
          <th
            scope="row"
            className={cn(
              "sticky left-0 z-30 min-w-[148px] border-b border-amber-900/10 px-3 py-1.5 text-left align-top shadow-[4px_0_8px_-6px_rgba(0,0,0,0.35)] dark:border-slate-800",
              TONE_BG[row.tone],
              row.strong && "font-bold",
            )}
          >
            <span className="flex max-w-[11.5rem] flex-col items-start gap-1 py-0.5">
              <span
                className={cn(
                  "whitespace-normal text-left text-[12px] leading-snug text-slate-800 dark:text-slate-100",
                  row.strong && "font-bold",
                  row.tone === "floor" && "font-medium text-slate-600 dark:text-slate-300",
                )}
              >
                {row.name}
              </span>
              {row.key === "floor" && floorNote ? (
                <span className="text-[10px] font-normal normal-case tracking-normal text-slate-500 dark:text-slate-400">
                  {floorNote}
                </span>
              ) : null}
              <SourceChip source={row.chip} />
            </span>
          </th>
          {row.values.map((value, index) => {
            const flag = tight[index];
            const display = money(value, row);
            const flaggedClose = row.key === "closing" && flag;
            return (
              <td
                key={index}
                data-cash-tight={flag ?? undefined}
                title={
                  flag === "negative"
                    ? "Closing cash is negative"
                    : flag === "floor"
                      ? "Closing cash is under the runway floor"
                      : undefined
                }
                className={cn(
                  "border-b border-amber-900/10 px-2 py-1.5 text-right align-middle tabular-nums text-slate-800 dark:border-slate-800 dark:text-slate-100",
                  flag ? TIGHT_BG : TONE_BG[row.tone],
                  row.strong && "font-bold",
                  flaggedClose && "font-bold text-[#9b2c2c] dark:text-[#ffb4b4]",
                  row.tone === "floor" && "text-slate-500 dark:text-slate-400",
                  row.key === "net" &&
                    value < 0 &&
                    "text-[#9b2c2c] dark:text-[#ffb4b4]",
                  row.key === "net" && value > 0 && "text-[#1f7a4d] dark:text-[#7dcca7]",
                )}
              >
                {row.editable ? (
                  <ForecastAmountCell
                    symbol={symbol}
                    value={value}
                    display={display}
                    onCommit={(next) =>
                      onCommit(row.editable!.bucket, row.editable!.id, index, next)
                    }
                  />
                ) : (
                  display
                )}
              </td>
            );
          })}
          <td
            className={cn(
              "border-b border-l border-amber-900/15 px-2 py-1.5 text-right align-middle font-semibold tabular-nums text-slate-900 dark:border-slate-700 dark:text-slate-50",
              TONE_BG[row.tone],
              row.strong && "font-bold",
              row.key === "closing" &&
                (closingIsTight(row, tight)
                  ? "text-[#9b2c2c] dark:text-[#ffb4b4]"
                  : ""),
            )}
          >
            {row.total == null ? "—" : money(row.total, row)}
          </td>
        </tr>
      ))}
    </>
  );
}

function closingIsTight(row: GridRow, tight: Array<"negative" | "floor" | null>): boolean {
  if (row.key !== "closing") return false;
  const last = tight[tight.length - 1];
  return last != null;
}

type CashThirteenWeekGridProps = {
  onCommit: (
    bucket: "revenue" | "expenses" | "other",
    id: string,
    weekIndex: number,
    value: number | null,
  ) => void;
};
