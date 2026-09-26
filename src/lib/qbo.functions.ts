import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertClientScope } from "@/lib/assert-client-scope";
import { getSupabaseAdminOrNull, supabaseAdmin } from "@/integrations/supabase/client.server";
import { agedArProofLine, readCollectionsSnapshot } from "@/lib/collections";
import { agedApProofLine, readPayablesSnapshot, skippedPayables } from "@/lib/payables";
import { computeRatios, type RatioInputs } from "@/lib/ratios";
import { sanitizeQboReturnPath } from "@/lib/qbo-state";
import {
  calendarMonthStamp,
  readStatementMeta,
  STATEMENT_YTD_FIELD_KEYS,
} from "@/lib/statement-period";
import {
  buildQboAuthUrl,
  exchangeCodeForTokens,
  fetchChartOfAccounts,
  fetchQboAgedPayables,
  fetchQboAgedReceivables,
  fetchQboLedgerStatement,
  fetchRecentTransactions,
  mapQboToFinancialInputs,
  intuitTidFromError,
  qboCredentialsConfigured,
  refreshQboToken,
  revokeQboToken,
  type QboBalanceSheet,
  type QboPnL,
} from "@/lib/qbo";

// ─── Check whether QBO credentials are configured ────────────────────────────

export const getQboConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    return { configured: qboCredentialsConfigured() };
  });

// ─── Generate OAuth URL (creates state for CSRF protection) ──────────────────

export const getQboAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        returnPath: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    assertClientScope(context.actingAsClientId, data.clientId);

    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    const state = crypto.randomUUID();
    const returnPath = sanitizeQboReturnPath(data.returnPath, data.clientId);
    await supabaseAdmin.from("qbo_oauth_states").insert({
      state,
      client_id: data.clientId,
      return_path: returnPath,
    });

    return { authUrl: buildQboAuthUrl(state) };
  });

// ─── Get connection status for one client ────────────────────────────────────

export type QboStatus = {
  realmId: string;
  companyName: string | null;
  connectedAt: string;
  lastSyncedAt: string | null;
  syncStatus: string;
  syncError: string | null;
  /** Set only after a sync that stored statementSource=qbo with explicit dates. */
  periodLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  revenue: number | null;
  netIncome: number | null;
  cash: number | null;
  totalAssets: number | null;
  equity: number | null;
  ytdRevenue: number | null;
  ytdNetIncome: number | null;
  ytdPeriodLabel: string | null;
  ytdBasis: "financial" | "calendar" | null;
  agedArLine: string;
  agedApLine: string;
} | null;

function numField(fields: Record<string, unknown>, key: string): number | null {
  const raw = fields[key];
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  return Number.isFinite(n) ? n : null;
}

function qboFigureProof(financials: unknown): {
  periodLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  revenue: number | null;
  netIncome: number | null;
  cash: number | null;
  totalAssets: number | null;
  equity: number | null;
  ytdRevenue: number | null;
  ytdNetIncome: number | null;
  ytdPeriodLabel: string | null;
  ytdBasis: "financial" | "calendar" | null;
  agedArLine: string;
  agedApLine: string;
} {
  const empty = {
    periodLabel: null,
    periodStart: null,
    periodEnd: null,
    revenue: null,
    netIncome: null,
    cash: null,
    totalAssets: null,
    equity: null,
    ytdRevenue: null,
    ytdNetIncome: null,
    ytdPeriodLabel: null,
    ytdBasis: null as "financial" | "calendar" | null,
    agedArLine: "Aged receivables appear after the next Sync",
    agedApLine: "Aged payables appear after the next Sync",
  };
  if (!financials || typeof financials !== "object" || Array.isArray(financials)) return empty;
  const meta = readStatementMeta(financials);
  if (meta.statementSource !== "qbo") return empty;
  const f = financials as Record<string, unknown>;
  return {
    periodLabel: meta.periodLabel,
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    revenue: numField(f, "revenue"),
    netIncome: numField(f, "netIncome"),
    cash: numField(f, "cash"),
    totalAssets: numField(f, "totalAssets"),
    equity: numField(f, "equity"),
    ytdRevenue: meta.ytdRevenue,
    ytdNetIncome: meta.ytdNetIncome,
    ytdPeriodLabel: meta.ytdPeriodLabel,
    ytdBasis: meta.ytdBasis,
    agedArLine: "Aged receivables appear after the next Sync",
    agedApLine: "Aged payables appear after the next Sync",
  };
}

export const getQboStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<QboStatus> => {
    assertClientScope(context.actingAsClientId, data.clientId);

    const { data: client } = await context.supabase
      .from("clients")
      .select("id, financials")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    const admin = getSupabaseAdminOrNull();
    if (!admin) return null;

    const { data: conn } = await admin
      .from("qbo_connections")
      .select("realm_id, company_name, connected_at, last_synced_at, sync_status, sync_error")
      .eq("client_id", data.clientId)
      .maybeSingle();

    if (!conn) return null;
    const proof = qboFigureProof((client as { financials?: unknown }).financials);
    const { data: agedRows } = await admin
      .from("qbo_sync_data")
      .select("data_type, raw_data")
      .eq("client_id", data.clientId)
      .in("data_type", ["aged_ar", "aged_ap"]);
    const aged = readCollectionsSnapshot(
      (agedRows ?? []).find((row) => row.data_type === "aged_ar")?.raw_data,
    );
    const agedAp = readPayablesSnapshot(
      (agedRows ?? []).find((row) => row.data_type === "aged_ap")?.raw_data,
    );
    return {
      realmId: conn.realm_id ?? "",
      companyName: conn.company_name ?? null,
      connectedAt: conn.connected_at ?? "",
      lastSyncedAt: conn.last_synced_at ?? null,
      syncStatus: conn.sync_status ?? "idle",
      syncError: conn.sync_error ?? null,
      ...proof,
      agedArLine: aged ? agedArProofLine(aged) : proof.agedArLine,
      agedApLine: agedAp ? agedApProofLine(agedAp) : proof.agedApLine,
    };
  });

// ─── Get connection statuses for multiple clients (accountant dashboard) ──────

export const getQboStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientIds: z.array(z.string().uuid()).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.clientIds.length === 0) return {};
    const admin = getSupabaseAdminOrNull();
    if (!admin) return {};

    const { data: visible } = await context.supabase
      .from("clients")
      .select("id")
      .in("id", data.clientIds);
    const allowed = new Set((visible ?? []).map((c) => c.id));
    const scoped = data.clientIds.filter((id) => allowed.has(id));
    if (scoped.length === 0) return {};

    const { data: rows } = await admin
      .from("qbo_connections")
      .select("client_id, company_name, last_synced_at, sync_status")
      .in("client_id", scoped);

    const out: Record<
      string,
      { companyName: string | null; lastSyncedAt: string | null; syncStatus: string }
    > = {};
    for (const r of rows ?? []) {
      out[r.client_id] = {
        companyName: r.company_name ?? null,
        lastSyncedAt: r.last_synced_at ?? null,
        syncStatus: r.sync_status ?? "idle",
      };
    }
    return out;
  });

// ─── Trigger full sync ────────────────────────────────────────────────────────

export type SyncResult = {
  mappedInputs: Record<string, number>;
  /** Every mapped field, including period label strings, ready for the financials blob. */
  fields: Record<string, string>;
  periodMonths: string | null;
  periodLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  summary: {
    revenue: number;
    netIncome: number;
    totalAssets: number;
    equity: number;
    cash: number;
    operatingCashflow: number | null;
    accountsCount: number;
    transactionsCount: number;
    periodLabel: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    ytdRevenue: number | null;
    ytdNetIncome: number | null;
    ytdPeriodLabel: string | null;
    ytdBasis: "financial" | "calendar" | null;
    agedArLine: string;
    agedApLine: string;
  };
};

function mappedNumbers(mapped: Record<string, number | string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(mapped)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
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

async function upsertQboSnapshot(
  clientId: string,
  financials: Record<string, unknown>,
  userId: string | null,
  periodDate: string,
  periodLabel: string,
) {
  const ratios = computeRatios(financials as unknown as RatioInputs);

  let id = await findSnapshotId(clientId, "period_date", periodDate);
  if (!id) id = await findSnapshotId(clientId, "period_label", periodLabel);
  // Earlier syncs could stamp a multi-month total as "Sep 2026". Replace that row.
  if (!id) {
    const monthStamp = calendarMonthStamp(periodDate);
    if (monthStamp) {
      const { data } = await supabaseAdmin
        .from("client_financial_snapshots")
        .select("id")
        .eq("client_id", clientId)
        .eq("source", "qbo")
        .eq("period_label", monthStamp)
        .order("created_at", { ascending: false })
        .limit(1);
      id = ((data ?? [])[0] as { id?: string } | undefined)?.id ?? null;
    }
  }

  if (id) {
    await supabaseAdmin
      .from("client_financial_snapshots")
      .update({
        financials: financials as never,
        ratios: ratios as never,
        period_label: periodLabel,
        period_date: periodDate,
        source: "qbo",
      })
      .eq("id", id);
    return;
  }

  await supabaseAdmin.from("client_financial_snapshots").insert({
    client_id: clientId,
    period_label: periodLabel,
    period_date: periodDate,
    financials: financials as never,
    ratios: ratios as never,
    source: "qbo",
    created_by: userId,
  });
}

export const triggerQboSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SyncResult> => {
    assertClientScope(context.actingAsClientId, data.clientId);

    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    const { data: connRaw } = await supabaseAdmin
      .from("qbo_connections")
      .select("*")
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (!connRaw) throw new Error("QuickBooks is not connected for this client");
    const conn = connRaw;

    await supabaseAdmin
      .from("qbo_connections")
      .update({ sync_status: "syncing", sync_error: null })
      .eq("client_id", data.clientId);

    let accessToken = conn.access_token as string;

    try {
      const expiry = new Date(conn.token_expiry as string).getTime();
      if (Date.now() + 60_000 > expiry) {
        const tokens = await refreshQboToken(conn.refresh_token as string);
        accessToken = tokens.access_token;
        await supabaseAdmin
          .from("qbo_connections")
          .update({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          })
          .eq("client_id", data.clientId);
      }

      const realmId = conn.realm_id as string;
      const ledger = await fetchQboLedgerStatement(realmId, accessToken);
      const { pnl, bs } = ledger;

      const [accounts, transactions, agedAr, agedAp] = await Promise.all([
        fetchChartOfAccounts(realmId, accessToken).catch(() => null),
        fetchRecentTransactions(realmId, accessToken).catch(() => null),
        fetchQboAgedReceivables(realmId, accessToken, ledger.to),
        fetchQboAgedPayables(realmId, accessToken, ledger.to).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : "Aged payables failed";
          return skippedPayables({
            source: "qbo",
            asOf: ledger.to,
            syncedAt: new Date().toISOString(),
            skipReason: `Aged payables were not applied. ${msg.replace(/\s+/g, " ").slice(0, 180)}`,
          });
        }),
      ]);

      const mapped = mapQboToFinancialInputs(
        pnl,
        bs,
        { from: ledger.from, to: ledger.to, label: ledger.periodLabel },
        ledger.year
          ? {
              pnl: ledger.year.pnl,
              from: ledger.year.from,
              to: ledger.year.to,
              label: ledger.year.periodLabel,
              basis: ledger.year.basis,
            }
          : null,
        ledger.operatingCashflow,
      );
      const mappedInputs = mappedNumbers(mapped);
      const fields: Record<string, string> = Object.fromEntries(
        Object.entries(mapped).map(([k, v]) => [k, String(v)]),
      );
      if (!ledger.year) {
        for (const key of STATEMENT_YTD_FIELD_KEYS) fields[key] = "";
      }

      const { data: existing } = await supabaseAdmin
        .from("clients")
        .select("financials")
        .eq("id", data.clientId)
        .maybeSingle();
      const prev =
        existing?.financials &&
        typeof existing.financials === "object" &&
        !Array.isArray(existing.financials)
          ? (existing.financials as Record<string, unknown>)
          : {};
      const merged: Record<string, unknown> = {
        ...prev,
        ...fields,
      };
      if (!ledger.year) {
        for (const key of STATEMENT_YTD_FIELD_KEYS) delete merged[key];
      }

      await supabaseAdmin
        .from("clients")
        .update({
          financials: merged as never,
          financials_updated_at: new Date().toISOString(),
        })
        .eq("id", data.clientId);

      await upsertQboSnapshot(
        data.clientId,
        merged,
        context.userId ?? null,
        ledger.to,
        ledger.periodLabel,
      );

      const nowIso = new Date().toISOString();
      const cacheRows: Array<{
        client_id: string;
        data_type: string;
        raw_data: unknown;
        synced_at: string;
      }> = [
        {
          client_id: data.clientId,
          data_type: "pl",
          raw_data: {
            ...pnl,
            from: ledger.from,
            to: ledger.to,
            periodLabel: ledger.periodLabel,
            year: ledger.year
              ? {
                  from: ledger.year.from,
                  to: ledger.year.to,
                  periodLabel: ledger.year.periodLabel,
                  basis: ledger.year.basis,
                  revenue: ledger.year.pnl.revenue,
                  netIncome: ledger.year.pnl.netIncome,
                  periodMonths: ledger.year.pnl.periodMonths,
                }
              : null,
          },
          synced_at: nowIso,
        },
        {
          client_id: data.clientId,
          data_type: "bs",
          raw_data: bs,
          synced_at: nowIso,
        },
      ];
      if (ledger.operatingCashflow != null) {
        cacheRows.push({
          client_id: data.clientId,
          data_type: "cf",
          raw_data: { operatingCashflow: ledger.operatingCashflow },
          synced_at: nowIso,
        });
      }
      if (accounts) {
        cacheRows.push({
          client_id: data.clientId,
          data_type: "coa",
          raw_data: { accounts },
          synced_at: nowIso,
        });
      }
      if (transactions) {
        cacheRows.push({
          client_id: data.clientId,
          data_type: "transactions",
          raw_data: { transactions },
          synced_at: nowIso,
        });
      }
      cacheRows.push({
        client_id: data.clientId,
        data_type: "aged_ar",
        raw_data: { ...agedAr, syncedAt: nowIso },
        synced_at: nowIso,
      });
      cacheRows.push({
        client_id: data.clientId,
        data_type: "aged_ap",
        raw_data: { ...agedAp, syncedAt: nowIso },
        synced_at: nowIso,
      });
      await supabaseAdmin.from("qbo_sync_data").upsert(cacheRows as never, {
        onConflict: "client_id,data_type",
      });

      await supabaseAdmin
        .from("qbo_connections")
        .update({
          sync_status: "idle",
          sync_error: null,
          last_synced_at: nowIso,
        })
        .eq("client_id", data.clientId);

      return {
        mappedInputs,
        fields,
        periodMonths: typeof mapped.periodMonths === "string" ? mapped.periodMonths : null,
        periodLabel: ledger.periodLabel,
        periodStart: ledger.from,
        periodEnd: ledger.to,
        summary: {
          revenue: pnl.revenue,
          netIncome: pnl.netIncome,
          totalAssets: bs.totalAssets,
          equity: bs.equity,
          cash: bs.cash,
          operatingCashflow: ledger.operatingCashflow,
          accountsCount: accounts?.length ?? 0,
          transactionsCount: transactions?.length ?? 0,
          agedArLine: agedArProofLine({ ...agedAr, syncedAt: nowIso }),
          agedApLine: agedApProofLine({ ...agedAp, syncedAt: nowIso }),
          periodLabel: ledger.periodLabel,
          periodStart: ledger.from,
          periodEnd: ledger.to,
          ytdRevenue: ledger.year?.pnl.revenue ?? null,
          ytdNetIncome: ledger.year?.pnl.netIncome ?? null,
          ytdPeriodLabel: ledger.year?.periodLabel ?? null,
          ytdBasis: ledger.year?.basis ?? null,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown sync error";
      await supabaseAdmin
        .from("qbo_connections")
        .update({ sync_status: "error", sync_error: msg })
        .eq("client_id", data.clientId);
      const wrapped = new Error(`Sync failed: ${msg}`);
      if (err instanceof Error) wrapped.cause = err;
      const tid = intuitTidFromError(err);
      if (tid) Object.assign(wrapped, { intuitTid: tid });
      throw wrapped;
    }
  });

// ─── Disconnect ───────────────────────────────────────────────────────────────

export const disconnectQbo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    assertClientScope(context.actingAsClientId, data.clientId);

    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    const { data: conn } = await supabaseAdmin
      .from("qbo_connections")
      .select("access_token, refresh_token")
      .eq("client_id", data.clientId)
      .maybeSingle();

    if (conn) {
      try {
        await revokeQboToken((conn.refresh_token as string) || (conn.access_token as string));
      } catch (err) {
        const message = err instanceof Error ? err.message : "revoke failed";
        console.error("[QBO disconnect] revoke failed:", {
          message,
          intuit_tid: intuitTidFromError(err),
        });
      }
    }

    await supabaseAdmin.from("qbo_connections").delete().eq("client_id", data.clientId);
    await supabaseAdmin.from("qbo_sync_data").delete().eq("client_id", data.clientId);

    return { success: true };
  });

export { exchangeCodeForTokens };
export type { QboBalanceSheet, QboPnL };
