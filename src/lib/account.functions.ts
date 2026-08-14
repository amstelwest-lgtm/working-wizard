/**
 * Account lifecycle — self-service delete for SME owners and accountants.
 * Prefers the delete_own_account() SECURITY DEFINER RPC (no service-role needed).
 * Falls back to service-role cleanup when the RPC is missing and admin is configured.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";

type LooseSb = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  from: (t: string) => {
    delete: () => {
      eq: (
        c: string,
        v: string,
      ) => Promise<{ error: { message: string } | null }>;
    };
    update: (v: Record<string, unknown>) => {
      eq: (
        c: string,
        v: string,
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
  auth: {
    admin: {
      deleteUser: (id: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};

async function adminFallbackDelete(userId: string): Promise<void> {
  const admin = getSupabaseAdminOrNull() as LooseSb | null;
  if (!admin) {
    throw new Error(
      "Account deletion is not available yet — run migration 20260814160000_delete_own_account.sql in Supabase.",
    );
  }

  const deleteBy = async (table: string, col: string) => {
    try {
      await admin.from(table).delete().eq(col, userId);
    } catch {
      /* table may not exist */
    }
  };
  const nullify = async (table: string, col: string) => {
    try {
      await admin.from(table).update({ [col]: null }).eq(col, userId);
    } catch {
      /* table may not exist */
    }
  };

  await deleteBy("client_note_replies", "author_id");
  await deleteBy("client_notes", "author_id");
  await deleteBy("client_review_signoff_history", "signed_off_by_id");
  await deleteBy("client_review_signoffs", "signed_off_by_id");
  await deleteBy("advisory_deliveries", "created_by");
  await nullify("financial_submissions", "reviewed_by");
  await nullify("financial_submissions", "submitted_by");
  await nullify("budget_month_actuals", "confirmed_by");

  await deleteBy("clients", "owner_user_id");
  await deleteBy("firm_memberships", "user_id");
  await deleteBy("firms", "owner_user_id");
  await deleteBy("client_memberships", "user_id");
  await deleteBy("user_roles", "user_id");
  await deleteBy("profiles", "id");

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
}

/**
 * Permanently delete the signed-in user's account and owned client/firm data.
 */
export const deleteOwnAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.userId as string;
    const userSb = context.supabase as unknown as LooseSb;

    const { error } = await userSb.rpc("delete_own_account");
    if (!error) return { ok: true as const };

    const msg = error.message ?? "";
    if (!/does not exist|42883|function .*delete_own_account/i.test(msg)) {
      throw new Error(msg);
    }

    await adminFallbackDelete(userId);
    return { ok: true as const };
  });
