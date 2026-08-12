/**
 * Firm practice helpers — create clients without fighting PostgREST INSERT RLS.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Create a practice-managed client under a firm.
 * Uses create_firm_client() SECURITY DEFINER RPC (no service-role key required).
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
    const sb = context.supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
    };

    const { data: clientId, error } = await sb.rpc("create_firm_client", {
      p_name: data.name,
      p_firm_id: data.firmId,
      p_business_type: data.businessType ?? null,
    });

    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("does not exist") || error.code === "42883") {
        throw new Error(
          "Add-client RPC missing — run migration 20260812170000_create_firm_client_rpc.sql in Supabase.",
        );
      }
      throw new Error(msg);
    }
    if (!clientId || typeof clientId !== "string") {
      throw new Error("Client was not created");
    }
    return { id: clientId, name: data.name, firm_id: data.firmId };
  });
