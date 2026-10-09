/**
 * Idempotent rand prices on the existing firm-band products.
 *
 *   STRIPE_SECRET_KEY=sk_test_... pnpm stripe:za-prices
 *
 * Defaults to a test key. A live key is refused unless --live is passed.
 * --live with a test key is also refused. The key is never printed.
 * An active price that already matches is skipped. An active price with a
 * different amount is left alone. An inactive price holding the lookup key
 * is replaced with transfer_lookup_key.
 */
import Stripe from "stripe";
import { zaCatalogEntries } from "../src/lib/pricing/za-ladder-amounts";

const live = process.argv.includes("--live");
const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();

if (!key) {
  console.error("STRIPE_SECRET_KEY is not set. No prices were created.");
  process.exit(1);
}

const liveKey = key.startsWith("sk_live") || key.startsWith("rk_live");
if (liveKey && !live) {
  console.error("Refusing a live key without --live. No prices were created.");
  process.exit(1);
}
if (!liveKey && live) {
  console.error("--live was passed but STRIPE_SECRET_KEY is not a live key.");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });

function productId(product: unknown): string | null {
  if (typeof product === "string" && product.trim()) return product.trim();
  if (product && typeof product === "object" && "id" in product) {
    const id = (product as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

for (const entry of zaCatalogEntries()) {
  const listed = await stripe.prices.list({
    lookup_keys: [entry.lookupKey],
    limit: 1,
  });
  const found = listed.data[0];
  if (
    found?.active &&
    found.currency === entry.currency &&
    found.unit_amount === entry.unitAmount
  ) {
    console.log(`skip ${entry.lookupKey} ${found.id}`);
    continue;
  }
  if (found?.active) {
    console.log(`leave ${entry.lookupKey} active price differs`);
    continue;
  }

  const usd = await stripe.prices.list({
    lookup_keys: [entry.usdLookupKey],
    active: true,
    limit: 1,
  });
  const product = productId(usd.data[0]?.product);
  if (!product) {
    console.error(`no active product for ${entry.usdLookupKey}`);
    process.exit(1);
  }

  const created = await stripe.prices.create({
    product,
    currency: entry.currency,
    unit_amount: entry.unitAmount,
    lookup_key: entry.lookupKey,
    transfer_lookup_key: Boolean(found && !found.active),
    recurring: { interval: entry.recurringInterval },
    tax_behavior: "exclusive",
  });
  console.log(`created ${entry.lookupKey} ${created.id} ${entry.unitAmount}`);
}
