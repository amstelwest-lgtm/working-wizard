/**
 * Audit inputs for Profit. Approvals live on clients.deliverable_inputs.profitAudit
 * so a statement sync cannot wipe them. Same hash and status rules as cash.
 */
import {
  approveCashInputs,
  cashAuditPendingCount,
  parseCashInputAudit,
  type CashAuditRow,
  type CashInputAudit,
} from "./cash-input-audit.ts";
import { buildProfitPnl } from "./profit-statement.ts";
import {
  loadServerDeliverableInputs,
  saveServerDeliverableInputs,
} from "./deliverable-input-config.remote.ts";
import {
  readStoredDeliverableInputs,
  writeStoredDeliverableInputs,
} from "./deliverable-input-config.store.ts";

export function profitAuditRows(input: {
  financials: Record<string, unknown> | null | undefined;
  periodLabel: string | null;
  sourceLabel: string | null;
  format: (n: number) => string;
  fyStartMonth?: number | null;
}): CashAuditRow[] {
  const rows: CashAuditRow[] = [];
  const fin = input.financials ?? null;
  const start = typeof fin?.periodStart === "string" ? fin.periodStart.slice(0, 10) : "";
  const end = typeof fin?.periodEnd === "string" ? fin.periodEnd.slice(0, 10) : "";
  rows.push({
    key: "period",
    group: "setup",
    label: "Statement period",
    value: input.periodLabel?.trim() || "Not on file",
    source: input.sourceLabel,
    hashOf: { start, end, label: input.periodLabel ?? "" },
  });
  if (input.sourceLabel) {
    rows.push({
      key: "source",
      group: "source",
      label: "Statement source",
      value: input.sourceLabel,
      source: input.sourceLabel,
      hashOf: input.sourceLabel,
    });
  }
  const built = buildProfitPnl({ current: fin, fyStartMonth: input.fyStartMonth });
  for (const line of built.rows) {
    if (line.kind === "total" || line.current == null) continue;
    rows.push({
      key: `line:${line.id}`,
      group: "line",
      label: line.label,
      value: input.format(line.current),
      source: input.sourceLabel,
      hashOf: Math.round(line.current * 100) / 100,
    });
  }
  return rows;
}

export function readProfitInputAudit(raw: unknown): CashInputAudit {
  if (!raw || typeof raw !== "object") return {};
  return parseCashInputAudit((raw as { profitAudit?: unknown }).profitAudit);
}

export async function loadProfitInputAudit(clientId: string): Promise<CashInputAudit> {
  const server = await loadServerDeliverableInputs(clientId);
  if (server?.profitAudit) return server.profitAudit;
  return readStoredDeliverableInputs(clientId).profitAudit ?? {};
}

export async function saveProfitInputAudit(
  clientId: string,
  audit: CashInputAudit,
): Promise<boolean> {
  const local = readStoredDeliverableInputs(clientId);
  writeStoredDeliverableInputs(clientId, { ...local, profitAudit: audit });
  return saveServerDeliverableInputs(clientId, { profitAudit: audit });
}

export { approveCashInputs, cashAuditPendingCount };
