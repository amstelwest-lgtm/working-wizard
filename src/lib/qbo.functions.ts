import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertClientScope } from "@/lib/assert-client-scope";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildQboAuthUrl,
  exchangeCodeForTokens,
  refreshQboToken,
  fetchPnL,
  fetchBalanceSheet,
  fetchCashFlow,
  fetchChartOfAccounts,
  fetchRecentTransactions,
  mapToFinancialInputs,
  QBO_CLIENT_ID,
} from "@/lib/qbo";

// ─── Check whether QBO credentials are configured ────────────────────────────

export const getQboConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      QBO_CLIENT_ID(); // throws if missing
      return { configured: true };
    } catch {
      return { configured: false };
    }
  });

// ─── Generate OAuth URL (creates state for CSRF protection) ──────────────────

export const getQboAuthUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    assertClientScope(context.actingAsClientId, data.clientId);

    const { data: client } = await context.supabase
      .from("clients")
      .select("id, name")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    // Random state token for CSRF protection (10-minute TTL enforced on callback)
    const state = crypto.randomUUID();
    await supabaseAdmin.from("qbo_oauth_states" as never).insert({
      state,
      client_id: data.clientId,
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
} | null;

export const getQboStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<QboStatus> => {
    assertClientScope(context.actingAsClientId, data.clientId);

    const { data: conn } = await supabaseAdmin
      .from("qbo_connections" as never)
      .select(
        "realm_id, company_name, connected_at, last_synced_at, sync_status, sync_error",
      )
      .eq("client_id", data.clientId)
      .maybeSingle();

    if (!conn) return null;
    const c = conn as Record<string, string | null>;
    return {
      realmId: c.realm_id ?? "",
      companyName: c.company_name ?? null,
      connectedAt: c.connected_at ?? "",
      lastSyncedAt: c.last_synced_at ?? null,
      syncStatus: c.sync_status ?? "idle",
      syncError: c.sync_error ?? null,
    };
  });

// ─── Get connection statuses for multiple clients (accountant dashboard) ──────

export const getQboStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ clientIds: z.array(z.string().uuid()).max(200) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (data.clientIds.length === 0) return {};
    const { data: rows } = await supabaseAdmin
      .from("qbo_connections" as never)
      .select("client_id, company_name, last_synced_at, sync_status")
      .in("client_id", data.clientIds);

    const out: Record<
      string,
      { companyName: string | null; lastSyncedAt: string | null; syncStatus: string }
    > = {};
    for (const r of rows ?? []) {
      const row = r as Record<string, string | null>;
      out[row.client_id!] = {
        companyName: row.company_name ?? null,
        lastSyncedAt: row.last_synced_at ?? null,
        syncStatus: row.sync_status ?? "idle",
      };
    }
    return out;
  });

// ─── Trigger full sync ────────────────────────────────────────────────────────

export type SyncResult = {
  mappedInputs: Record<string, number>;
  summary: {
    revenue: number;
    netIncome: number;
    totalAssets: number;
    equity: number;
    operatingCashflow: number;
    accountsCount: number;
    transactionsCount: number;
  };
};

export const triggerQboSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<SyncResult> => {
    assertClientScope(context.actingAsClientId, data.clientId);

    // Verify client access
    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    // Get connection (admin — tokens are sensitive)
    const { data: connRaw } = await supabaseAdmin
      .from("qbo_connections" as never)
      .select("*")
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (!connRaw) throw new Error("QuickBooks is not connected for this client");
    const conn = connRaw as Record<string, string>;

    // Mark syncing
    await supabaseAdmin
      .from("qbo_connections" as never)
      .update({ sync_status: "syncing", sync_error: null })
      .eq("client_id", data.clientId);

    let accessToken = conn.access_token;

    try {
      // Refresh token if expired (60-second buffer)
      const expiry = new Date(conn.token_expiry).getTime();
      if (Date.now() + 60_000 > expiry) {
        const tokens = await refreshQboToken(conn.refresh_token);
        accessToken = tokens.access_token;
        await supabaseAdmin
          .from("qbo_connections" as never)
          .update({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expiry: new Date(
              Date.now() + tokens.expires_in * 1000,
            ).toISOString(),
          })
          .eq("client_id", data.clientId);
      }

      // Fetch all reports in parallel
      const [pnl, bs, cf, coa, txns] = await Promise.all([
        fetchPnL(conn.realm_id, accessToken),
        fetchBalanceSheet(conn.realm_id, accessToken),
        fetchCashFlow(conn.realm_id, accessToken),
        fetchChartOfAccounts(conn.realm_id, accessToken),
        fetchRecentTransactions(conn.realm_id, accessToken),
      ]);

      const mappedInputs = mapToFinancialInputs(pnl, bs, cf);

      // Merge with existing financials (don't overwrite fields QBO doesn't cover)
      const { data: existing } = await supabaseAdmin
        .from("clients" as never)
        .select("financials")
        .eq("id", data.clientId)
        .maybeSingle();
      const prev =
        (existing as Record<string, Record<string, string>> | null)
          ?.financials ?? {};
      const merged = {
        ...prev,
        ...Object.fromEntries(
          Object.entries(mappedInputs).map(([k, v]) => [k, String(v)]),
        ),
      };

      await supabaseAdmin
        .from("clients" as never)
        .update({ financials: merged })
        .eq("id", data.clientId);

      // Cache raw sync data (upsert per data type)
      await supabaseAdmin.from("qbo_sync_data" as never).upsert(
        [
          { client_id: data.clientId, data_type: "pl", raw_data: pnl, synced_at: new Date().toISOString() },
          { client_id: data.clientId, data_type: "bs", raw_data: bs, synced_at: new Date().toISOString() },
          { client_id: data.clientId, data_type: "cf", raw_data: cf, synced_at: new Date().toISOString() },
          { client_id: data.clientId, data_type: "coa", raw_data: { accounts: coa }, synced_at: new Date().toISOString() },
          { client_id: data.clientId, data_type: "transactions", raw_data: { transactions: txns }, synced_at: new Date().toISOString() },
        ],
        { onConflict: "client_id,data_type" },
      );

      // Mark idle + record sync time
      await supabaseAdmin
        .from("qbo_connections" as never)
        .update({
          sync_status: "idle",
          sync_error: null,
          last_synced_at: new Date().toISOString(),
        })
        .eq("client_id", data.clientId);

      return {
        mappedInputs,
        summary: {
          revenue: pnl.revenue,
          netIncome: pnl.netIncome,
          totalAssets: bs.totalAssets,
          equity: bs.equity,
          operatingCashflow: cf.operatingCashflow,
          accountsCount: coa.length,
          transactionsCount: txns.length,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown sync error";
      await supabaseAdmin
        .from("qbo_connections" as never)
        .update({ sync_status: "error", sync_error: msg })
        .eq("client_id", data.clientId);
      throw new Error(`Sync failed: ${msg}`);
    }
  });

// ─── Disconnect ───────────────────────────────────────────────────────────────

export const disconnectQbo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ clientId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    assertClientScope(context.actingAsClientId, data.clientId);

    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    await supabaseAdmin
      .from("qbo_connections" as never)
      .delete()
      .eq("client_id", data.clientId);

    return { success: true };
  });

// ─── Re-export token exchange for callback route ──────────────────────────────
export { exchangeCodeForTokens };
