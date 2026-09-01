/**
 * Milōn Lighthouse — platform-owner console metrics and settings.
 * Access rules live in owner-ops.guard.ts.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdminEnvStatus } from "@/integrations/supabase/client.server";
import {
  OPS_USERNAMES,
  adminLoose,
  assertPlatformOwner,
  assertOpsConsoleAccess,
  missingRelation,
  moneyZar,
  opsPassphrase,
  type AuthCtx,
} from "@/lib/owner-ops.guard";

export { OPS_UNLOCK_KEY } from "@/lib/owner-ops.guard";

/** Public: validate the secret passphrase (obscurity layer only). */
export const unlockOwnerOps = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        passphrase: z.string().min(1).max(200),
        /** Secret operator handle — "forge", "lighthouse", or "keeper". */
        username: z.string().min(1).max(64).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const handle = (data.username ?? "").trim().toLowerCase();
    const userOk = !handle || OPS_USERNAMES.includes(handle);
    if (!userOk) throw new Error("Unknown operator.");
    if (data.passphrase !== opsPassphrase()) throw new Error("Incorrect passphrase.");
    return { ok: true as const };
  });

/**
 * Owner-only: which Supabase admin env vars the server can see.
 * Never returns secret values — only presence and which name resolved.
 */
export const getOwnerOpsEnvStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformOwner(context as AuthCtx);
    const status = getSupabaseAdminEnvStatus();
    return {
      ...status,
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      resend: Boolean(process.env.RESEND_API_KEY),
      resendWebhook: Boolean(process.env.RESEND_WEBHOOK_SECRET),
      siteUrl: Boolean(process.env.SITE_URL || process.env.VITE_APP_URL),
    };
  });

export type OpsPaymentRow = {
  id: string;
  paidAt: string;
  amountCents: number;
  amountLabel: string;
  currency: string;
  payerLabel: string | null;
  planCode: string | null;
  status: string;
  note: string | null;
};

export type OpsLeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  status: string;
  source: string | null;
  notes: string | null;
  createdAt: string;
};

export type OpsDashboard = {
  me: { email: string };
  signups: {
    totalUsers: number;
    accountants: number;
    businessOwners: number;
    clientMembers: number;
    firms: number;
    clients: number;
    clientsWithOwner: number;
    last7dUsersApprox: number | null;
  };
  revenue: {
    monthKey: string;
    receivedThisMonthCents: number;
    pendingThisMonthCents: number;
    receivedThisMonthLabel: string;
    pendingThisMonthLabel: string;
    receivedYtdCents: number;
    receivedYtdLabel: string;
    allTimeReceivedCents: number;
    allTimeReceivedLabel: string;
  };
  payments: OpsPaymentRow[];
  settings: {
    featureFlags: Record<string, boolean>;
    pilotNotes: string;
  };
  leads: OpsLeadRow[];
  salesPlaceholder: {
    title: string;
    blurb: string;
    phases: { id: string; label: string; status: "planned" | "next" | "live" }[];
  };
  migrationHint: string | null;
};

export const getOwnerOpsDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { email } = await assertOpsConsoleAccess(context as AuthCtx);
    const admin = adminLoose();

    const { data: roles, error: rolesErr } = await admin.from("user_roles").select("role");
    if (rolesErr) throw new Error(rolesErr.message);

    let accountants = 0;
    let businessOwners = 0;
    let clientMembers = 0;
    for (const r of (roles ?? []) as Array<{ role: string }>) {
      if (r.role === "firm_admin" || r.role === "accountant") accountants += 1;
      else if (r.role === "client_owner") businessOwners += 1;
      else if (r.role === "client_member") clientMembers += 1;
    }

    const [{ count: firms }, { count: clients }, { count: clientsWithOwner }] = await Promise.all([
      admin.from("firms").select("id", { count: "exact", head: true }),
      admin.from("clients").select("id", { count: "exact", head: true }),
      admin
        .from("clients")
        .select("id", { count: "exact", head: true })
        .not("owner_user_id", "is", null),
    ]);

    let totalUsers = ((roles ?? []) as unknown[]).length;
    let last7dUsersApprox: number | null = null;
    try {
      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listed.data?.users) {
        totalUsers = Math.max(totalUsers, listed.data.users.length);
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        last7dUsersApprox = listed.data.users.filter((u) => {
          const t = u.created_at ? Date.parse(u.created_at) : 0;
          return t >= weekAgo;
        }).length;
      }
    } catch {
      /* ignore */
    }

    const payments: OpsPaymentRow[] = [];
    let receivedThisMonthCents = 0;
    let pendingThisMonthCents = 0;
    let receivedYtdCents = 0;
    let allTimeReceivedCents = 0;
    let migrationHint: string | null = null;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const y = now.getFullYear();
    const m = now.getMonth();

    const { data: payRows, error: payErr } = await admin
      .from("milon_ops_payments")
      .select("*")
      .order("paid_at", { ascending: false })
      .limit(100);

    if (payErr) {
      if (missingRelation(payErr.message ?? "")) {
        migrationHint =
          "Run migration 20260819190000_milon_owner_ops.sql in the Supabase SQL editor to enable payments, settings, and leads.";
      } else {
        throw new Error(payErr.message);
      }
    } else {
      for (const row of (payRows ?? []) as Array<Record<string, unknown>>) {
        const amountCents = Number(row.amount_cents ?? 0);
        const status = String(row.status ?? "received");
        const paidAt = String(row.paid_at ?? "");
        const d = paidAt ? new Date(paidAt.length <= 10 ? `${paidAt}T12:00:00` : paidAt) : null;
        if (status === "received") {
          allTimeReceivedCents += amountCents;
          if (d && d.getFullYear() === y) receivedYtdCents += amountCents;
          if (d && d.getFullYear() === y && d.getMonth() === m) {
            receivedThisMonthCents += amountCents;
          }
        }
        if (status === "pending" && d && d.getFullYear() === y && d.getMonth() === m) {
          pendingThisMonthCents += amountCents;
        }
        payments.push({
          id: String(row.id),
          paidAt,
          amountCents,
          amountLabel: moneyZar(amountCents),
          currency: String(row.currency ?? "ZAR"),
          payerLabel: (row.payer_label as string | null) ?? null,
          planCode: (row.plan_code as string | null) ?? null,
          status,
          note: (row.note as string | null) ?? null,
        });
      }
    }

    let featureFlags: Record<string, boolean> = {
      maintenance_mode: false,
      signup_open: true,
      ask_ai_enabled: true,
      qbo_enabled: true,
      landing_waitlist_orbit: true,
      show_pricing: true,
    };
    let pilotNotes = "First-pilot watchlist — edit me from Ops.";

    const { data: settingsRows } = await admin.from("milon_ops_settings").select("key, value");
    if (settingsRows) {
      for (const s of settingsRows as Array<{ key: string; value: unknown }>) {
        if (s.key === "feature_flags" && s.value && typeof s.value === "object") {
          featureFlags = { ...featureFlags, ...(s.value as Record<string, boolean>) };
        }
        if (s.key === "pilot_notes" && s.value && typeof s.value === "object") {
          const t = (s.value as { text?: string }).text;
          if (typeof t === "string") pilotNotes = t;
        }
      }
    }

    let leads: OpsLeadRow[] = [];
    const { data: leadRows } = await admin
      .from("milon_ops_leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (leadRows) {
      leads = (leadRows as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.id),
        name: (row.name as string | null) ?? null,
        email: (row.email as string | null) ?? null,
        company: (row.company as string | null) ?? null,
        status: String(row.status ?? "new"),
        source: (row.source as string | null) ?? null,
        notes: (row.notes as string | null) ?? null,
        createdAt: String(row.created_at ?? ""),
      }));
    }

    const dash: OpsDashboard = {
      me: { email },
      signups: {
        totalUsers,
        accountants,
        businessOwners,
        clientMembers,
        firms: firms ?? 0,
        clients: clients ?? 0,
        clientsWithOwner: clientsWithOwner ?? 0,
        last7dUsersApprox,
      },
      revenue: {
        monthKey,
        receivedThisMonthCents,
        pendingThisMonthCents,
        receivedThisMonthLabel: moneyZar(receivedThisMonthCents),
        pendingThisMonthLabel: moneyZar(pendingThisMonthCents),
        receivedYtdCents,
        receivedYtdLabel: moneyZar(receivedYtdCents),
        allTimeReceivedCents,
        allTimeReceivedLabel: moneyZar(allTimeReceivedCents),
      },
      payments,
      settings: { featureFlags, pilotNotes },
      leads,
      salesPlaceholder: {
        title: "AI Sales & Email Engine",
        blurb:
          "Placeholder for your founder outbound system — Claude-drafted sequences, lead scoring, and an inbox that helps land first paying clients.",
        phases: [
          { id: "crm", label: "Lead CRM + import", status: "next" },
          { id: "sequences", label: "AI email sequences (Resend)", status: "planned" },
          { id: "scoring", label: "Fit scoring (accountant vs owner)", status: "planned" },
          { id: "inbox", label: "Reply assist (email correspondence)", status: "planned" },
        ],
      },
      migrationHint,
    };
    return dash;
  });

export const upsertOpsFeatureFlags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ flags: z.record(z.string(), z.boolean()) }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = await assertPlatformOwner(context as AuthCtx);
    const admin = adminLoose();

    const { data: existing } = await admin
      .from("milon_ops_settings")
      .select("value")
      .eq("key", "feature_flags")
      .maybeSingle();

    const prev =
      existing && typeof (existing as { value?: unknown }).value === "object"
        ? ((existing as { value: Record<string, boolean> }).value ?? {})
        : {};
    const next = { ...prev, ...data.flags };

    const { error } = await admin.from("milon_ops_settings").upsert({
      key: "feature_flags",
      value: next,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    });
    if (error) {
      if (missingRelation(error.message)) {
        throw new Error(
          "Ops settings table missing — run migration 20260819190000_milon_owner_ops.sql.",
        );
      }
      throw new Error(error.message);
    }
    return { flags: next };
  });

export const upsertOpsPilotNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ text: z.string().max(8000) }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = await assertPlatformOwner(context as AuthCtx);
    const admin = adminLoose();
    const { error } = await admin.from("milon_ops_settings").upsert({
      key: "pilot_notes",
      value: { text: data.text },
      updated_at: new Date().toISOString(),
      updated_by: userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const addOpsPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        amountZar: z.number().positive().max(10_000_000),
        paidAt: z.string().min(4).max(32),
        payerLabel: z.string().max(200).optional(),
        planCode: z.string().max(64).optional(),
        status: z.enum(["received", "pending", "refunded"]).default("received"),
        note: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = await assertPlatformOwner(context as AuthCtx);
    const admin = adminLoose();
    const amountCents = Math.round(data.amountZar * 100);
    const { error } = await admin.from("milon_ops_payments").insert({
      amount_cents: amountCents,
      paid_at: data.paidAt.slice(0, 10),
      payer_label: data.payerLabel?.trim() || null,
      plan_code: data.planCode?.trim() || null,
      status: data.status,
      note: data.note?.trim() || null,
      created_by: userId,
      currency: "ZAR",
    });
    if (error) {
      if (missingRelation(error.message)) {
        throw new Error(
          "Ops payments table missing — run migration 20260819190000_milon_owner_ops.sql in Supabase.",
        );
      }
      throw new Error(error.message);
    }
    return { ok: true as const };
  });

export const addOpsLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().max(200).optional(),
        email: z.string().email().max(200).optional(),
        company: z.string().max(200).optional(),
        source: z.string().max(100).optional(),
        notes: z.string().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformOwner(context as AuthCtx);
    const admin = adminLoose();
    const { error } = await admin.from("milon_ops_leads").insert({
      name: data.name?.trim() || null,
      email: data.email?.trim().toLowerCase() || null,
      company: data.company?.trim() || null,
      source: data.source?.trim() || "manual",
      notes: data.notes?.trim() || null,
      status: "new",
    });
    if (error) {
      if (missingRelation(error.message)) {
        throw new Error(
          "Ops leads table missing — run migration 20260819190000_milon_owner_ops.sql in Supabase.",
        );
      }
      throw new Error(error.message);
    }
    return { ok: true as const };
  });
