/**
 * Persist a Sage Accounting (SA) sync into clients.financials and a snapshot.
 * Reads sage_connections. Does not connect, validate, or disconnect.
 * Deliverable auto-populate stays on the owner board and the accountant studio,
 * and only after this write says the figures are real.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { agedArProofLine } from "@/lib/collections";
import { applyLedgerSyncFinancials } from "@/lib/ledger-sync-financials";
import { agedApProofLine } from "@/lib/payables";
import { computeRatios, type RatioInputs } from "@/lib/ratios";
import { sageCompanyIdIsValid, sageSyncWriteDecision } from "@/lib/sage";
import { decryptSagePassword } from "@/lib/sage-password";
import {
  fetchSageLedgerStatement,
  mapSageToFinancialInputs,
  sageCredentialsConfigured,
  type SageLedgerStatement,
} from "@/lib/sage-sync";
import { calendarMonthStamp, STATEMENT_YTD_FIELD_KEYS } from "@/lib/statement-period";

export type SageSyncResult = {
  populated: boolean;
  fields: Record<string, string>;
  message: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  summary: {
    revenue: number;
    netIncome: number;
    totalAssets: number;
    equity: number;
    cash: number;
    periodLabel: string;
    periodStart: string;
    periodEnd: string;
    ytdRevenue: number | null;
    ytdNetIncome: number | null;
    ytdPeriodLabel: string | null;
    ytdBasis: "financial" | "calendar" | null;
    agedArLine: string;
    agedApLine: string;
    bankAccountCount: number;
  };
};

type ClientRow = {
  financials?: unknown;
  financial_year_start_month?: number | null;
};

function fyStartMonth(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

async function markSync(
  clientId: string,
  patch: {
    sync_status: "idle" | "syncing" | "error";
    sync_error: string | null;
    last_synced_at?: string;
  },
) {
  const { error } = await supabaseAdmin
    .from("sage_connections")
    .update(patch)
    .eq("client_id", clientId);
  if (error) console.error("[sage sync] status update failed", error.code);
}

async function readClient(clientId: string): Promise<ClientRow> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("financials, financial_year_start_month")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? {}) as ClientRow;
}

async function findSnapshotId(
  clientId: string,
  column: "period_date" | "period_label",
  value: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("client_financial_snapshots")
    .select("id")
    .eq("client_id", clientId)
    .eq(column, value)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as { id?: string } | undefined;
  return row?.id ?? null;
}

async function upsertSageSnapshot(
  clientId: string,
  financials: Record<string, unknown>,
  userId: string | null,
  periodDate: string,
  periodLabel: string,
) {
  const ratios = computeRatios(financials as unknown as RatioInputs);
  let id = await findSnapshotId(clientId, "period_date", periodDate);
  if (!id) id = await findSnapshotId(clientId, "period_label", periodLabel);
  if (!id) {
    const monthStamp = calendarMonthStamp(periodDate);
    if (monthStamp) {
      const { data } = await supabaseAdmin
        .from("client_financial_snapshots")
        .select("id")
        .eq("client_id", clientId)
        .eq("source", "sage")
        .eq("period_label", monthStamp)
        .order("created_at", { ascending: false })
        .limit(1);
      id = ((data ?? [])[0] as { id?: string } | undefined)?.id ?? null;
    }
  }

  if (id) {
    const { error } = await supabaseAdmin
      .from("client_financial_snapshots")
      .update({
        financials: financials as never,
        ratios: ratios as never,
        period_label: periodLabel,
        period_date: periodDate,
        source: "sage",
      })
      .eq("id", id);
    if (error) throw new Error(`Could not save the Sage snapshot (${error.code ?? "update"})`);
    return;
  }

  const { error } = await supabaseAdmin.from("client_financial_snapshots").insert({
    client_id: clientId,
    period_label: periodLabel,
    period_date: periodDate,
    financials: financials as never,
    ratios: ratios as never,
    source: "sage",
    created_by: userId,
  });
  if (error) throw new Error(`Could not save the Sage snapshot (${error.code ?? "insert"})`);
}

function fieldsFrom(ledger: SageLedgerStatement): Record<string, string> {
  const mapped = mapSageToFinancialInputs(
    ledger.pnl,
    ledger.bs,
    { from: ledger.from, to: ledger.to, label: ledger.periodLabel },
    ledger.year,
    ledger.cash,
  );
  const fields: Record<string, string> = Object.fromEntries(
    Object.entries(mapped).map(([key, value]) => [key, String(value)]),
  );
  if (!ledger.year) {
    for (const key of STATEMENT_YTD_FIELD_KEYS) fields[key] = "";
  }
  return fields;
}

export async function executeSageSync(input: {
  clientId: string;
  userId: string | null;
}): Promise<SageSyncResult> {
  const { data: connRaw, error: connError } = await supabaseAdmin
    .from("sage_connections")
    .select("username, password_enc, company_id")
    .eq("client_id", input.clientId)
    .maybeSingle();
  if (connError) throw new Error(connError.message);
  if (!connRaw) throw new Error("Sage is not connected for this client");
  const conn = connRaw as {
    username?: string | null;
    password_enc?: string | null;
    company_id?: string | number | null;
  };

  await markSync(input.clientId, { sync_status: "syncing", sync_error: null });

  try {
    if (!sageCredentialsConfigured()) {
      throw new Error("SAGE_SA_API_KEY is not set. Overview figures were left unchanged.");
    }
    const username = String(conn.username ?? "").trim();
    const companyId = String(conn.company_id ?? "").trim();
    if (!username) throw new Error("Sage username is missing on the connection");
    if (!sageCompanyIdIsValid(companyId))
      throw new Error("Sage company id is missing on the connection");

    const row = await readClient(input.clientId);
    const password = decryptSagePassword(String(conn.password_enc ?? ""));
    const apiKey = process.env.SAGE_SA_API_KEY?.trim() ?? "";
    const ledger = await fetchSageLedgerStatement(
      { username, password, apiKey, companyId },
      new Date(),
      fyStartMonth(row.financial_year_start_month),
    );
    const fields = fieldsFrom(ledger);
    const prev =
      row.financials && typeof row.financials === "object" && !Array.isArray(row.financials)
        ? (row.financials as Record<string, unknown>)
        : {};
    const decision = sageSyncWriteDecision(fields, prev);
    if (!decision.write) {
      await markSync(input.clientId, {
        sync_status: "error",
        sync_error: decision.error.slice(0, 500),
      });
      return {
        populated: false,
        fields,
        message: decision.error,
        periodLabel: ledger.periodLabel,
        periodStart: ledger.from,
        periodEnd: ledger.to,
        summary: {
          revenue: ledger.pnl.revenue,
          netIncome: ledger.pnl.netIncome,
          totalAssets: ledger.bs.totalAssets,
          equity: ledger.bs.equity,
          cash: ledger.cash,
          periodLabel: ledger.periodLabel,
          periodStart: ledger.from,
          periodEnd: ledger.to,
          ytdRevenue: ledger.year?.pnl.revenue ?? null,
          ytdNetIncome: ledger.year?.pnl.netIncome ?? null,
          ytdPeriodLabel: ledger.year?.label ?? null,
          ytdBasis: ledger.year?.basis ?? null,
          agedArLine: agedArProofLine(ledger.agedAr),
          agedApLine: agedApProofLine(ledger.agedAp),
          bankAccountCount: ledger.bankAccounts.length,
        },
      };
    }

    const merged = applyLedgerSyncFinancials(prev, fields, "sage");
    if (Number.isFinite(ledger.cash)) merged.cash = ledger.cash;
    const nowIso = new Date().toISOString();
    const { error: saveError } = await supabaseAdmin
      .from("clients")
      .update({
        financials: merged as never,
        financials_updated_at: nowIso,
      })
      .eq("id", input.clientId);
    if (saveError) throw new Error(`Could not save Sage figures (${saveError.code ?? "update"})`);

    await upsertSageSnapshot(input.clientId, merged, input.userId, ledger.to, ledger.periodLabel);

    const cacheRows = [
      {
        client_id: input.clientId,
        data_type: "pl",
        raw_data: {
          ...ledger.pnl,
          from: ledger.from,
          to: ledger.to,
          periodLabel: ledger.periodLabel,
          year: ledger.year,
        },
        synced_at: nowIso,
      },
      { client_id: input.clientId, data_type: "bs", raw_data: ledger.bs, synced_at: nowIso },
      {
        client_id: input.clientId,
        data_type: "bank",
        raw_data: {
          source: ledger.cashSource,
          accountCount: ledger.bankAccounts.length,
          totalClosing: ledger.cash,
          accounts: ledger.bankAccounts,
        },
        synced_at: nowIso,
      },
      {
        client_id: input.clientId,
        data_type: "aged_ar",
        raw_data: ledger.agedAr,
        synced_at: nowIso,
      },
      {
        client_id: input.clientId,
        data_type: "aged_ap",
        raw_data: ledger.agedAp,
        synced_at: nowIso,
      },
    ];
    const { error: cacheError } = await supabaseAdmin
      .from("sage_sync_data")
      .upsert(cacheRows as never, { onConflict: "client_id,data_type" });
    if (cacheError) console.error("[sage sync] cache skipped", cacheError.code);

    await markSync(input.clientId, {
      sync_status: "idle",
      sync_error: null,
      last_synced_at: nowIso,
    });

    return {
      populated: true,
      fields,
      message: "",
      periodLabel: ledger.periodLabel,
      periodStart: ledger.from,
      periodEnd: ledger.to,
      summary: {
        revenue: ledger.pnl.revenue,
        netIncome: ledger.pnl.netIncome,
        totalAssets: ledger.bs.totalAssets,
        equity: ledger.bs.equity,
        cash: ledger.cash,
        periodLabel: ledger.periodLabel,
        periodStart: ledger.from,
        periodEnd: ledger.to,
        ytdRevenue: ledger.year?.pnl.revenue ?? null,
        ytdNetIncome: ledger.year?.pnl.netIncome ?? null,
        ytdPeriodLabel: ledger.year?.label ?? null,
        ytdBasis: ledger.year?.basis ?? null,
        agedArLine: agedArProofLine(ledger.agedAr),
        agedApLine: agedApProofLine(ledger.agedAp),
        bankAccountCount: ledger.bankAccounts.length,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown sync error";
    await markSync(input.clientId, { sync_status: "error", sync_error: msg.slice(0, 500) });
    throw new Error(`Sync failed: ${msg}`);
  }
}
