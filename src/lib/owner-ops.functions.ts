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
  ownerEmailAllowlist,
  type AuthCtx,
  type LooseAdmin,
} from "@/lib/owner-ops.guard";
import { lighthouseSendAllowlistEnforced } from "@/lib/lighthouse-send-allowlist";
import { countRecentSignups } from "@/lib/metrics/glance";
import {
  isExcludedFromInstrument,
  mergeInternalEmails,
  realFirmCount,
  type ExclusionContext,
} from "@/lib/metrics/internal-exclusion";
import { stripeConfigured, stripePublishableConfigured } from "@/lib/stripe.server";

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

export type OpsAccess = {
  allowed: boolean;
  isOwner: boolean;
  isItMember: boolean;
};

/**
 * Signed-in platform owners and Milōn IT members skip the passphrase lock.
 * The passphrase remains an obscurity layer for the public landing box.
 */
export const getOpsAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OpsAccess> => {
    try {
      const access = await assertOpsConsoleAccess(context as AuthCtx);
      return {
        allowed: true,
        isOwner: access.isOwner,
        isItMember: access.isIt,
      };
    } catch {
      return { allowed: false, isOwner: false, isItMember: false };
    }
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
      stripeSecret: stripeConfigured(),
      stripePublishable: stripePublishableConfigured(),
    };
  });

const FUNNEL_EVENT_KEYS = [
  "owner.invite.redeemed",
  "seat.accepted",
  "brain.proposed",
  "brain.step.approved",
  "report.sent",
] as const;

export type FunnelEventKey = (typeof FUNNEL_EVENT_KEYS)[number];

export type FunnelHealthReport = {
  windowDays: number;
  counts: Record<FunnelEventKey, number>;
  preflight: {
    lighthouseDryRunOrAllowlist: boolean;
    resendApiKey: boolean;
    resendFromEmail: boolean;
    resendWebhookSecret: boolean;
    siteUrl: boolean;
  };
  migrationHint: string | null;
};

type AnalyticsRpcAdmin = LooseAdmin & {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

function funnelCountsRpcMissing(message: string): boolean {
  return (
    missingRelation(message) ||
    /invalid schema/i.test(message) ||
    /42883|does not exist/i.test(message) ||
    /analytics_client_brain_funnel_counts/i.test(message)
  );
}

const FUNNEL_COUNTS_HINT =
  "Paste `supabase/migrations/20260910160000_analytics_client_brain_funnel_counts.sql` in the Supabase SQL editor to enable funnel counts.";

function emptyFunnelCounts(): Record<FunnelEventKey, number> {
  return {
    "owner.invite.redeemed": 0,
    "seat.accepted": 0,
    "brain.proposed": 0,
    "brain.step.approved": 0,
    "report.sent": 0,
  };
}

/** Owner-only: design-partner funnel counts + Lighthouse dry-run preflight (presence only). */
export const getFunnelHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FunnelHealthReport> => {
    await assertPlatformOwner(context as AuthCtx);

    const preflight = {
      lighthouseDryRunOrAllowlist: lighthouseSendAllowlistEnforced(),
      resendApiKey: Boolean(process.env.RESEND_API_KEY?.trim()),
      resendFromEmail: Boolean(process.env.RESEND_FROM_EMAIL?.trim()),
      resendWebhookSecret: Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim()),
      siteUrl: Boolean(process.env.SITE_URL?.trim() || process.env.VITE_APP_URL?.trim()),
    };

    const admin = adminLoose() as AnalyticsRpcAdmin;
    const { data, error } = await admin.rpc("analytics_client_brain_funnel_counts", {
      p_days: 7,
    });

    if (error) {
      if (funnelCountsRpcMissing(error.message)) {
        return {
          windowDays: 7,
          counts: emptyFunnelCounts(),
          preflight,
          migrationHint: FUNNEL_COUNTS_HINT,
        };
      }
      throw new Error(error.message);
    }

    const bag = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    const rawCounts =
      bag.counts && typeof bag.counts === "object" && !Array.isArray(bag.counts)
        ? (bag.counts as Record<string, unknown>)
        : {};
    const counts = emptyFunnelCounts();
    for (const key of FUNNEL_EVENT_KEYS) {
      const n = Number(rawCounts[key] ?? 0);
      counts[key] = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }

    return {
      windowDays: Number(bag.window_days ?? 7) || 7,
      counts,
      preflight,
      migrationHint: null,
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
  stripe: {
    secretPresent: boolean;
    publishablePresent: boolean;
  };
  migrationHint: string | null;
};

export const getOwnerOpsDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { email } = await assertOpsConsoleAccess(context as AuthCtx);
    const admin = adminLoose();
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const y = now.getFullYear();
    const m = now.getMonth();

    const [rolesRes, firmsRes, clientsRes, payRes, settingsRes, leadRes, listed, itRes, profilesRes] =
      await Promise.all([
        admin.from("user_roles").select("user_id, role"),
        admin.from("firms").select("id, name, is_internal, owner_user_id"),
        admin.from("clients").select("id, name, is_demo, firm_id, owner_user_id"),
        admin.from("milon_ops_payments").select("*").order("paid_at", { ascending: false }).limit(100),
        admin.from("milon_ops_settings").select("key, value"),
        admin.from("milon_ops_leads").select("*").order("created_at", { ascending: false }).limit(50),
        admin.auth.admin.listUsers({ page: 1, perPage: 1000 }).catch(() => null),
        admin.from("milon_it_members").select("email"),
        admin.from("profiles").select("id, email, full_name"),
      ]);

    if (rolesRes.error) throw new Error(rolesRes.error.message);
    if (firmsRes.error) throw new Error(firmsRes.error.message);
    if (clientsRes.error) throw new Error(clientsRes.error.message);

    const internalEmails = mergeInternalEmails(
      ownerEmailAllowlist(),
      ((itRes.data ?? []) as Array<{ email?: string | null }>).map((row) => String(row.email ?? "")),
    );
    const ctx: ExclusionContext = { internalEmails };
    const emailByUser = new Map<string, string>();
    const nameByUser = new Map<string, string>();
    for (const profile of (profilesRes.data ?? []) as Array<{
      id: string;
      email: string | null;
      full_name: string | null;
    }>) {
      emailByUser.set(String(profile.id), String(profile.email ?? ""));
      nameByUser.set(String(profile.id), String(profile.full_name ?? ""));
    }

    const firmRows = ((firmsRes.error ? [] : firmsRes.data) ?? []) as Array<{
      id: string;
      name: string | null;
      is_internal?: boolean | null;
      owner_user_id?: string | null;
    }>;
    const firmSubjects = firmRows.map((firm) => ({
      id: String(firm.id),
      name: firm.name,
      isInternal: Boolean(firm.is_internal),
      ownerEmail: emailByUser.get(String(firm.owner_user_id ?? "")) ?? null,
    }));
    const excludedFirmIds = new Set(
      firmSubjects.filter((firm) => isExcludedFromInstrument(firm, ctx)).map((firm) => firm.id),
    );
    const clientRows = ((clientsRes.error ? [] : clientsRes.data) ?? []) as Array<{
      id: string;
      name: string | null;
      is_demo?: boolean | null;
      firm_id?: string | null;
      owner_user_id?: string | null;
    }>;
    const realClients = clientRows.filter(
      (client) =>
        !excludedFirmIds.has(String(client.firm_id ?? "")) &&
        !isExcludedFromInstrument(
          {
            name: client.name,
            isDemo: Boolean(client.is_demo),
            ownerEmail: emailByUser.get(String(client.owner_user_id ?? "")) ?? null,
          },
          ctx,
        ),
    );

    let accountants = 0;
    let businessOwners = 0;
    let clientMembers = 0;
    const roleUsers = new Set<string>();
    for (const role of (rolesRes.data ?? []) as Array<{ role: string; user_id?: string | null }>) {
      const uid = String(role.user_id ?? "");
      if (
        uid &&
        isExcludedFromInstrument({ name: nameByUser.get(uid), email: emailByUser.get(uid) }, ctx)
      ) {
        continue;
      }
      if (role.role === "firm_admin" || role.role === "accountant") accountants += 1;
      else if (role.role === "client_owner") businessOwners += 1;
      else if (role.role === "client_member") clientMembers += 1;
      if (uid) roleUsers.add(uid);
    }

    let totalUsers = roleUsers.size;
    let last7dUsersApprox: number | null = null;
    const listedUsers = (
      listed as {
        data?: {
          users?: Array<{
            created_at?: string;
            email?: string;
            user_metadata?: { full_name?: string };
          }>;
        };
      } | null
    )?.data?.users;
    if (listedUsers) {
      const visible = listedUsers.filter(
        (user) =>
          !isExcludedFromInstrument(
            { email: user.email, name: user.user_metadata?.full_name },
            ctx,
          ),
      );
      totalUsers = Math.max(totalUsers, visible.length);
      last7dUsersApprox = countRecentSignups(
        visible.map((user) => ({
          createdAt: user.created_at,
          email: user.email,
          name: user.user_metadata?.full_name,
        })),
        now.getTime(),
        ctx,
      );
    }

    const payments: OpsPaymentRow[] = [];
    let receivedThisMonthCents = 0;
    let pendingThisMonthCents = 0;
    let receivedYtdCents = 0;
    let allTimeReceivedCents = 0;
    let migrationHint: string | null = null;
    const payRows = payRes.data;
    const payErr = payRes.error;

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

    const settingsRows = settingsRes.error ? null : settingsRes.data;
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
    const leadRows = leadRes.error ? null : leadRes.data;
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
        firms: realFirmCount(firmSubjects, ctx),
        clients: realClients.length,
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
          "Placeholder for the outbound system — sequences, lead scoring, and an inbox.",
        phases: [
          { id: "crm", label: "Lead CRM + import", status: "next" },
          { id: "sequences", label: "AI email sequences (Resend)", status: "planned" },
          { id: "scoring", label: "Fit scoring (accountant vs owner)", status: "planned" },
          { id: "inbox", label: "Reply assist (email correspondence)", status: "planned" },
        ],
      },
      stripe: {
        secretPresent: stripeConfigured(),
        publishablePresent: stripePublishableConfigured(),
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
        firmId: z.string().uuid().optional(),
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
      firm_id: data.firmId ?? null,
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
