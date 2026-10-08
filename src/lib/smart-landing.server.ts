/**
 * Server half of /open. Uses the signed-in user's own Supabase client (RLS)
 * and the same entitlement rule as the firm billing gate.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getStripe, stripeConfigured } from "@/lib/stripe.server";
import {
  decideFirmBillingEntitlement,
  emailHasEntitlingSubscription,
} from "@/lib/stripe-entitlement";
import { decideSmartLanding, type SmartLanding } from "@/lib/smart-landing";

type UserDb = SupabaseClient<Database>;

function emailFromClaims(claims: unknown): string {
  if (!claims || typeof claims !== "object") return "";
  const email = (claims as { email?: unknown }).email;
  return typeof email === "string" ? email.trim() : "";
}

async function actorEmail(db: UserDb, claims: unknown): Promise<string> {
  const fromClaims = emailFromClaims(claims);
  if (fromClaims) return fromClaims;
  const { data } = await db.auth.getUser();
  return (data.user?.email ?? "").trim();
}

async function hasRow(
  db: UserDb,
  table: "firms" | "firm_memberships",
  column: "owner_user_id" | "user_id",
  userId: string,
): Promise<boolean> {
  const { data, error } = await db.from(table).select("id").eq(column, userId).limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

async function sessionEntitled(db: UserDb, userId: string, claims: unknown): Promise<boolean> {
  if (!stripeConfigured()) return true;
  try {
    const email = await actorEmail(db, claims);
    const [hasSub, ownsFirm, isFirmMember] = await Promise.all([
      email ? emailHasEntitlingSubscription(getStripe(), email) : Promise.resolve(false),
      hasRow(db, "firms", "owner_user_id", userId),
      hasRow(db, "firm_memberships", "user_id", userId),
    ]);
    return decideFirmBillingEntitlement({
      stripeConfigured: true,
      hasEntitlingSubscription: hasSub,
      ownsFirm,
      isFirmMember,
    }).entitled;
  } catch (err) {
    console.warn(
      "[smart-landing] entitlement check failed",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

async function firstFirmClientId(db: UserDb): Promise<string | null> {
  const { data, error } = await db
    .from("clients")
    .select("id")
    .not("firm_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) return null;
  const id = data?.[0]?.id;
  return typeof id === "string" && id ? id : null;
}

export async function resolveSmartLandingDecision(context: {
  supabase: UserDb;
  userId: string;
  claims?: unknown;
}): Promise<SmartLanding> {
  const [entitled, firstClientId] = await Promise.all([
    sessionEntitled(context.supabase, context.userId, context.claims),
    firstFirmClientId(context.supabase),
  ]);
  return decideSmartLanding({ signedIn: true, entitled, firstClientId });
}
