import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertClientScope } from "@/lib/assert-client-scope";
import { getSupabaseAdminOrNull, supabaseAdmin } from "@/integrations/supabase/client.server";
import { computeRatios, type RatioInputs } from "@/lib/ratios";
import { currentPeriodDate, currentPeriodLabel } from "@/lib/financial-snapshots";
import {
  reduceXeroConnection,
  sanitizeXeroReturnPath,
  xeroStateFromStored,
  type XeroConnectionState,
} from "@/lib/xero-state";
import {
  buildXeroAuthUrl,
  deleteXeroConnection,
  exchangeXeroCodeForTokens,
  fetchXeroBalanceSheet,
  fetchXeroBankSummary,
  fetchXeroConnections,
  fetchXeroInvoices,
  fetchXeroProfitAndLoss,
  mapXeroToFinancialInputs,
  pickXeroTenant,
  refreshXeroToken,
  revokeXeroToken,
  xeroInvoiceSyncEnabled,
  XERO_CLIENT_ID,
  type XeroBalanceSheet,
  type XeroBankSummary,
  type XeroPnL,
} from "@/lib/xero";

// ─── Config probe ────────────────────────────────────────────────────────────

export const getXeroConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      XERO_CLIENT_ID();
      return { configured: true, invoiceSync: xeroInvoiceSyncEnabled() };
    } catch {
      return { configured: false, invoiceSync: false };
    }
  });

// ─── Start OAuth ─────────────────────────────────────────────────────────────

export const getXeroAuthUrl = createServerFn({ method: "POST" })
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
    const returnPath = sanitizeXeroReturnPath(data.returnPath, data.clientId);
    await supabaseAdmin.from("xero_oauth_states").insert({
      state,
      client_id: data.clientId,
      return_path: returnPath,
    });

    return { authUrl: buildXeroAuthUrl(state) };
  });

// ─── Status ──────────────────────────────────────────────────────────────────

export type XeroStatus = {
  tenantId: string;
  tenantName: string | null;
  connectedAt: string;
  lastSyncedAt: string | null;
  syncStatus: string;
  syncError: string | null;
  dataDepth: string;
  phase: XeroConnectionState["phase"];
} | null;

function statusFromRow(conn: {
  tenant_id: string | null;
  tenant_name: string | null;
  connected_at: string | null;
  last_synced_at: string | null;
  sync_status: string | null;
  sync_error: string | null;
  data_depth: string | null;
}): NonNullable<XeroStatus> {
  const derived = xeroStateFromStored({
    present: true,
    syncStatus: conn.sync_status,
    syncError: conn.sync_error,
  });
  return {
    tenantId: conn.tenant_id ?? "",
    tenantName: conn.tenant_name ?? null,
    connectedAt: conn.connected_at ?? "",
    lastSyncedAt: conn.last_synced_at ?? null,
    syncStatus: derived.syncStatus,
    syncError: derived.syncError,
    dataDepth: conn.data_depth ?? "statement",
    phase: derived.phase,
  };
}

export const getXeroStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<XeroStatus> => {
    assertClientScope(context.actingAsClientId, data.clientId);

    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    const admin = getSupabaseAdminOrNull();
    if (!admin) return null;

    const { data: conn } = await admin
      .from("xero_connections")
      .select(
        "tenant_id, tenant_name, connected_at, last_synced_at, sync_status, sync_error, data_depth",
      )
      .eq("client_id", data.clientId)
      .maybeSingle();

    if (!conn) return null;
    return statusFromRow(conn);
  });

export const getXeroStatuses = createServerFn({ method: "POST" })
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
      .from("xero_connections")
      .select("client_id, tenant_name, last_synced_at, sync_status")
      .in("client_id", scoped);

    const out: Record<
      string,
      { tenantName: string | null; lastSyncedAt: string | null; syncStatus: string }
    > = {};
    for (const r of rows ?? []) {
      out[r.client_id] = {
        tenantName: r.tenant_name ?? null,
        lastSyncedAt: r.last_synced_at ?? null,
        syncStatus: r.sync_status ?? "idle",
      };
    }
    return out;
  });

// ─── Sync ────────────────────────────────────────────────────────────────────

export type XeroSyncResult = {
  mappedInputs: Record<string, number>;
  periodMonths: string | null;
  dataDepth: "statement" | "transaction";
  summary: {
    revenue: number;
    netIncome: number;
    totalAssets: number;
    equity: number;
    cash: number;
    operatingCashflow: number | null;
    invoiceCount: number;
  };
};

function mappedNumbers(mapped: Record<string, number | string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(mapped)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

async function upsertXeroSnapshot(
  clientId: string,
  financials: Record<string, unknown>,
  userId: string | null,
) {
  const periodDate = currentPeriodDate();
  const periodLabel = currentPeriodLabel();
  const ratios = computeRatios(financials as unknown as RatioInputs);

  const { data: existing } = await supabaseAdmin
    .from("client_financial_snapshots")
    .select("id")
    .eq("client_id", clientId)
    .eq("period_date", periodDate)
    .maybeSingle();

  let id = (existing as { id?: string } | null)?.id ?? null;
  if (!id) {
    const { data: byLabel } = await supabaseAdmin
      .from("client_financial_snapshots")
      .select("id")
      .eq("client_id", clientId)
      .eq("period_label", periodLabel)
      .maybeSingle();
    id = (byLabel as { id?: string } | null)?.id ?? null;
  }

  if (id) {
    await supabaseAdmin
      .from("client_financial_snapshots")
      .update({
        financials: financials as never,
        ratios: ratios as never,
        period_label: periodLabel,
        period_date: periodDate,
        source: "xero",
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
    source: "xero",
    created_by: userId,
  });
}

export const triggerXeroSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<XeroSyncResult> => {
    assertClientScope(context.actingAsClientId, data.clientId);

    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    const { data: connRaw } = await supabaseAdmin
      .from("xero_connections")
      .select("*")
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (!connRaw) throw new Error("Xero is not connected for this client");
    const conn = connRaw;

    const started = reduceXeroConnection(
      xeroStateFromStored({
        present: true,
        syncStatus: conn.sync_status,
        syncError: conn.sync_error,
      }),
      { type: "sync_started" },
    );
    if (started.phase === "disconnected") {
      throw new Error("Xero is not connected for this client");
    }

    await supabaseAdmin
      .from("xero_connections")
      .update({ sync_status: started.syncStatus, sync_error: null })
      .eq("client_id", data.clientId);

    let accessToken = conn.access_token as string;

    try {
      const expiry = new Date(conn.token_expiry as string).getTime();
      if (Date.now() + 60_000 > expiry) {
        const tokens = await refreshXeroToken(conn.refresh_token as string);
        accessToken = tokens.access_token;
        // Xero rotates refresh tokens — persist immediately.
        await supabaseAdmin
          .from("xero_connections")
          .update({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
          })
          .eq("client_id", data.clientId);
      }

      const tenantId = conn.tenant_id as string;
      const [pnl, bs, bank] = await Promise.all([
        fetchXeroProfitAndLoss(tenantId, accessToken),
        fetchXeroBalanceSheet(tenantId, accessToken),
        fetchXeroBankSummary(tenantId, accessToken).catch(() => null),
      ]);

      let invoices: unknown[] = [];
      let dataDepth: "statement" | "transaction" = "statement";
      if (xeroInvoiceSyncEnabled()) {
        try {
          invoices = await fetchXeroInvoices(tenantId, accessToken);
          if (invoices.length) dataDepth = "transaction";
        } catch {
          // Phase 2 is optional — never fail a statement sync on invoices.
        }
      }

      const mapped = mapXeroToFinancialInputs(pnl, bs, bank);
      const mappedInputs = mappedNumbers(mapped);

      const { data: existing } = await supabaseAdmin
        .from("clients")
        .select("financials")
        .eq("id", data.clientId)
        .maybeSingle();
      const prev =
        existing?.financials && typeof existing.financials === "object" && !Array.isArray(existing.financials)
          ? (existing.financials as Record<string, unknown>)
          : {};
      const merged: Record<string, unknown> = {
        ...prev,
        ...Object.fromEntries(Object.entries(mapped).map(([k, v]) => [k, String(v)])),
      };

      await supabaseAdmin
        .from("clients")
        .update({
          financials: merged as never,
          financials_updated_at: new Date().toISOString(),
        })
        .eq("id", data.clientId);

      await upsertXeroSnapshot(data.clientId, merged, context.userId ?? null);

      const nowIso = new Date().toISOString();
      const cacheRows = [
        { client_id: data.clientId, data_type: "pl", raw_data: pnl as never, synced_at: nowIso },
        { client_id: data.clientId, data_type: "bs", raw_data: bs as never, synced_at: nowIso },
        {
          client_id: data.clientId,
          data_type: "bank",
          raw_data: (bank ?? {}) as never,
          synced_at: nowIso,
        },
      ];
      if (xeroInvoiceSyncEnabled()) {
        cacheRows.push({
          client_id: data.clientId,
          data_type: "invoices",
          raw_data: { invoices } as never,
          synced_at: nowIso,
        });
      }
      await supabaseAdmin.from("xero_sync_data").upsert(cacheRows, { onConflict: "client_id,data_type" });

      const ok = reduceXeroConnection(started, { type: "sync_succeeded" });
      await supabaseAdmin
        .from("xero_connections")
        .update({
          sync_status: ok.syncStatus,
          sync_error: null,
          last_synced_at: nowIso,
          data_depth: dataDepth,
        })
        .eq("client_id", data.clientId);

      return {
        mappedInputs,
        periodMonths: typeof mapped.periodMonths === "string" ? mapped.periodMonths : null,
        dataDepth,
        summary: {
          revenue: pnl.revenue,
          netIncome: pnl.netIncome,
          totalAssets: bs.totalAssets,
          equity: bs.equity,
          cash: bank?.closingCash || bs.cash,
          operatingCashflow: null,
          invoiceCount: invoices.length,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown sync error";
      const failed = reduceXeroConnection(started, { type: "sync_failed", error: msg });
      await supabaseAdmin
        .from("xero_connections")
        .update({ sync_status: failed.syncStatus, sync_error: failed.syncError })
        .eq("client_id", data.clientId);
      throw new Error(`Sync failed: ${msg}`);
    }
  });

// ─── Disconnect ───────────────────────────────────────────────────────────────

export const disconnectXero = createServerFn({ method: "POST" })
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
      .from("xero_connections")
      .select("access_token, refresh_token, connection_id")
      .eq("client_id", data.clientId)
      .maybeSingle();

    if (conn) {
      await deleteXeroConnection(conn.access_token as string, (conn.connection_id as string) ?? "");
      await revokeXeroToken((conn.refresh_token as string) ?? (conn.access_token as string));
    }

    await supabaseAdmin.from("xero_connections").delete().eq("client_id", data.clientId);
    await supabaseAdmin.from("xero_sync_data").delete().eq("client_id", data.clientId);

    return { success: true };
  });

export { exchangeXeroCodeForTokens, fetchXeroConnections, pickXeroTenant };

// Re-export types used by the UI card.
export type { XeroBalanceSheet, XeroBankSummary, XeroPnL };
