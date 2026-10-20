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
import { callerMayReadLedger, decideLedgerPresence, type LedgerPresence } from "@/lib/ledger-presence";

const TABLES = {
  xero: "xero_connections",
  qbo: "qbo_connections",
  sage: "sage_connections",
} as const;

/** Service role: connection-table id only. Membership never uses this client. */
type Admin = {
  from: (table: string) => {
    select: (columns: "id") => {
      eq: (
        column: string,
        value: string,
      ) => {
        limit: (n: number) => Promise<{ data: Array<{ id?: string }> | null; error: { message: string } | null }>;
      };
    };
  };
};

type UserRow = {
  firm_id?: string | null;
  owner_user_id?: string | null;
  user_id?: string | null;
  client_id?: string | null;
};

type UserRead = {
  eq: (column: string, value: string) => UserRead;
  maybeSingle: () => Promise<{ data: UserRow | null; error: { message: string } | null }>;
  limit: (n: number) => Promise<{ data: UserRow[] | null; error: { message: string } | null }>;
};

/** The signed-in user's client. RLS applies; this is not the service role. */
type UserDb = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => UserRead;
    };
  };
};

async function callerMayReadClient(db: UserDb, userId: string, clientId: string): Promise<boolean | null> {
  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("firm_id, owner_user_id")
    .eq("id", clientId)
    .maybeSingle();
  const { data: door, error: doorErr } = await db
    .from("client_memberships")
    .select("client_id")
    .eq("client_id", clientId)
    .eq("user_id", userId)
    .limit(1);
  const firmId = client?.firm_id ?? null;
  const [firmRes, staffRes] = firmId
    ? await Promise.all([
        db.from("firms").select("owner_user_id").eq("id", firmId).maybeSingle(),
        db.from("firm_memberships").select("user_id").eq("firm_id", firmId).eq("user_id", userId).limit(1),
      ])
    : [null, null];
  return callerMayReadLedger({
    userId,
    client,
    clientError: Boolean(clientErr),
    clientMembership: doorErr ? null : (door?.length ?? 0) > 0,
    firmOwnerUserId: firmRes?.data?.owner_user_id ?? null,
    firmError: Boolean(firmRes?.error),
    firmStaff: staffRes ? (staffRes.error ? null : (staffRes.data?.length ?? 0) > 0) : false,
  });
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
    const member = await callerMayReadClient(context.supabase as unknown as UserDb, userId, data.clientId);
    if (member === null) deny(503);
    if (!member) deny(403);
    const admin = getSupabaseAdminOrNull() as Admin | null;
    if (!admin) deny(503);
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
