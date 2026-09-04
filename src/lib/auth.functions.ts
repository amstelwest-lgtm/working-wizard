import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { signUpInvitedMember } from "@/lib/invite-member.server";
import { US_STATE_CODES } from "@/lib/market/types";
import { assertMarketSelection, isMissingMarketSupport, marketToJson } from "@/lib/market";

/**
 * Admin signup — creates the user with email_confirm: true so no
 * confirmation email is required. Safe to use in development and for
 * invited users where the email address is already trusted.
 *
 * For the invite path this delegates entirely to signUpInvitedMember()
 * so there is a single canonical implementation (including G25 ownership handoff).
 */
export const adminSignUp = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(6),
        fullName: z.string().optional(),
        businessName: z.string().optional(),
        inviteClientId: z.string().min(8).max(80).optional(),
        inviteClientCode: z.string().trim().max(32).optional().nullable(),
        signupType: z.enum(["customer", "accountant"]).default("customer"),
        firmName: z.string().optional(),
        marketCountry: z.enum(["ZA", "US"]).optional(),
        marketRegion: z.enum(US_STATE_CODES).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // ── Invited member: delegate to the shared utility ──────────────────────
    // signUpInvitedMember() is the single source of truth for this path.
    // It creates the auth user AND writes client_memberships + user_roles.
    // The integration test (scripts/test-invited-member-flow.mts) imports and
    // calls this same function directly, so any regression here is caught.
    if (data.signupType === "customer" && data.inviteClientId) {
      const result = await signUpInvitedMember({
        email: data.email,
        password: data.password,
        fullName: data.fullName,
        inviteClientId: data.inviteClientId,
        inviteClientCode: data.inviteClientCode,
      });
      return result;
    }

    // ── All other paths: create the user first ──────────────────────────────
    const { data: authData, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.fullName?.trim() ?? "",
        business_name: data.businessName?.trim() ?? data.fullName?.trim() ?? "",
        signup_type: data.signupType,
        invite_client_id: null,
      },
    });

    if (error) throw new Error(error.message);
    if (!authData.user) throw new Error("User creation failed");

    const userId = authData.user.id;
    let marketJson: { country: "ZA" | "US"; regionCode: string | null } | null = null;
    if (data.marketCountry) {
      marketJson = marketToJson(
        assertMarketSelection({
          country: data.marketCountry,
          regionCode: data.marketCountry === "US" ? (data.marketRegion ?? null) : null,
        }),
      );
    }

    if (data.signupType === "accountant") {
      if (data.firmName?.trim()) {
        let { data: firm, error: fErr } = await supabaseAdmin
          .from("firms")
          .insert({
            name: data.firmName.trim(),
            owner_user_id: userId,
            ...(marketJson ? { market: marketJson } : {}),
          })
          .select("id")
          .single();
        if (fErr && marketJson && isMissingMarketSupport(fErr)) {
          const retry = await supabaseAdmin
            .from("firms")
            .insert({ name: data.firmName.trim(), owner_user_id: userId })
            .select("id")
            .single();
          firm = retry.data;
          fErr = retry.error;
        }
        if (fErr) console.error("[adminSignUp] firm insert:", fErr.message);
        if (firm) {
          await supabaseAdmin
            .from("firm_memberships")
            .insert({ firm_id: firm.id, user_id: userId, role: "owner" });
        }
      }
      await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "firm_admin" });
    } else {
      // Primary owner self-signup (no inviteClientId) — create the client record.
      const { data: existing } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("owner_user_id", userId)
        .limit(1)
        .maybeSingle();
      if (!existing) {
        const baseRow = {
          name: data.businessName?.trim() || data.fullName?.trim() || data.email,
          owner_user_id: userId,
        };
        const withMarket = marketJson
          ? {
              ...baseRow,
              market: marketJson,
              financial_year_start_month: marketJson.country === "US" ? 1 : 3,
            }
          : baseRow;
        const { error: cErr } = await supabaseAdmin.from("clients").insert(withMarket);
        if (cErr && marketJson && isMissingMarketSupport(cErr)) {
          await supabaseAdmin.from("clients").insert(baseRow);
        }
      }
      // Keep any existing practice role (dual-role founders). Only ensure client_owner.
      const { data: existingRoles } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      const roles = (existingRoles ?? []).map((r) => r.role);
      if (!roles.includes("client_owner")) {
        await supabaseAdmin.from("user_roles").insert({ user_id: userId, role: "client_owner" });
      }
    }

    return { userId, email: authData.user.email ?? data.email };
  });

/**
 * Accountant-portal entry: if this user owns or belongs to a firm, ensure
 * firm_admin is present WITHOUT wiping client_owner (dual-role founders).
 */
export const ensurePracticePortalAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId;
    const { data: existingRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const roles = (existingRoles ?? []).map((r) => r.role as string);
    const hasClient = roles.includes("client_owner") || roles.includes("client_member");
    const hasPractice = roles.includes("firm_admin") || roles.includes("accountant");
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    const meta = (authUser.user?.user_metadata ?? {}) as Record<string, unknown>;
    const practiceSignup =
      meta.signup_type === "accountant" ||
      (typeof meta.firm_name === "string" && meta.firm_name.trim().length > 0);
    if (hasPractice) {
      return { ensured: true as const, reason: "already" as const };
    }
    if (hasClient && !practiceSignup) {
      return { ensured: false as const, reason: "sme_only" as const };
    }
    const { data: owned } = await supabaseAdmin
      .from("firms")
      .select("id")
      .eq("owner_user_id", userId)
      .limit(1)
      .maybeSingle();
    const { data: mem } = await supabaseAdmin
      .from("firm_memberships")
      .select("firm_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (!owned && !mem) {
      return { ensured: false as const, reason: "no_firm" as const };
    }
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "firm_admin" });
    if (error && !/duplicate|unique/i.test(error.message)) {
      throw new Error(error.message);
    }
    return { ensured: true as const, reason: "inserted" as const };
  });
