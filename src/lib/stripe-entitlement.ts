/**
 * Firm-product Stripe entitlement.
 * The live subscription is found by the stored Stripe customer id
 * (`firms.stripe_customer_id`). With no stored id, email is tried first.
 * Metadata search (subscription, then customer) runs only when that email
 * misses, for at most FIRM_CUSTOMER_SEARCH_BUDGET_MS, with no Stripe retry.
 * A stored id still beats a different email customer. A mismatch is logged
 * and is not awaited. This module does not update Stripe and does not
 * create a customer. Stripe Dashboard is source of truth until a webhook
 * writes a local row.
 *
 * Owner Spark and invited firm staff (non-owners) are not billed on their
 * own email. The firm owner must complete Checkout. A trialing subscription
 * (14-day card-on-file trial) entitles the firm product. When the trial ends
 * unpaid or canceled, status is no longer active/trialing and the
 * billing/required resume path applies.
 *
 * An active $0 Starter subscription (no Stripe trial_end) also entitles the
 * product, so an expired Starter keeps read access. The 14-day work gate
 * (no new clients, packs, or deliverables) is starterTrialClock plus
 * firms.starter_trial_enforced, not this status check.
 */

import { isPreInsightWorkspacePath, routePathname } from "@/lib/funnel-timing";
import { isOwnerCatalogPrice } from "@/lib/owner-price";

export const ENTITLING_SUBSCRIPTION_STATUSES = ["active", "trialing"] as const;
export type EntitlingSubscriptionStatus = (typeof ENTITLING_SUBSCRIPTION_STATUSES)[number];

export type FirmBillingReason =
  | "active_subscription"
  | "firm_member"
  | "stripe_unconfigured"
  | "no_active_subscription"
  | "stripe_error";

export type FirmBillingEntitlement = {
  entitled: boolean;
  reason: FirmBillingReason;
  /**
   * False when Stripe history already has a subscription, so a second
   * intro trial does not apply. Omitted when that history was not read.
   */
  introTrialEligible?: boolean;
  /**
   * Set when the live Stripe read failed and `entitled` is the last
   * success, or unknown (`stripe_error`) when this isolate has none.
   */
  checkFailed?: "timeout" | "network" | "http_5xx";
};

export type FirmBillingPathDecision = "allow" | "require_billing";

/**
 * One shared cap for both metadata searches. Stripe's client retry is
 * turned off for these calls so a hang cannot become two 8s attempts.
 */
export const FIRM_CUSTOMER_SEARCH_BUDGET_MS = 4_000;

export type FirmCustomerSearchOptions = {
  maxNetworkRetries?: number;
  timeout?: number;
};

/** Stripe-like subset used by tests — no secret key, no SDK import. */
export type StripeCustomerSubscriptionReader = {
  customers: {
    list: (params: { email: string; limit: number }) => Promise<{ data: Array<{ id: string }> }>;
    retrieve?: (id: string) => Promise<unknown>;
    search?: (
      params: { query: string; limit: number },
      options?: FirmCustomerSearchOptions,
    ) => Promise<{
      data: Array<unknown>;
    }>;
  };
  subscriptions: {
    list: (params: {
      customer: string;
      status: string;
      limit: number;
      expand?: string[];
    }) => Promise<{
      data: Array<{
        id: string;
        status?: string;
        metadata?: {
          milon_plan?: string | null;
          milon_lookup_key?: string | null;
          milon_user_id?: string | null;
          firm_id?: string | null;
        } | null;
        items?: {
          data?: Array<{
            price?:
              | string
              | {
                  lookup_key?: string | null;
                  product?:
                    | string
                    | { metadata?: { plan?: string | null; band?: string | null } | null }
                    | null;
                }
              | null;
          }>;
        } | null;
      }>;
    }>;
    search?: (
      params: { query: string; limit: number },
      options?: FirmCustomerSearchOptions,
    ) => Promise<{
      data: Array<{
        id: string;
        status?: string;
        customer?: string | { id?: string | null } | null;
        metadata?: {
          milon_plan?: string | null;
          milon_lookup_key?: string | null;
          milon_user_id?: string | null;
          firm_id?: string | null;
        } | null;
        items?: {
          data?: Array<{
            price?:
              | string
              | {
                  lookup_key?: string | null;
                  product?:
                    | string
                    | { metadata?: { plan?: string | null; band?: string | null } | null }
                    | null;
                }
              | null;
          }>;
        } | null;
      }>;
    }>;
  };
};

export function subscriptionStatusEntitles(
  status: string | null | undefined,
): status is EntitlingSubscriptionStatus {
  return status === "active" || status === "trialing";
}

/**
 * Checkout success. A trial session completes with no_payment_required
 * because the first invoice is $0; the card is still collected.
 */
export function checkoutSessionUnlocksFirm(session: {
  status?: string | null;
  paymentStatus?: string | null;
}): boolean {
  if (session.status === "complete") return true;
  if (session.paymentStatus === "paid") return true;
  if (session.paymentStatus === "no_payment_required") return true;
  return false;
}

export function isBillingExemptPath(pathname: string): boolean {
  return pathname === "/billing" || pathname.startsWith("/billing/");
}

export function isOwnerSparkPath(pathname: string): boolean {
  return pathname === "/app" || pathname.startsWith("/app/");
}

export function isOpsPath(pathname: string): boolean {
  return pathname === "/ops" || pathname.startsWith("/ops/");
}

/**
 * Accountant / firm product UI — gated until the firm owner has an
 * entitling Stripe subscription. Shared `/settings`, `/settings/brand`,
 * and `/settings/team` stay open so a firm can set the logo, the team,
 * and client access before a card, and so owners can still use Spark
 * settings and Customer Portal.
 */
export function isFirmProductPath(pathname: string): boolean {
  return (
    pathname === "/dashboard" ||
    pathname.startsWith("/dashboard/") ||
    pathname === "/practice" ||
    pathname.startsWith("/practice/") ||
    pathname.startsWith("/clients") ||
    pathname.startsWith("/reports")
  );
}

/** Team settings stay open on the same terms as the dashboard. */
export function isTeamSettingsPath(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return path === "/settings/team";
}

/** Home, the client list, and the practice overview. Not a client file. */
export function isPracticeShellPath(pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return path === "/dashboard" || path === "/practice" || path === "/clients";
}

/** `/clients/:id` — Overview and the scored figures live on this file. */
export function clientIdFromFirmPath(pathname: string): string | null {
  const match = pathname.match(/^\/clients\/([^/]+)\/?$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/**
 * The first client's file stays readable without a card.
 * `firmClientCount` null means the count failed to load — do not wall the file.
 * Two or more clients: only the earliest file stays open. A later file does not.
 */
export function isFirstClientFiguresPath(input: {
  pathname: string;
  firmClientCount: number | null;
  firstClientId?: string | null;
}): boolean {
  const id = clientIdFromFirmPath(input.pathname);
  if (!id) return false;
  if (input.firmClientCount === null || input.firmClientCount <= 1) return true;
  const first = input.firstClientId?.trim() ?? "";
  return first.length > 0 && id === first;
}

function subscriptionIsOwnerPlan(sub: {
  metadata?: { milon_plan?: string | null; milon_lookup_key?: string | null } | null;
  items?: {
    data?: Array<{
      price?:
        | string
        | {
            lookup_key?: string | null;
            product?:
              | string
              | { metadata?: { plan?: string | null } | null }
              | null;
          }
        | null;
    }>;
  } | null;
}): boolean {
  const metaPlan = sub.metadata?.milon_plan ?? "";
  if (metaPlan.trim().toLowerCase() === "owner") return true;
  const price = sub.items?.data?.[0]?.price;
  let lookupKey = sub.metadata?.milon_lookup_key ?? null;
  let productPlan: string | null = null;
  if (price && typeof price === "object") {
    lookupKey = lookupKey || price.lookup_key || null;
    const product = price.product;
    if (product && typeof product === "object") {
      const plan = product.metadata?.plan;
      productPlan = typeof plan === "string" ? plan : null;
    }
  }
  return isOwnerCatalogPrice({ lookupKey, productPlan });
}

export async function customerHasEntitlingSubscription(
  stripe: StripeCustomerSubscriptionReader,
  customerId: string,
): Promise<boolean> {
  for (const status of ENTITLING_SUBSCRIPTION_STATUSES) {
    const listed = await stripe.subscriptions.list({
      customer: customerId,
      status,
      limit: 20,
      expand: ["data.items.data.price"],
    });
    if (listed.data.some((sub) => !subscriptionIsOwnerPlan(sub))) return true;
  }
  return false;
}

export async function findCustomerIdByEmail(
  stripe: StripeCustomerSubscriptionReader,
  email: string,
): Promise<string | undefined> {
  const trimmed = email.trim();
  if (!trimmed) return undefined;
  const listed = await stripe.customers.list({ email: trimmed, limit: 1 });
  return listed.data[0]?.id;
}

/** Stripe metadata values we will interpolate into a search query. */
const STRIPE_METADATA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FirmCustomerLookup = {
  email?: string | null;
  /** Owner user id, stored on Checkout as metadata milon_user_id. */
  userId?: string | null;
  /** Firm id, stored on Checkout as metadata firm_id when the firm already exists. */
  firmId?: string | null;
  /** firms.stripe_customer_id, or owner_subscriptions.stripe_customer_id for Spark. */
  storedCustomerId?: string | null;
  /** Owner Checkout prefers the Spark subscription when both share milon_user_id. */
  preferOwnerPlan?: boolean;
};

/**
 * Search query for the firm's Stripe subscription. Email is not part of it.
 * Returns null when neither id is a uuid, so a bad value cannot be interpolated.
 */
export function firmCustomerSearchQuery(input: FirmCustomerLookup): string | null {
  const parts: string[] = [];
  const firmId = input.firmId?.trim() ?? "";
  const userId = input.userId?.trim() ?? "";
  if (STRIPE_METADATA_ID.test(firmId)) parts.push(`metadata['firm_id']:'${firmId}'`);
  if (STRIPE_METADATA_ID.test(userId)) parts.push(`metadata['milon_user_id']:'${userId}'`);
  if (!parts.length) return null;
  return parts.join(" OR ");
}

function stripeCustomerId(customer: unknown): string | undefined {
  if (typeof customer === "string" && customer.startsWith("cus_")) return customer;
  if (customer && typeof customer === "object" && "id" in customer) {
    const id = (customer as { id?: unknown }).id;
    if (typeof id === "string" && id.startsWith("cus_")) return id;
  }
  return undefined;
}

type MetadataSubscription = {
  status?: string;
  customer?: string | { id?: string | null } | null;
  metadata?: {
    milon_plan?: string | null;
    milon_lookup_key?: string | null;
    milon_user_id?: string | null;
    firm_id?: string | null;
  } | null;
  items?: {
    data?: Array<{
      price?:
        | string
        | {
            lookup_key?: string | null;
            product?:
              | string
              | { metadata?: { plan?: string | null; band?: string | null } | null }
              | null;
          }
        | null;
    }>;
  } | null;
};

/**
 * A metadata row belongs to this lookup only when its user id matches.
 * Naming another firm's id does not hand over that firm's customer.
 */
function metadataHit(
  meta: { firm_id?: string | null; milon_user_id?: string | null } | null | undefined,
  input: FirmCustomerLookup,
): { firmHit: boolean; userHit: boolean } | null {
  const firmId = input.firmId?.trim() ?? "";
  const userId = input.userId?.trim() ?? "";
  const metaFirm = meta?.firm_id?.trim() ?? "";
  const metaUser = meta?.milon_user_id?.trim() ?? "";
  if (metaUser && userId && metaUser !== userId) return null;
  if (metaFirm && firmId && metaFirm !== firmId) return null;
  const firmHit = Boolean(firmId) && metaFirm === firmId;
  const userHit = Boolean(userId) && metaUser === userId;
  if (!firmHit && !userHit) return null;
  return { firmHit, userHit };
}

/**
 * Customer id from subscriptions that already carry this firm or owner id.
 * An entitling firm subscription outranks an owner-plan or canceled row.
 * The signed-in email is not consulted. Another user's id never matches.
 */
export function customerIdFromMetadataSubscriptions(
  subs: MetadataSubscription[],
  input: FirmCustomerLookup,
): string | undefined {
  const ranked = subs.flatMap((sub) => {
    const hit = metadataHit(sub.metadata, input);
    if (!hit) return [];
    const { firmHit } = hit;
    const customerId = stripeCustomerId(sub.customer);
    if (!customerId) return [];
    const owner = subscriptionIsOwnerPlan(sub);
    const entitling = subscriptionStatusEntitles(sub.status) && !owner;
    let rank = (firmHit ? 2 : 0) + (entitling ? 1 : 0);
    if (input.preferOwnerPlan && owner) rank += 4;
    return [{ customerId, rank }];
  });
  ranked.sort((a, b) => b.rank - a.rank);
  return ranked[0]?.customerId;
}

type MetadataCustomer = {
  id?: string;
  email?: string | null;
  metadata?: {
    milon_user_id?: string | null;
    firm_id?: string | null;
  } | null;
};

function metadataCustomer(value: unknown): MetadataCustomer | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    id?: unknown;
    email?: unknown;
    deleted?: unknown;
    metadata?: unknown;
  };
  if (row.deleted === true) return null;
  const metadata =
    row.metadata && typeof row.metadata === "object"
      ? (row.metadata as { milon_user_id?: string | null; firm_id?: string | null })
      : null;
  return {
    id: typeof row.id === "string" ? row.id : undefined,
    email: typeof row.email === "string" ? row.email : null,
    metadata,
  };
}

/** Customer id from customers.search rows that carry this firm or owner id. */
export function customerIdFromMetadataCustomers(
  customers: MetadataCustomer[],
  input: FirmCustomerLookup,
): string | undefined {
  const ranked = customers.flatMap((customer) => {
    const hit = metadataHit(customer.metadata, input);
    if (!hit) return [];
    const { firmHit } = hit;
    const customerId = stripeCustomerId(customer.id);
    if (!customerId) return [];
    return [{ customerId, rank: firmHit ? 2 : 1 }];
  });
  ranked.sort((a, b) => b.rank - a.rank);
  return ranked[0]?.customerId;
}

function storedCustomerConflicts(
  metadata: { firm_id?: string | null; milon_user_id?: string | null } | null | undefined,
  input: FirmCustomerLookup,
): boolean {
  const metaFirm = metadata?.firm_id?.trim() ?? "";
  const metaUser = metadata?.milon_user_id?.trim() ?? "";
  const firmId = input.firmId?.trim() ?? "";
  const userId = input.userId?.trim() ?? "";
  if (metaFirm && firmId && metaFirm !== firmId) return true;
  if (metaUser && userId && metaUser !== userId) return true;
  return false;
}

/**
 * The signed-in email moved. Leave the Stripe customer as it is.
 * A later Checkout still attaches this customer id, so no second customer.
 */
function noteStripeEmailDiffers(
  customerId: string,
  stripeEmail: string | null | undefined,
  authEmail: string,
  via: "stored_customer_id" | "subscription_metadata" | "customer_metadata",
): void {
  const stripe = (stripeEmail ?? "").trim().toLowerCase();
  const auth = authEmail.trim().toLowerCase();
  if (!stripe || !auth || stripe === auth) return;
  console.warn(
    "[stripe] customer email differs from the signed-in email; leaving Stripe unchanged",
    { customerId, via, stripeEmail: stripe, authEmail: auth },
  );
}

async function readStoredCustomer(
  stripe: StripeCustomerSubscriptionReader,
  customerId: string,
): Promise<
  | {
      state: "trusted";
      email: string | null;
      metadata: { firm_id?: string | null; milon_user_id?: string | null } | null;
    }
  | { state: "reject" }
  | { state: "failed" }
> {
  if (!stripe.customers.retrieve) {
    return { state: "trusted", email: null, metadata: null };
  }
  try {
    const customer = metadataCustomer(await stripe.customers.retrieve(customerId));
    if (!customer) return { state: "reject" };
    if (customer.id && customer.id !== customerId) return { state: "reject" };
    return {
      state: "trusted",
      email: customer.email ?? null,
      metadata: customer.metadata ?? null,
    };
  } catch (err) {
    console.warn(
      "[stripe] stored customer retrieve failed",
      err instanceof Error ? err.message : err,
    );
    return { state: "failed" };
  }
}

/**
 * The email list found a different customer. Keep the stable one.
 * Checkout must attach that id so Stripe does not create another customer.
 * Callers do not await this: the extra customers.list is not on the hot path.
 */
async function noteDifferentEmailCustomer(
  stripe: StripeCustomerSubscriptionReader,
  stableId: string,
  email: string,
  via: "stored_customer_id" | "subscription_metadata" | "customer_metadata",
): Promise<void> {
  if (!email) return;
  let byEmail: string | undefined;
  try {
    byEmail = await findCustomerIdByEmail(stripe, email);
  } catch (err) {
    console.warn(
      "[stripe] email customer lookup failed",
      err instanceof Error ? err.message : err,
    );
    return;
  }
  if (!byEmail || byEmail === stableId) return;
  console.warn(
    "[stripe] stable customer differs from the email customer; keeping the stable customer",
    { customerId: stableId, emailCustomerId: byEmail, via },
  );
}

async function stripeCustomerEmail(
  stripe: StripeCustomerSubscriptionReader,
  customerId: string,
): Promise<string | null> {
  if (!stripe.customers.retrieve) return null;
  try {
    const customer = metadataCustomer(await stripe.customers.retrieve(customerId));
    return customer?.email ?? null;
  } catch {
    return null;
  }
}

function warnMetadataSearch(err: unknown): void {
  console.warn(
    "[stripe] firm customer metadata search failed",
    err instanceof Error ? err.message : err,
  );
}

/**
 * Resolves with the search result, or undefined when the budget expires
 * or the search throws. The Stripe call is not cancelled; it is not awaited
 * past `ms`, and it is invoked with no SDK retry.
 */
async function settleSearch<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  void work.catch(() => {});
  if (ms <= 0) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.catch((err: unknown) => {
        warnMetadataSearch(err);
        return undefined;
      }),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Subscription metadata, then customer metadata, sharing one clock.
 * A search that does not settle uses up the rest of the budget.
 */
async function metadataCustomerWithinBudget(
  stripe: StripeCustomerSubscriptionReader,
  input: FirmCustomerLookup,
  budgetMs: number,
): Promise<string | undefined> {
  const query = firmCustomerSearchQuery(input);
  if (!query || budgetMs <= 0) return undefined;
  const started = Date.now();
  const left = () => Math.max(0, budgetMs - (Date.now() - started));
  const options = (): FirmCustomerSearchOptions => ({
    maxNetworkRetries: 0,
    timeout: left(),
  });

  const subscriptionSearch = stripe.subscriptions.search;
  if (subscriptionSearch && left() > 0) {
    const found = await settleSearch(
      subscriptionSearch({ query, limit: 20 }, options()),
      left(),
    );
    const stable = found
      ? customerIdFromMetadataSubscriptions(found.data, input)
      : undefined;
    if (stable) {
      void (async () => {
        noteStripeEmailDiffers(
          stable,
          await stripeCustomerEmail(stripe, stable),
          input.email?.trim() ?? "",
          "subscription_metadata",
        );
        await noteDifferentEmailCustomer(
          stripe,
          stable,
          input.email?.trim() ?? "",
          "subscription_metadata",
        );
      })();
      return stable;
    }
  }

  const customerSearch = stripe.customers.search;
  if (customerSearch && left() > 0) {
    const found = await settleSearch(customerSearch({ query, limit: 20 }, options()), left());
    const rows = (found?.data ?? []).flatMap((row) => {
      const customer = metadataCustomer(row);
      return customer ? [customer] : [];
    });
    const stable = customerIdFromMetadataCustomers(rows, input);
    if (stable) {
      const row = rows.find((customer) => customer.id === stable);
      noteStripeEmailDiffers(stable, row?.email, input.email?.trim() ?? "", "customer_metadata");
      void noteDifferentEmailCustomer(
        stripe,
        stable,
        input.email?.trim() ?? "",
        "customer_metadata",
      );
      return stable;
    }
  }
  return undefined;
}

/**
 * Firm customer for entitlement, Checkout, and the pre-card mirror.
 * A stored customer id wins, including when the signed-in email points
 * somewhere else. With no stored id, email is first. Metadata search runs
 * only after that email misses, under one shared deadline, and does not
 * create a customer.
 */
export async function findFirmCustomerId(
  stripe: StripeCustomerSubscriptionReader,
  input: FirmCustomerLookup,
): Promise<string | undefined> {
  const email = input.email?.trim() ?? "";
  const stored = stripeCustomerId(input.storedCustomerId);
  let storedRetrieveFailed = false;
  if (stored) {
    const read = await readStoredCustomer(stripe, stored);
    if (read.state === "trusted" && !storedCustomerConflicts(read.metadata, input)) {
      noteStripeEmailDiffers(stored, read.email, email, "stored_customer_id");
      void noteDifferentEmailCustomer(stripe, stored, email, "stored_customer_id");
      return stored;
    }
    if (read.state === "failed") storedRetrieveFailed = true;
  }

  // No stored id: the common plan check. Email is one list. Searches wait.
  if (!stored && email) {
    try {
      const byEmail = await findCustomerIdByEmail(stripe, email);
      if (byEmail) return byEmail;
    } catch (err) {
      console.warn(
        "[stripe] email customer lookup failed",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const stable = await metadataCustomerWithinBudget(
    stripe,
    input,
    FIRM_CUSTOMER_SEARCH_BUDGET_MS,
  );
  if (stable) return stable;

  if (stored && storedRetrieveFailed) return stored;
  if (!email) return undefined;
  // Stored id was present but not trusted. Email was not the first step.
  if (stored) return findCustomerIdByEmail(stripe, email);
  return undefined;
}

export async function emailHasEntitlingSubscription(
  stripe: StripeCustomerSubscriptionReader,
  email: string,
): Promise<boolean> {
  const customerId = await findCustomerIdByEmail(stripe, email);
  if (!customerId) return false;
  return customerHasEntitlingSubscription(stripe, customerId);
}

/**
 * Whether the signed-in identity may use the firm product.
 * Invited staff inherit the firm's billing (they are not the Stripe customer).
 */
export function decideFirmBillingEntitlement(input: {
  stripeConfigured: boolean;
  hasEntitlingSubscription: boolean;
  ownsFirm: boolean;
  isFirmMember: boolean;
}): FirmBillingEntitlement {
  if (!input.stripeConfigured) {
    return { entitled: true, reason: "stripe_unconfigured" };
  }
  if (input.hasEntitlingSubscription) {
    return { entitled: true, reason: "active_subscription" };
  }
  if (!input.ownsFirm && input.isFirmMember) {
    return { entitled: true, reason: "firm_member" };
  }
  return { entitled: false, reason: "no_active_subscription" };
}

export type PostLoginBillingResume = "billing_start" | "billing_required" | "workspace";

/**
 * After sign-in from firm signup / pricing, unpaid firm owners go to the
 * practice workspace until they have seen an insight, then Checkout.
 * Pending checkout still wins over the owner Spark board.
 * Owner-door sign-in without a pending firm band must not steal Spark.
 * `insightSeen` omitted keeps the previous Checkout resume (callers that
 * have not been updated). Pass the live flag to defer.
 */
export function decidePostLoginBillingResume(input: {
  hasPendingFirmCheckout: boolean;
  ownsFirm: boolean;
  resumeFirmBilling: boolean;
  insightSeen?: boolean;
}): PostLoginBillingResume | null {
  const insightSeen = input.insightSeen !== false;
  if (!insightSeen) {
    if (input.hasPendingFirmCheckout || (input.resumeFirmBilling && input.ownsFirm)) {
      return "workspace";
    }
    return null;
  }
  if (input.hasPendingFirmCheckout) return "billing_start";
  if (input.resumeFirmBilling && input.ownsFirm) return "billing_required";
  return null;
}

export function decideFirmBillingPathGate(input: {
  pathname: string;
  isAccountantFirmUser: boolean;
  isMilonItMember: boolean;
  entitled: boolean;
  /**
   * When false, dashboard and client workspace stay open so the accountant
   * can reach an insight before Checkout. Omitted still requires billing
   * on paths that are not the first client's file.
   */
  insightSeen?: boolean;
  /**
   * Firm clients this owner can see. Pass from the shell.
   * Omitted: no first-client exception (older callers still redirect).
   * Null: the count failed — keep `/clients/:id` open.
   * 2 means two or more.
   */
  firmClientCount?: number | null;
  /** Oldest firm client. Required to keep that file open once a second exists. */
  firstClientId?: string | null;
}): FirmBillingPathDecision {
  const pathname = routePathname(input.pathname);
  if (isBillingExemptPath(pathname)) return "allow";
  if (isOwnerSparkPath(pathname)) return "allow";
  if (isOpsPath(pathname)) return "allow";
  if (!isFirmProductPath(pathname)) return "allow";
  if (input.isMilonItMember) return "allow";
  if (!input.isAccountantFirmUser) return "allow";
  if (input.entitled) return "allow";
  // First client's Overview and figures stay on screen without a card.
  // Reports and a later client file still redirect.
  // Settings, brand, and team are not firm-product paths, so they stay open.
  if (
    input.firmClientCount !== undefined &&
    isFirstClientFiguresPath({
      pathname,
      firmClientCount: input.firmClientCount,
      firstClientId: input.firstClientId,
    })
  ) {
    return "allow";
  }
  // Practice Home, the client list, and the practice overview stay open
  // without a card. A later client file still redirects. null and omitted
  // counts are not a book.
  if (
    (isPracticeShellPath(pathname) || isTeamSettingsPath(pathname)) &&
    typeof input.firmClientCount === "number" &&
    input.firmClientCount >= 1
  ) {
    return "allow";
  }
  // Zero clients means this firm has not shown figures. null is unknown;
  // omitted is a legacy caller. Neither is treated as zero.
  if (input.firmClientCount === 0 && isPreInsightWorkspacePath(pathname)) return "allow";
  if (input.insightSeen === false && isPreInsightWorkspacePath(pathname)) return "allow";
  return "require_billing";
}
