/**
 * Compare the approved price table to live Stripe prices.
 * Read-only: GET /v1/prices only. Never creates or updates a price.
 *
 * Skips when neither STRIPE_RESTRICTED_KEY nor STRIPE_SECRET_KEY is set.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/stripe-price-table-check.mts
 */
import { APPROVED_PRICES } from "../src/lib/pricing/price-table.server.ts";

const key = (process.env.STRIPE_RESTRICTED_KEY || process.env.STRIPE_SECRET_KEY || "").trim();

if (!key) {
  console.log(
    "Stripe price table check skipped: set STRIPE_RESTRICTED_KEY (a read-only restricted key) to compare live prices. STRIPE_SECRET_KEY is also accepted. No Stripe request was made.",
  );
  process.exit(0);
}

type StripePrice = {
  lookup_key: string | null;
  unit_amount: number | null;
  currency: string;
  active: boolean;
};

async function fetchPrices(lookupKeys: string[]): Promise<StripePrice[]> {
  const params = new URLSearchParams();
  for (const lookup of lookupKeys) params.append("lookup_keys[]", lookup);
  params.set("active", "true");
  params.set("limit", "100");
  const response = await fetch(`https://api.stripe.com/v1/prices?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Stripe price read failed (${response.status}): ${body.slice(0, 180)}`);
  }
  const json = (await response.json()) as { data?: StripePrice[] };
  return json.data ?? [];
}

const mismatches: string[] = [];
for (let index = 0; index < APPROVED_PRICES.length; index += 10) {
  const batch = APPROVED_PRICES.slice(index, index + 10);
  const live = await fetchPrices(batch.map((row) => row.lookupKey));
  for (const row of batch) {
    const matches = live.filter((price) => price.active && price.lookup_key === row.lookupKey);
    if (matches.length === 0) {
      mismatches.push(`${row.lookupKey}: no active Stripe price`);
      continue;
    }
    const hit = matches.find(
      (price) =>
        price.unit_amount === row.unitAmount &&
        (price.currency ?? "").toLowerCase() === row.currency.toLowerCase(),
    );
    if (!hit) {
      const seen = matches
        .map((price) => `${price.unit_amount ?? "none"} ${(price.currency ?? "").toLowerCase()}`)
        .join(", ");
      mismatches.push(`${row.lookupKey}: table ${row.unitAmount} ${row.currency}, Stripe ${seen}`);
    }
  }
}

if (mismatches.length > 0) {
  console.error("Stripe price table mismatch:");
  for (const line of mismatches) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`Stripe price table matches ${APPROVED_PRICES.length} lookup keys.`);
