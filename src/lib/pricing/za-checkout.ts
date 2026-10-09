import type { StripePlanMarket } from "@/lib/stripe-plans";
import { parseZaLookupKey } from "@/lib/pricing/za-ladder";

/**
 * A rand price is valid only when Checkout's billing country is ZA.
 * Unknown country at session creation still starts on the rand price,
 * because the address is collected during Checkout.
 * A known non-ZA country falls back to the USD price.
 */
export function priceMarketForFirm(input: {
  firmMarket: StripePlanMarket;
  billingCountry?: string | null;
}): StripePlanMarket {
  if (input.firmMarket !== "za") return "us";
  const country = (input.billingCountry ?? "").trim().toUpperCase();
  if (country && country !== "ZA") return "us";
  return "za";
}

/** After Checkout, a missing country is not enough to keep the rand price. */
export function zarBillingCountryOk(country: string | null | undefined): boolean {
  return (country ?? "").trim().toUpperCase() === "ZA";
}

export function isZaCatalogLookup(lookupKey: string | null | undefined): boolean {
  return parseZaLookupKey(lookupKey) != null;
}

type CustomerRecord = {
  deleted?: boolean;
  address?: { country?: string | null } | null;
};

type CustomerReader = {
  customers?: {
    retrieve?: (id: string) => Promise<CustomerRecord>;
  };
};

/** Missing retrieve (tests) or a failed read leaves the country unknown. */
export async function readStripeCustomerCountry(
  stripe: CustomerReader,
  customerId: string | null | undefined,
): Promise<string | null> {
  const id = customerId?.trim() ?? "";
  const retrieve = stripe.customers?.retrieve;
  if (!id || !retrieve) return null;
  try {
    const customer = await retrieve(id);
    if (!customer || customer.deleted) return null;
    const country = customer.address?.country?.trim() ?? "";
    return country || null;
  } catch {
    return null;
  }
}
