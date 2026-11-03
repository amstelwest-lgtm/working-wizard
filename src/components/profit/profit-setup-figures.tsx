/**
 * Typed entry for the same P&L lines Confirm/Reject writes from the waterfall or live sheet.
 */
import { useEffect, useMemo, useState } from "react";
import { FigureEditConfirm, useManualFigureEdit } from "@/components/figure-amount-edit";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMarketFormat } from "@/contexts/market";
import { parseEditableAmount } from "@/lib/cash-week-overrides";
import { buildPnlFigureEditDraft, pnlRowIsFigureEditable } from "@/lib/figure-edit";
import { formatMoney } from "@/lib/market/format";
import { ownerMinus } from "@/lib/owner-money";
import { buildProfitPnl } from "@/lib/profit-statement";

export function ProfitSetupFigures({
  financials,
  clientId,
  signed = false,
  onFiguresApplied,
}: {
  financials: Record<string, unknown> | null | undefined;
  clientId?: string;
  signed?: boolean;
  onFiguresApplied?: (financials: Record<string, unknown>) => void;
}) {
  const { market } = useMarketFormat();
  const [local, setLocal] = useState<Record<string, unknown> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setLocal(null);
    setDrafts({});
  }, [financials]);

  const currentFin = local ?? financials;
  const edit = useManualFigureEdit({
    clientId,
    onApplied: (next) => {
      setLocal(next);
      onFiguresApplied?.(next);
    },
  });

  const rows = useMemo(() => {
    const built = buildProfitPnl({ current: currentFin, prior: null, quoted: null });
    return built.rows.filter((row) => row.current != null && pnlRowIsFigureEditable(row.id));
  }, [currentFin]);

  const displayAmount = (amount: number) => {
    const text = formatMoney(amount, market);
    return signed ? ownerMinus(text) : text;
  };

  const commitRow = (rowId: string, label: string, rowAmount: number) => {
    const raw = drafts[rowId];
    if (raw == null) return;
    const next = parseEditableAmount(raw);
    if (next == null) {
      setDrafts((prev) => {
        const copy = { ...prev };
        delete copy[rowId];
        return copy;
      });
      return;
    }
    const mapped = buildPnlFigureEditDraft({
      rowId,
      label,
      rowAmount,
      nextAmount: next,
      financials: currentFin,
    });
    if (mapped) edit.propose(mapped);
    setDrafts((prev) => {
      const copy = { ...prev };
      delete copy[rowId];
      return copy;
    });
  };

  if (!rows.length) {
    return (
      <p
        className="rounded-xl border border-[#DBEAFE] bg-white px-4 py-4 text-sm text-[#486581] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        data-profit-setup-figures="empty"
      >
        Add a profit and loss on file, then you can type Sales and expense lines here.
      </p>
    );
  }

  return (
    <section
      className="mb-5 rounded-xl border border-[#DBEAFE] bg-white p-4 text-[#102A43] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      data-profit-setup-figures=""
      aria-labelledby="profit-setup-figures-heading"
    >
      <h3
        id="profit-setup-figures-heading"
        className="text-xs font-bold uppercase tracking-[0.16em] text-[#486581] dark:text-slate-400"
      >
        Period figures
      </h3>
      <p className="mt-2 text-sm text-[#486581] dark:text-slate-400">
        Type a figure, then confirm. This uses the same save path as double-click on the waterfall or
        P&amp;L.
      </p>
      <FigureEditConfirm
        pending={edit.pending}
        busy={edit.busy}
        onConfirm={() => void edit.confirm()}
        onReject={edit.reject}
      />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {rows.map((row) => {
          const amount = row.current!;
          const draft = drafts[row.id] ?? String(Math.round(amount * 100) / 100);
          return (
            <div key={row.id} className="flex min-w-0 flex-col gap-1.5" data-profit-setup-row={row.id}>
              <Label htmlFor={`profit-setup-${row.id}`} className="text-xs font-medium">
                {row.label}
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`profit-setup-${row.id}`}
                  inputMode="decimal"
                  className="h-9 tabular-nums"
                  value={draft}
                  onChange={(event) =>
                    setDrafts((prev) => ({ ...prev, [row.id]: event.target.value }))
                  }
                  onBlur={() => commitRow(row.id, row.label, amount)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitRow(row.id, row.label, amount);
                    }
                  }}
                />
                <span className="shrink-0 text-xs tabular-nums text-[#829AB1] dark:text-slate-500">
                  was {displayAmount(amount)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
