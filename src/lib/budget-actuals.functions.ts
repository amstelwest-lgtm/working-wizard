/**
 * Server functions for budget month actuals (list / upsert / confirm).
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  normalizeTaxonomyTotals,
  type ActualsSource,
  type ActualsStatus,
  type BudgetMonthActualRow,
  type MappedActualLine,
  type TaxonomyTotals,
} from "@/lib/budget.variance";

type LooseSb = { from: (t: string) => any };

function authedSupabase() {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) throw new Error("Missing Supabase env vars");
  const req = getRequest();
  const token = req?.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  return createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

async function assertClientAccess(
  userId: string,
  clientId: string,
  sb: ReturnType<typeof authedSupabase>,
) {
  const { data, error } = await sb.rpc("has_client_access" as never, {
    _user_id: userId,
    _client_id: clientId,
  } as never);
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have access to this client");
}

const totalsSchema = z.object({
  revenue: z.number().finite(),
  cogs: z.number().finite(),
  grossProfit: z.number().finite(),
  overheadsPeople: z.number().finite(),
  overheadsPremises: z.number().finite(),
  overheadsOps: z.number().finite(),
  overheadsSales: z.number().finite(),
  overheadsOther: z.number().finite(),
  overheadsTotal: z.number().finite(),
  depreciation: z.number().finite(),
  ebit: z.number().finite(),
});

const lineSchema = z.object({
  taxonomyKey: z.string().min(1).max(64),
  amount: z.number().finite(),
  rawLabel: z.string().max(200).optional(),
});

function mapRow(row: Record<string, unknown>): BudgetMonthActualRow {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    month: String(row.month),
    source: row.source as ActualsSource,
    sourceRef: (row.source_ref as string | null) ?? null,
    status: row.status as ActualsStatus,
    totals: normalizeTaxonomyTotals(row.totals as Partial<TaxonomyTotals>),
    lines: Array.isArray(row.lines) ? (row.lines as MappedActualLine[]) : [],
    periodStart: row.period_start ? String(row.period_start).slice(0, 10) : null,
    periodEnd: row.period_end ? String(row.period_end).slice(0, 10) : null,
    confidence: row.confidence == null ? null : Number(row.confidence),
    warnings: Array.isArray(row.warnings)
      ? (row.warnings as unknown[]).map(String)
      : [],
    confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
    updatedAt: String(row.updated_at ?? row.created_at ?? ""),
  };
}

export const listBudgetMonthActuals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        fyStart: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);

    const loose = sb as unknown as LooseSb;
    let q = loose
      .from("budget_month_actuals")
      .select("*")
      .eq("client_id", data.clientId)
      .order("month", { ascending: true });

    if (data.fyStart) {
      const [y, m] = data.fyStart.split("-").map(Number);
      const endMonth = m === 1 ? 12 : m - 1;
      const endYear = m === 1 ? y : y + 1;
      const end = `${endYear}-${String(endMonth).padStart(2, "0")}`;
      q = q.gte("month", data.fyStart).lte("month", end);
    }

    const { data: rows, error } = await q;
    if (error) {
      if (/budget_month_actuals|42P01|42703/i.test(error.message ?? "")) {
        return { actuals: [] as BudgetMonthActualRow[], migrationRequired: true };
      }
      throw new Error(error.message);
    }
    return {
      actuals: (rows ?? []).map((r: Record<string, unknown>) => mapRow(r)),
      migrationRequired: false,
    };
  });

export const upsertBudgetMonthActual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        month: z.string().regex(/^\d{4}-\d{2}$/),
        source: z.enum(["pdf", "qbo", "xero", "manual"]),
        sourceRef: z.string().max(500).nullable().optional(),
        status: z.enum(["draft", "confirmed"]).default("draft"),
        totals: totalsSchema,
        lines: z.array(lineSchema).max(200).default([]),
        periodStart: z.string().max(32).nullable().optional(),
        periodEnd: z.string().max(32).nullable().optional(),
        confidence: z.number().min(0).max(1).nullable().optional(),
        warnings: z.array(z.string().max(400)).max(20).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);

    const totals = normalizeTaxonomyTotals(data.totals);
    const now = new Date().toISOString();
    const confirm =
      data.status === "confirmed"
        ? { confirmed_at: now, confirmed_by: userData.user.id }
        : { confirmed_at: null, confirmed_by: null };

    const loose = sb as unknown as LooseSb;
    const payload = {
      client_id: data.clientId,
      month: data.month,
      source: data.source,
      source_ref: data.sourceRef ?? null,
      status: data.status,
      totals,
      lines: data.lines,
      period_start: data.periodStart || null,
      period_end: data.periodEnd || null,
      confidence: data.confidence ?? null,
      warnings: data.warnings,
      updated_at: now,
      ...confirm,
    };

    const { data: row, error } = await loose
      .from("budget_month_actuals")
      .upsert(payload, { onConflict: "client_id,month" })
      .select("*")
      .maybeSingle();

    if (error) {
      if (/budget_month_actuals|42P01|42703/i.test(error.message ?? "")) {
        throw new Error(
          "Budget actuals table missing — run migration 20260813120000_budget_month_actuals.sql in Supabase.",
        );
      }
      throw new Error(error.message);
    }
    if (!row) throw new Error("Save failed — no row returned");
    return { actual: mapRow(row as Record<string, unknown>) };
  });

export const confirmBudgetMonthActual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        month: z.string().regex(/^\d{4}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);

    const now = new Date().toISOString();
    const loose = sb as unknown as LooseSb;
    const { data: row, error } = await loose
      .from("budget_month_actuals")
      .update({
        status: "confirmed",
        confirmed_at: now,
        confirmed_by: userData.user.id,
        updated_at: now,
      })
      .eq("client_id", data.clientId)
      .eq("month", data.month)
      .select("*")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row) throw new Error("No actuals row for that month — save draft first");
    return { actual: mapRow(row as Record<string, unknown>) };
  });

export const deleteBudgetMonthActual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        month: z.string().regex(/^\d{4}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);

    const loose = sb as unknown as LooseSb;
    const { error } = await loose
      .from("budget_month_actuals")
      .delete()
      .eq("client_id", data.clientId)
      .eq("month", data.month);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
