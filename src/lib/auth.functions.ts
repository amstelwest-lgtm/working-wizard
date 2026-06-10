import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Admin signup — creates the user with email_confirm: true so no
 * confirmation email is required. Safe to use in development and for
 * invited users where the email address is already trusted.
 */
export const adminSignUp = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(6),
        fullName: z.string().optional(),
        businessName: z.string().optional(),
        inviteClientId: z.string().uuid().optional(),
        signupType: z.enum(["customer", "accountant"]).default("customer"),
        firmName: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: authData, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.fullName?.trim() ?? "",
        business_name: data.businessName?.trim() ?? data.fullName?.trim() ?? "",
        signup_type: data.signupType,
        invite_client_id: data.inviteClientId ?? null,
      },
    });

    if (error) throw new Error(error.message);
    if (!authData.user) throw new Error("User creation failed");

    const userId = authData.user.id;

    if (data.signupType === "accountant") {
      if (data.firmName?.trim()) {
        const { data: firm, error: fErr } = await supabaseAdmin
          .from("firms")
          .insert({ name: data.firmName.trim(), owner_user_id: userId })
          .select("id")
          .single();
        if (fErr) console.error("[adminSignUp] firm insert:", fErr.message);
        if (firm) {
          await supabaseAdmin
            .from("firm_memberships")
            .insert({ firm_id: firm.id, user_id: userId, role: "owner" });
        }
      }
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: "firm_admin" });
    } else {
      if (data.inviteClientId) {
        await supabaseAdmin.from("client_memberships").upsert(
          { client_id: data.inviteClientId, user_id: userId, role: "client" },
          { onConflict: "client_id,user_id" },
        );
      } else {
        const { data: existing } = await supabaseAdmin
          .from("clients")
          .select("id")
          .eq("owner_user_id", userId)
          .limit(1)
          .maybeSingle();
        if (!existing) {
          await supabaseAdmin.from("clients").insert({
            name:
              data.businessName?.trim() ||
              data.fullName?.trim() ||
              data.email,
            owner_user_id: userId,
          });
        }
      }
    }

    return { userId, email: authData.user.email ?? data.email };
  });
