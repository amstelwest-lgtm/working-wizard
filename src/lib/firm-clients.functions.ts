/**
 * Firm practice helpers — create clients without fighting PostgREST INSERT RLS.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Create a practice-managed client under a firm.
 * Uses the service role so we bypass the known PostgREST INSERT WITH CHECK quirk
 * on `clients` (same reason owner signup uses ensure_own_client).
 */
export const createFirmClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().trim().min(1).max(200),
        firmId: z.string().uuid(),
        businessType: z.string().trim().max(120).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId as string;

    // Must own the firm or be a member.
    const { data: firm, error: firmErr } = await supabaseAdmin
      .from("firms")
      .select("id, owner_user_id")
      .eq("id", data.firmId)
      .maybeSingle();
    if (firmErr) throw new Error(firmErr.message);
    if (!firm) throw new Error("Firm not found");

    const isOwner = firm.owner_user_id === userId;
    if (!isOwner) {
      const { data: mem } = await supabaseAdmin
        .from("firm_memberships")
        .select("id")
        .eq("firm_id", data.firmId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!mem) throw new Error("You are not a member of this firm");
    }

    const { data: row, error } = await supabaseAdmin
      .from("clients")
      .insert({
        name: data.name,
        owner_user_id: userId,
        firm_id: data.firmId,
        business_type: data.businessType?.trim() || null,
      })
      .select("id, name, firm_id")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row) throw new Error("Client was not created");
    return row as { id: string; name: string; firm_id: string | null };
  });
