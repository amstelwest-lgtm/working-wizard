import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ProfitChart } from "@/components/profit/profit-chart";
import { ProfitPagedMenu } from "@/components/profit/profit-paged-menu";
import { ProfitPnlTable } from "@/components/profit/profit-pnl-table";
import { CashInputAuditTable } from "@/components/cash/cash-input-audit";
import { useMarket } from "@/contexts/market";
import { useAuth } from "@/hooks/use-auth";
import type { FiscalStatementSlice } from "@/lib/budget-period-types";
import {
  approveCashInputs,
  cashAuditInitials,
  cashAuditPendingCount,
  unapproveCashInputs,
  type CashInputAudit,
} from "@/lib/cash-input-audit";
import { figureSourceChipLabel } from "@/lib/ledger-link-copy";
import { formatMoney } from "@/lib/market/format";
import { ownerSignoffDate } from "@/components/owner-signoff-mark";
import { ownerMinus } from "@/lib/owner-money";
import {
  loadProfitInputAudit,
  profitAuditRows,
  saveProfitInputAudit,
} from "@/lib/profit-input-audit";
import { profitPagedSentence, type ProfitPagedView } from "@/lib/profit-paged-view";
import type { ProfitSnapshot } from "@/lib/profit-statement";
import { readStatementMeta } from "@/lib/statement-period";
import "@/components/cash/cash-paged.css";

export function ProfitWorkspace({
  financials,
  snapshots,
  prior = null,
  priorLabel = null,
  quoted = null,
  periodLabel = null,
  fyStartMonth = null,
  clientId,
  signed = false,
  canApprove = false,
  includeLines = true,
  view,
  onViewChange,
  waterfall = null,
  lines = null,
  setup = null,
}: {
  financials: Record<string, unknown> | null | undefined;
  snapshots?: readonly ProfitSnapshot[] | null;
  prior?: Record<string, unknown> | null;
  priorLabel?: string | null;
  quoted?: FiscalStatementSlice | null;
  periodLabel?: string | null;
  fyStartMonth?: number | null;
  clientId?: string;
  signed?: boolean;
  canApprove?: boolean;
  includeLines?: boolean;
  view?: ProfitPagedView;
  onViewChange?: (view: ProfitPagedView) => void;
  waterfall?: ReactNode;
  lines?: ReactNode;
  setup?: ReactNode;
}) {
  const { market } = useMarket();
  const { user } = useAuth();
  const [localView, setLocalView] = useState<ProfitPagedView>("chart");
  const active = view ?? localView;
  const select = onViewChange ?? setLocalView;
  const [audit, setAudit] = useState<CashInputAudit>({});
  const [saving, setSaving] = useState(false);
  const meta = readStatementMeta(financials, market);
  const currentLabel = periodLabel?.trim() || meta.periodLabel || "This period";
  const priorText = priorLabel?.trim() || "Prior period";
  const sourceLabel = figureSourceChipLabel(meta.statementSource);
  const money = (amount: number) => {
    const text = formatMoney(amount, market);
    return signed ? ownerMinus(text) : text;
  };
  const rows = useMemo(
    () =>
      profitAuditRows({
        financials,
        periodLabel: currentLabel,
        sourceLabel,
        format: money,
        fyStartMonth,
      }),
    // money is derived from market and signed, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [financials, currentLabel, sourceLabel, fyStartMonth, market, signed],
  );
  const pending = cashAuditPendingCount(rows, audit);
  const initials = cashAuditInitials(
    (user?.user_metadata as { full_name?: string; name?: string } | null)?.full_name ??
      (user?.user_metadata as { name?: string } | null)?.name,
    user?.email,
  );

  useEffect(() => {
    if (!clientId) {
      setAudit({});
      return;
    }
    let cancelled = false;
    loadProfitInputAudit(clientId)
      .then((next) => {
        if (!cancelled) setAudit(next);
      })
      .catch(() => {
        if (!cancelled) setAudit({});
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const persist = async (next: CashInputAudit) => {
    if (!clientId) return;
    const previous = audit;
    setAudit(next);
    setSaving(true);
    const ok = await saveProfitInputAudit(clientId, next);
    setSaving(false);
    if (!ok) {
      setAudit(previous);
      toast.error("Could not save the approval.");
    }
  };

  return (
    <div className="cash-paged" data-profit-layout="paged">
      <ProfitPagedMenu
        value={active}
        onChange={select}
        includeLines={includeLines && lines != null}
        auditCount={pending}
      />
      <p className="cash-paged__sentence" data-profit-pane-sentence="">
        {profitPagedSentence(active)}
      </p>
      <div id="profit-pane-chart" role="tabpanel" hidden={active !== "chart"}>
        {active === "chart" ? (
          <ProfitChart
            financials={financials}
            snapshots={snapshots}
            currentPeriodEnd={meta.periodEnd}
            currentLabel={currentLabel}
            signed={signed}
          />
        ) : null}
      </div>
      <div id="profit-pane-pnl" role="tabpanel" hidden={active !== "pnl"}>
        {active === "pnl" ? (
          <ProfitPnlTable
            financials={financials}
            prior={prior}
            quoted={quoted}
            currentLabel={currentLabel}
            priorLabel={priorText}
            fyStartMonth={fyStartMonth}
            signed={signed}
          />
        ) : null}
      </div>
      <div id="profit-pane-waterfall" role="tabpanel" hidden={active !== "waterfall"}>
        {active === "waterfall" ? waterfall : null}
      </div>
      <div id="profit-pane-lines" role="tabpanel" hidden={active !== "lines"}>
        {active === "lines" ? lines : null}
      </div>
      <div id="profit-pane-setup" role="tabpanel" hidden={active !== "setup"}>
        {active === "setup" ? setup : null}
      </div>
      <div id="profit-pane-audit" role="tabpanel" hidden={active !== "audit"}>
        {active === "audit" ? (
          <CashInputAuditTable
            rows={rows}
            audit={audit}
            canApprove={canApprove && Boolean(clientId)}
            saving={saving}
            approvedOn={(iso) => ownerSignoffDate(iso, market.timezone, market)}
            viewerId={user?.id ?? null}
            viewerInitials={initials}
            onApprove={(key) =>
              void persist(
                approveCashInputs(audit, rows, {
                  by: user?.id ?? null,
                  at: new Date().toISOString(),
                  initials: initials || null,
                  keys: [key],
                }),
              )
            }
            onApproveAll={() =>
              void persist(
                approveCashInputs(audit, rows, {
                  by: user?.id ?? null,
                  at: new Date().toISOString(),
                  initials: initials || null,
                }),
              )
            }
            onUnapprove={(key) => void persist(unapproveCashInputs(audit, [key]))}
            onEdit={() => select("setup")}
          />
        ) : null}
      </div>
    </div>
  );
}
