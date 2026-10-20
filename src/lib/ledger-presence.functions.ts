/**
 * Server action: does this client have a Xero, QuickBooks, or Sage row?
 * Browser selects against those tables see RLS with no policies, so an
 * authenticated SELECT returns 0 rows and no error. That must not run here.
 * Membership is checked first. The service role then reads id only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { decideLedgerPresence, type LedgerPresence } from "@/lib/ledger-presence";

const TABLES = {
  xero: "xero_connections",
  qbo: "qbo_connections",
  sage: "sage_connections",
} as const;

type Admin = {
  from: (table: string) => {
    select: (columns: "id" | "firm_id" | "owner_user_id" | "user_id") => {
      eq: (
        column: string,
        value: string,
      ) => {
        eq: (
          column: string,
          value: string,
        ) => {
          limit: (n: number) => Promise<{ data: Array<{ user_id?: string }> | null; error: { message: string } | null }>;
        };
        maybeSingle: () => Promise<{
          data: { firm_id?: string | null; owner_user_id?: string | null } | null;
          error: { message: string } | null;
        }>;
        limit: (n: number) => Promise<{ data: Array<{ id?: string }> | null; error: { message: string } | null }>;
      };
    };
  };
};

async function memberOfClientFirm(admin: Admin, userId: string, clientId: string): Promise<boolean | null> {
  const { data: client, error: clientErr } = await admin
    .from("clients")
    .select("firm_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) return null;
  const firmId = client?.firm_id ?? null;
  if (!firmId) return false;
  const [firmRes, memRes] = await Promise.all([
    admin.from("firms").select("owner_user_id").eq("id", firmId).maybeSingle(),
    admin.from("firm_memberships").select("user_id").eq("firm_id", firmId).eq("user_id", userId).limit(1),
  ]);
  if (firmRes.error || memRes.error) return null;
  if (firmRes.data?.owner_user_id === userId) return true;
  return (memRes.data?.length ?? 0) > 0;
}

async function idCount(admin: Admin, table: (typeof TABLES)[keyof typeof TABLES], clientId: string): Promise<number | null> {
  const { data, error } = await admin.from(table).select("id").eq("client_id", clientId).limit(1);
  if (error) return null;
  return data?.length ?? 0;
}

function deny(status: 401 | 403 | 503): never {
  const message = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Unavailable";
  throw new Response(message, { status });
}

export const getLedgerConnectionPresence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<LedgerPresence> => {
    const userId = context.userId;
    if (!userId) deny(401);
    const admin = getSupabaseAdminOrNull() as Admin | null;
    if (!admin) deny(503);
    const member = await memberOfClientFirm(admin, userId, data.clientId);
    if (member === null) deny(503);
    if (!member) deny(403);
    const [xero, qbo, sage] = await Promise.all([
      idCount(admin, TABLES.xero, data.clientId),
      idCount(admin, TABLES.qbo, data.clientId),
      idCount(admin, TABLES.sage, data.clientId),
    ]);
    if (xero == null || qbo == null || sage == null) deny(503);
    const decision = decideLedgerPresence({
      userId,
      member: true,
      counts: { xero, qbo, sage },
    });
    if (decision.status !== 200 || !decision.body) deny(decision.status === 200 ? 503 : decision.status);
    return decision.body;
  });
