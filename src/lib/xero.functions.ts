import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertClientScope } from "@/lib/assert-client-scope";
import { getSupabaseAdminOrNull, supabaseAdmin } from "@/integrations/supabase/client.server";
import { agedArProofLine, readCollectionsSnapshot } from "@/lib/collections";
import { agedApProofLine, readPayablesSnapshot, skippedPayables } from "@/lib/payables";
import { computeRatios, type RatioInputs } from "@/lib/ratios";
import { calendarMonthStamp, readStatementMeta, XERO_YTD_FIELD_KEYS } from "@/lib/statement-period";
import { runwayWeeksFromCashflow, type SavedCashflowLike } from "@/lib/cash-runway";
import {
  applyXeroOpeningCash,
  describeXeroOpeningCash,
  seedXeroBankForecastLines,
  type XeroOpeningCashSource,
} from "@/lib/xero-opening";
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
  fetchXeroConnections,
  bankSummaryRange,
  coverageFromXeroCache,
  fetchXeroAgedPayables,
  fetchXeroAgedReceivables,
  fetchXeroLedgerStatement,
  mapXeroToFinancialInputs,
  pickXeroTenant,
  refreshXeroToken,
  resolveXeroCash,
  revokeXeroToken,
  XERO_CLIENT_ID,
  type XeroBalanceSheet,
  type XeroPnL,
} from "@/lib/xero";

// ─── Config probe ────────────────────────────────────────────────────────────

export const getXeroConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      XERO_CLIENT_ID();
      return { configured: true };
    } catch {
      return { configured: false };
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
  /** Set only after a sync that stored statementSource=xero with explicit dates. */
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
  /** Balance-sheet date. The month-to-date end when the cache has no as-of. */
  bsAsOf: string | null;
  bankCount: number | null;
  bankTotal: number | null;
  bankWarning: string | null;
  bankFrom: string | null;
  bankTo: string | null;
  openingCashNote: string | null;
  forecastLinesNote: string | null;
  /** Aged receivables proof: applied, empty, or the skip reason. */
  agedArLine: string;
  /** Aged payables proof: applied, empty, or the skip reason. */
  agedApLine: string;
} | null;

function numField(fields: Record<string, unknown>, key: string): number | null {
  const raw = fields[key];
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  return Number.isFinite(n) ? n : null;
}

function xeroFigureProof(financials: unknown): {
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
  bsAsOf: string | null;
  bankCount: number | null;
  bankTotal: number | null;
  bankWarning: string | null;
  bankFrom: string | null;
  bankTo: string | null;
  openingCashNote: string | null;
  forecastLinesNote: string | null;
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
    bsAsOf: null,
    bankCount: null,
    bankTotal: null,
    bankWarning: null,
    bankFrom: null,
    bankTo: null,
    openingCashNote: null,
    forecastLinesNote: null,
    agedArLine: "Aged receivables appear after the next Sync",
    agedApLine: "Aged payables appear after the next Sync",
  };
  if (!financials || typeof financials !== "object" || Array.isArray(financials)) return empty;
  const meta = readStatementMeta(financials);
  if (meta.statementSource !== "xero") return empty;
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
    bsAsOf: meta.periodEnd,
    bankCount: null,
    bankTotal: null,
    bankWarning: null,
    bankFrom: null,
    bankTo: null,
    openingCashNote: null,
    forecastLinesNote: null,
    agedArLine: "Aged receivables appear after the next Sync",
    agedApLine: "Aged payables appear after the next Sync",
  };
}

function statusFromRow(
  conn: {
    tenant_id: string | null;
    tenant_name: string | null;
    connected_at: string | null;
    last_synced_at: string | null;
    sync_status: string | null;
    sync_error: string | null;
    data_depth: string | null;
  },
  financials: unknown,
): NonNullable<XeroStatus> {
  const derived = xeroStateFromStored({
    present: true,
    syncStatus: conn.sync_status,
    syncError: conn.sync_error,
  });
  const proof = xeroFigureProof(financials);
  return {
    tenantId: conn.tenant_id ?? "",
    tenantName: conn.tenant_name ?? null,
    connectedAt: conn.connected_at ?? "",
    lastSyncedAt: conn.last_synced_at ?? null,
    syncStatus: derived.syncStatus,
    syncError: derived.syncError,
    dataDepth: conn.data_depth ?? "statement",
    phase: derived.phase,
    ...proof,
  };
}

export const getXeroStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<XeroStatus> => {
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
      .from("xero_connections")
      .select(
        "tenant_id, tenant_name, connected_at, last_synced_at, sync_status, sync_error, data_depth",
      )
      .eq("client_id", data.clientId)
      .maybeSingle();

    if (!conn) return null;
    const status = statusFromRow(conn, (client as { financials?: unknown }).financials);
    const { data: caches } = await admin
      .from("xero_sync_data")
      .select("data_type, raw_data")
      .eq("client_id", data.clientId)
      .in("data_type", ["bs", "bank", "aged_ar", "aged_ap"]);
    const coverage = coverageFromXeroCache(caches ?? []);
    const aged = readCollectionsSnapshot(
      (caches ?? []).find((row) => row.data_type === "aged_ar")?.raw_data,
    );
    const agedAp = readPayablesSnapshot(
      (caches ?? []).find((row) => row.data_type === "aged_ap")?.raw_data,
    );
    return {
      ...status,
      bsAsOf: coverage.bsAsOf ?? status.bsAsOf,
      bankCount: coverage.bankCount,
      bankTotal: coverage.bankTotal,
      bankWarning: coverage.bankWarning,
      bankFrom: coverage.bankFrom,
      bankTo: coverage.bankTo,
      openingCashNote: coverage.openingCashNote,
      forecastLinesNote: coverage.forecastLinesNote,
      agedArLine: aged ? agedArProofLine(aged) : status.agedArLine,
      agedApLine: agedAp ? agedApProofLine(agedAp) : status.agedApLine,
    };
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
  /** Every mapped field, including period label strings, ready for the financials blob. */
  fields: Record<string, string>;
  periodMonths: string | null;
  periodLabel: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dataDepth: "statement";
  summary: {
    revenue: number;
    netIncome: number;
    totalAssets: number;
    equity: number;
    cash: number;
    periodLabel: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    ytdRevenue: number | null;
    ytdNetIncome: number | null;
    ytdPeriodLabel: string | null;
    ytdBasis: "financial" | "calendar" | null;
    bsAsOf: string | null;
    bankCount: number | null;
    bankTotal: number | null;
    bankWarning: string | null;
    bankFrom: string | null;
    bankTo: string | null;
    openingCashNote: string | null;
    forecastLinesNote: string | null;
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

async function upsertXeroSnapshot(
  clientId: string,
  financials: Record<string, unknown>,
  userId: string | null,
  periodDate: string,
  periodLabel: string,
) {
  const ratios = computeRatios(financials as unknown as RatioInputs);

  let id = await findSnapshotId(clientId, "period_date", periodDate);
  if (!id) id = await findSnapshotId(clientId, "period_label", periodLabel);
  // Earlier syncs stamped year-to-date figures as "Sep 2026". Replace that row.
  if (!id) {
    const monthStamp = calendarMonthStamp(periodDate);
    if (monthStamp) {
      const { data } = await supabaseAdmin
        .from("client_financial_snapshots")
        .select("id")
        .eq("client_id", clientId)
        .eq("source", "xero")
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
      const ledger = await fetchXeroLedgerStatement(tenantId, accessToken);
      const { pnl, bs } = ledger;

      const mapped = mapXeroToFinancialInputs(
        pnl,
        bs,
        {
          from: ledger.from,
          to: ledger.to,
          label: ledger.periodLabel,
        },
        ledger.year
          ? {
              pnl: ledger.year.pnl,
              from: ledger.year.from,
              to: ledger.year.to,
              label: ledger.year.periodLabel,
              basis: ledger.year.basis,
            }
          : null,
        ledger.bank,
      );
      const mappedInputs = mappedNumbers(mapped);
      const fields: Record<string, string> = Object.fromEntries(
        Object.entries(mapped).map(([k, v]) => [k, String(v)]),
      );
      if (!ledger.year) {
        for (const key of XERO_YTD_FIELD_KEYS) fields[key] = "";
      }

      const { data: existing } = await supabaseAdmin
        .from("clients")
        .select("financials, cashflow")
        .eq("id", data.clientId)
        .maybeSingle();
      const prev =
        existing?.financials && typeof existing.financials === "object" && !Array.isArray(existing.financials)
          ? (existing.financials as Record<string, unknown>)
          : {};
      const merged: Record<string, unknown> = {
        ...prev,
        ...fields,
      };
      if (!ledger.year) {
        for (const key of XERO_YTD_FIELD_KEYS) delete merged[key];
      }

      const nowIso = new Date().toISOString();
      const agedAr = await fetchXeroAgedReceivables(tenantId, accessToken, ledger.to, nowIso);
      const agedAp = await fetchXeroAgedPayables(tenantId, accessToken, ledger.to, nowIso).catch(
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Aged payables failed";
          return skippedPayables({
            source: "xero",
            asOf: ledger.to,
            syncedAt: nowIso,
            skipReason: `Aged payables were not applied. ${msg.replace(/\s+/g, " ").slice(0, 180)}`,
          });
        },
      );
      const cashPosition = resolveXeroCash(bs, ledger.bank);
      const cashSource: XeroOpeningCashSource =
        ledger.bank && ledger.bank.accounts.length > 0 && Number.isFinite(ledger.bank.totalClosing)
          ? "bank_summary"
          : "balance_sheet";
      const opening = applyXeroOpeningCash(
        (existing as { cashflow?: unknown } | null)?.cashflow,
        cashPosition,
        ledger.to,
      );
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const flows = ledger.bank
        ? {
            accountCount: ledger.bank.accounts.length,
            cashReceived: round2(
              ledger.bank.accounts.reduce((sum, account) => sum + account.cashReceived, 0),
            ),
            cashSpent: round2(
              ledger.bank.accounts.reduce((sum, account) => sum + account.cashSpent, 0),
            ),
            from: ledger.bank.from,
            to: ledger.bank.to,
          }
        : null;
      const seeded = seedXeroBankForecastLines(opening.cashflow, flows);
      const openingCashNote = describeXeroOpeningCash(opening.reason, cashPosition, cashSource);
      const forecastLinesNote = seeded.reason;
      const cashflowChanged = opening.changed || seeded.changed;
      const runway = cashflowChanged
        ? runwayWeeksFromCashflow(seeded.cashflow as SavedCashflowLike)
        : null;
      const bankWindow = ledger.bank ?? { ...bankSummaryRange(ledger.to), accounts: [] as const };
      await supabaseAdmin
        .from("clients")
        .update({
          financials: merged as never,
          financials_updated_at: nowIso,
          ...(cashflowChanged
            ? {
                cashflow: seeded.cashflow as never,
                last_forecast_at: nowIso,
                ...(runway != null ? { cash_runway_weeks: runway } : {}),
              }
            : {}),
        })
        .eq("id", data.clientId);

      await upsertXeroSnapshot(
        data.clientId,
        merged,
        context.userId ?? null,
        ledger.to,
        ledger.periodLabel,
      );

      const cacheRows = [
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
          } as never,
          synced_at: nowIso,
        },
        { client_id: data.clientId, data_type: "bs", raw_data: { ...bs, asOf: ledger.to } as never, synced_at: nowIso },
        {
          client_id: data.clientId,
          data_type: "bank",
          raw_data: {
            ...(ledger.bank
              ? { ...ledger.bank, warning: null }
              : {
                  from: bankWindow.from,
                  to: bankWindow.to,
                  accounts: [],
                  totalClosing: null,
                  warning: ledger.bankWarning,
                }),
            openingCash: { status: opening.reason, reason: openingCashNote },
            forecastLines: { status: seeded.status, reason: forecastLinesNote },
          } as never,
          synced_at: nowIso,
        },
        {
          client_id: data.clientId,
          data_type: "aged_ar",
          raw_data: agedAr as never,
          synced_at: nowIso,
        },
        {
          client_id: data.clientId,
          data_type: "aged_ap",
          raw_data: agedAp as never,
          synced_at: nowIso,
        },
      ];
      await supabaseAdmin.from("xero_sync_data").upsert(cacheRows, { onConflict: "client_id,data_type" });

      const ok = reduceXeroConnection(started, { type: "sync_succeeded" });
      await supabaseAdmin
        .from("xero_connections")
        .update({
          sync_status: ok.syncStatus,
          sync_error: null,
          last_synced_at: nowIso,
          data_depth: "statement",
        })
        .eq("client_id", data.clientId);

      return {
        mappedInputs,
        fields,
        periodMonths: typeof mapped.periodMonths === "string" ? mapped.periodMonths : null,
        periodLabel: ledger.periodLabel,
        periodStart: ledger.from,
        periodEnd: ledger.to,
        dataDepth: "statement",
        summary: {
          revenue: pnl.revenue,
          netIncome: pnl.netIncome,
          totalAssets: bs.totalAssets,
          equity: bs.equity,
          periodLabel: ledger.periodLabel,
          periodStart: ledger.from,
          periodEnd: ledger.to,
          ytdRevenue: ledger.year?.pnl.revenue ?? null,
          ytdNetIncome: ledger.year?.pnl.netIncome ?? null,
          ytdPeriodLabel: ledger.year?.periodLabel ?? null,
          ytdBasis: ledger.year?.basis ?? null,
          bsAsOf: ledger.to,
          bankCount: ledger.bank ? ledger.bank.accounts.length : null,
          bankTotal: ledger.bank ? ledger.bank.totalClosing : null,
          bankWarning: ledger.bankWarning,
          bankFrom: bankWindow.from,
          bankTo: bankWindow.to,
          openingCashNote,
          forecastLinesNote,
          agedArLine: agedArProofLine(agedAr),
          agedApLine: agedApProofLine(agedAp),
          cash: cashPosition,
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
export type { XeroBalanceSheet, XeroPnL };
