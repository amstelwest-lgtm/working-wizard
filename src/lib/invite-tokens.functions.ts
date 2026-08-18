/**
 * Opaque owner-invite tokens — mint from the firm dashboard.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const mintOwnerInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
      auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
    };

    const { data: token, error } = await sb.rpc("mint_owner_invite", {
      p_client_id: data.clientId,
    });

    if (!error && typeof token === "string" && token.length > 0) {
      return { token };
    }

    const msg = error?.message ?? "";
    const missingRpc = msg.includes("does not exist") || error?.code === "42883";
    if (!missingRpc && msg) {
      throw new Error(msg);
    }

    // Migration not applied yet — mint via service role after access check.
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { data: allowed, error: accessErr } = await supabaseAdmin.rpc("has_client_access", {
      _user_id: user.id,
      _client_id: data.clientId,
    });
    if (accessErr) throw new Error(accessErr.message);
    if (!allowed) throw new Error("No access to this client");

    const raw = crypto.getRandomValues(new Uint8Array(24));
    const tokenHex = Array.from(raw, (b) => b.toString(16).padStart(2, "0")).join("");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insErr } = await (supabaseAdmin as any).from("invite_tokens").insert({
      token: tokenHex,
      client_id: data.clientId,
      created_by: user.id,
      purpose: "owner_handoff",
    });
    if (insErr) {
      if ((insErr.message ?? "").includes("does not exist")) {
        throw new Error(
          "Invite tokens table missing — run migration 20260818120000_founder_pilot_roles_invites.sql in Supabase.",
        );
      }
      throw new Error(insErr.message);
    }
    return { token: tokenHex };
  });
