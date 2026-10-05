/**
 * Edge-function twin of assertStarterTrialAllowsNewWork.
 * Same clock and the same "expired Starter only" decision. Fails open when
 * the billing secret is unset, matching a local app server. A failed lookup
 * throws so the caller does not generate.
 */
import {
  bandFromSubscriptionSnapshot,
  pickEntitlingFirmSubscription,
  readSubscriptionPrice,
} from "../../../src/lib/firm-band-upgrade.ts";
import {
  STARTER_TRIAL_ENDED_MESSAGE,
  idleStarterTrialBanner,
  starterTrialClock,
  type StarterTrialBanner,
} from "../../../src/lib/firm-starter-trial.ts";
import { STARTER_TRIAL_ENDED_CODE } from "../../../src/lib/starter-trial-generation.ts";

export type PaidGenerationBlock = {
  code: typeof STARTER_TRIAL_ENDED_CODE;
  message: typeof STARTER_TRIAL_ENDED_MESSAGE;
};

type GateResult = {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
};

type GateDb = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<GateResult>;
      };
    };
  };
  auth?: {
    admin?: {
      getUserById: (id: string) => Promise<{
        data: { user: { email?: string | null } | null } | null;
      }>;
    };
  };
};

function billingSecret(override?: string | null): string {
  if (override != null) return override.trim();
  const deno = (globalThis as { Deno?: { env?: { get?: (name: string) => string | undefined } } })
    .Deno;
  const fromDeno = (name: string) => deno?.env?.get?.(name)?.trim() ?? "";
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const fromNode = (name: string) => proc?.env?.[name]?.trim() ?? "";
  return (
    fromDeno("STRIPE_SECRET_KEY") ||
    fromDeno("STRIPE_RESTRICTED_KEY") ||
    fromNode("STRIPE_SECRET_KEY") ||
    fromNode("STRIPE_RESTRICTED_KEY")
  );
}

function stringMetadata(metadata: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!metadata || typeof metadata !== "object") return out;
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function missingTrialColumn(message: string): boolean {
  return /starter_trial_enforced/i.test(message);
}

/** Map a Stripe subscription list into the same trial clock the app server uses. */
export function trialBannerFromStripeList(input: {
  enforced: boolean;
  subscriptions: unknown[];
  now?: Date;
}): StarterTrialBanner {
  if (!input.enforced) return idleStarterTrialBanner();
  const ranked = input.subscriptions.map((raw) => {
    const sub = (raw ?? {}) as Record<string, unknown> & {
      id?: string;
      status?: string;
      created?: number;
    };
    const price = readSubscriptionPrice(sub as Parameters<typeof readSubscriptionPrice>[0]);
    const metadata = stringMetadata(sub.metadata);
    return {
      raw: sub,
      id: String(sub.id ?? ""),
      status: String(sub.status ?? ""),
      created: typeof sub.created === "number" ? sub.created : 0,
      band: bandFromSubscriptionSnapshot({
        lookupKey: price.lookupKey,
        productBand: price.productBand,
        metadataPlan: metadata.milon_plan,
        downgradeBlocked: metadata.milon_downgrade_blocked,
      }),
    };
  });
  const hit = pickEntitlingFirmSubscription(ranked.filter((row) => row.id));
  if (!hit) return starterTrialClock({ enforced: true, band: null, now: input.now });
  const raw = hit.raw as {
    trial_end?: number | null;
    start_date?: number | null;
    created?: number | null;
  };
  const startedSeconds =
    typeof raw.start_date === "number"
      ? raw.start_date
      : typeof raw.created === "number"
        ? raw.created
        : hit.created;
  return starterTrialClock({
    enforced: true,
    band: hit.band,
    stripeTrialEnd: typeof raw.trial_end === "number" ? raw.trial_end : null,
    startedAt: startedSeconds > 0 ? startedSeconds : null,
    now: input.now,
  });
}

async function stripeGet(
  secret: string,
  path: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const res = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(json.error?.message || `Billing lookup failed (${res.status})`);
  }
  return json;
}

async function loadSubscriptions(
  secret: string,
  email: string,
  fetchImpl: typeof fetch,
): Promise<unknown[]> {
  const customers = (await stripeGet(
    secret,
    `customers?email=${encodeURIComponent(email)}&limit=1`,
    fetchImpl,
  )) as { data?: Array<{ id?: string }> };
  const customerId = customers.data?.[0]?.id;
  if (!customerId) return [];
  const listed = (await stripeGet(
    secret,
    `subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20&expand[]=data.items.data.price`,
    fetchImpl,
  )) as { data?: unknown[] };
  return listed.data ?? [];
}

async function billingEmail(
  db: GateDb,
  userId: string,
  email: string,
  ownerUserId: string | null,
): Promise<string> {
  const own = email.trim();
  if (!ownerUserId || ownerUserId === userId) return own;
  const lookup = db.auth?.admin?.getUserById;
  if (!lookup) return own;
  const { data } = await lookup(ownerUserId);
  return data?.user?.email?.trim() || own;
}

/**
 * Null when the firm may generate. A block when the enforced Starter trial
 * has ended. Throws when the billing lookup itself fails.
 */
export async function paidGenerationTrialBlock(input: {
  db: unknown;
  userId: string;
  email: string;
  clientId: string;
  now?: Date;
  /** Test override. Omit to read the process / Deno env. */
  stripeSecret?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<PaidGenerationBlock | null> {
  const db = input.db as GateDb;
  const client = await db.from("clients").select("firm_id").eq("id", input.clientId).maybeSingle();
  if (client.error) throw new Error(client.error.message);
  const firmId = client.data?.firm_id;
  if (typeof firmId !== "string" || !firmId) return null;

  const firm = await db
    .from("firms")
    .select("id, owner_user_id, starter_trial_enforced")
    .eq("id", firmId)
    .maybeSingle();
  if (firm.error) {
    if (missingTrialColumn(firm.error.message)) return null;
    throw new Error(firm.error.message);
  }
  if (firm.data?.starter_trial_enforced !== true) return null;

  const secret = billingSecret(input.stripeSecret);
  if (!secret) return null;

  const ownerUserId =
    typeof firm.data.owner_user_id === "string" ? firm.data.owner_user_id : null;
  const email = await billingEmail(db, input.userId, input.email, ownerUserId);
  if (!email) return null;

  const subscriptions = await loadSubscriptions(secret, email, input.fetchImpl ?? fetch);
  const trial = trialBannerFromStripeList({
    enforced: true,
    subscriptions,
    now: input.now,
  });
  if (!trial.expired) return null;
  return { code: STARTER_TRIAL_ENDED_CODE, message: STARTER_TRIAL_ENDED_MESSAGE };
}
