import { parseZaLookupKey } from "@/lib/pricing/za-ladder";

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
  const customers = stripe.customers;
  if (!id || !customers?.retrieve) return null;
  try {
    const customer = await customers.retrieve(id);
    if (!customer || customer.deleted) return null;
    const country = customer.address?.country?.trim() ?? "";
    return country || null;
  } catch {
    return null;
  }
}
