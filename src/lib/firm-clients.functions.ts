/**
 * Firm practice helpers — create clients without fighting PostgREST INSERT RLS.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
};

function missingRpc(error: { message?: string; code?: string } | null): boolean {
  const msg = error?.message ?? "";
  return msg.includes("does not exist") || error?.code === "42883";
}

/**
 * Create a practice-managed client under a firm.
 * Uses create_firm_client() SECURITY DEFINER RPC (no service-role key required).
 * firmId is optional — the RPC provisions a practice firm when missing.
 */
export const createFirmClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().trim().min(1).max(200),
        firmId: z.string().uuid().optional().nullable(),
        businessType: z.string().trim().max(120).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as RpcClient;

    const { data: raw, error } = await sb.rpc("create_firm_client", {
      p_name: data.name,
      p_firm_id: data.firmId ?? null,
      p_business_type: data.businessType ?? null,
    });

    if (error) {
      if (missingRpc(error)) {
        throw new Error(
          "Add-client RPC missing — run migration 20260824120000_client_code_ensure_firm.sql in Supabase.",
        );
      }
      throw new Error(error.message);
    }

    // New RPC returns jsonb { id, client_code, firm_id, name }.
    // Older uuid-only RPC is still accepted until the migration runs.
    if (typeof raw === "string") {
      return { id: raw, name: data.name, firm_id: data.firmId ?? null, client_code: null as string | null };
    }
    const row = (raw ?? {}) as {
      id?: string;
      client_code?: string;
      firm_id?: string;
      name?: string;
    };
    if (!row.id) throw new Error("Client was not created");
    return {
      id: row.id,
      name: row.name ?? data.name,
      firm_id: row.firm_id ?? data.firmId ?? null,
      client_code: row.client_code ?? null,
    };
  });

/** Create (or return) the caller's practice firm so Add client is never blocked. */
export const ensurePracticeFirm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ name: z.string().trim().max(200).optional().nullable() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as unknown as RpcClient;
    const { data: firmId, error } = await sb.rpc("ensure_practice_firm", {
      p_name: data.name ?? null,
    });
    if (error) {
      if (missingRpc(error)) {
        throw new Error(
          "Practice-firm RPC missing — run migration 20260824120000_client_code_ensure_firm.sql in Supabase.",
        );
      }
      throw new Error(error.message);
    }
    if (!firmId || typeof firmId !== "string") {
      throw new Error("Could not create a practice firm");
    }
    return { firmId };
  });
