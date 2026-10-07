import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertClientScope } from "@/lib/assert-client-scope";
import { getSupabaseAdminOrNull, supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptSagePassword } from "@/lib/sage-password";
import {
  sageConnectionInsert,
  sageCredentialsConfigured,
  sageSyncWriteDecision,
  sageValidateError,
  validateSageLogin,
  SAGE_EMPTY_SYNC_MESSAGE,
} from "@/lib/sage";

const connectInput = z.object({
  clientId: z.string().uuid(),
  username: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
  companyId: z.string().trim().regex(/^\d{1,18}$/),
});

export const getSageConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    return { configured: sageCredentialsConfigured() };
  });

export type SageStatus = {
  username: string;
  companyId: string;
  companyName: string | null;
  connectedAt: string;
  lastSyncedAt: string | null;
  syncStatus: string;
  syncError: string | null;
  /** True only after Eng1 writes a dated Sage statement. Connect never sets this. */
  figuresFromThisSync: boolean;
} | null;

export const getSageStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SageStatus> => {
    assertClientScope(context.actingAsClientId, data.clientId);
    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    const admin = getSupabaseAdminOrNull();
    if (!admin) return null;

    const { data: conn } = await admin
      .from("sage_connections")
      .select(
        "username, company_id, company_name, connected_at, last_synced_at, sync_status, sync_error",
      )
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (!conn) return null;

    const { data: clientRow } = await admin
      .from("clients")
      .select("financials")
      .eq("id", data.clientId)
      .maybeSingle();
    const financials = (clientRow as { financials?: unknown } | null)?.financials;
    const source =
      financials && typeof financials === "object" && !Array.isArray(financials)
        ? (financials as { statementSource?: unknown }).statementSource
        : null;

    return {
      username: conn.username,
      companyId: conn.company_id,
      companyName: conn.company_name ?? null,
      connectedAt: conn.connected_at ?? "",
      lastSyncedAt: conn.last_synced_at ?? null,
      syncStatus: conn.sync_status ?? "idle",
      syncError: conn.sync_error ?? null,
      figuresFromThisSync: source === "sage" && Boolean(conn.last_synced_at),
    };
  });

export const getSageStatuses = createServerFn({ method: "POST" })
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
    const allowed = new Set((visible ?? []).map((c: { id: string }) => c.id));
    const scoped = data.clientIds.filter((id) => allowed.has(id));
    if (scoped.length === 0) return {};

    const { data: rows } = await admin
      .from("sage_connections")
      .select("client_id, company_name, last_synced_at, sync_status")
      .in("client_id", scoped);

    const out: Record<
      string,
      { companyName: string | null; lastSyncedAt: string | null; syncStatus: string }
    > = {};
    for (const row of rows ?? []) {
      out[row.client_id] = {
        companyName: row.company_name ?? null,
        lastSyncedAt: row.last_synced_at ?? null,
        syncStatus: row.sync_status ?? "idle",
      };
    }
    return out;
  });

export const connectSage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => connectInput.parse(input))
  .handler(async ({ data, context }) => {
    assertClientScope(context.actingAsClientId, data.clientId);
    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");
    if (!sageCredentialsConfigured()) {
      throw new Error(sageValidateError("not_configured"));
    }

    const validated = await validateSageLogin({
      username: data.username.trim(),
      password: data.password,
      companyId: data.companyId,
      apiKey: process.env.SAGE_SA_API_KEY?.trim() ?? "",
    });
    if (!validated.ok) throw new Error(sageValidateError(validated.reason));

    const passwordEnc = encryptSagePassword(data.password);
    const row = sageConnectionInsert({
      clientId: data.clientId,
      username: data.username.trim(),
      passwordEnc,
      company: validated.company,
      connectedAt: new Date().toISOString(),
    });

    const { error } = await supabaseAdmin.from("sage_connections").upsert(row, {
      onConflict: "client_id",
    });
    if (error) throw new Error("Could not store the Sage connection.");

    return {
      companyId: validated.company.companyId,
      companyName: validated.company.companyName,
      username: row.username,
    };
  });

export const disconnectSage = createServerFn({ method: "POST" })
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

    await supabaseAdmin.from("sage_connections").delete().eq("client_id", data.clientId);
    await supabaseAdmin.from("sage_sync_data").delete().eq("client_id", data.clientId);
    return { success: true };
  });

export type SageSyncStubResult = {
  /** False until Eng1 maps a real statement. The card must not paint Health. */
  populated: boolean;
  fields: Record<string, string>;
  message: string;
};

/**
 * Sync entry after connect.
 *
 * TODO(Eng1): map the Sage SA profit and loss and balance sheet into `fields`,
 * then keep sageSyncWriteDecision in front of any write to the client book.
 * Deliverable auto-populate stays on the owner board and the accountant studio,
 * and only after that write says the figures are real.
 * A connection with no statement must not invent health or ratios.
 */
export const triggerSageSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SageSyncStubResult> => {
    assertClientScope(context.actingAsClientId, data.clientId);
    const { data: client } = await context.supabase
      .from("clients")
      .select("id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client) throw new Error("Client not found");

    const admin = getSupabaseAdminOrNull();
    if (!admin) throw new Error("Sage sync is not available.");

    const { data: conn } = await admin
      .from("sage_connections")
      .select("client_id")
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (!conn) throw new Error("Connect Sage before syncing.");

    const fields: Record<string, string> = {};
    const decision = sageSyncWriteDecision(fields, null);
    if (!decision.write) {
      return { populated: false, fields, message: SAGE_EMPTY_SYNC_MESSAGE };
    }

    // Unreachable until Eng1 supplies non-empty figures. Do not write the book here.
    throw new Error("Sage statement populate is not implemented.");
  });
