/**
 * Owner plan copy. One price, and only for the visitor's market.
 * Rand amounts are passed in from the server chunk. This module does not
 * contain them, so a US download never ships a rand price.
 */
export type OwnerVisitor = "za" | "us";

/** Loader data widens the pack to string. Only an explicit za value is ZA. */
export function ownerVisitorFromPack(value: string | null | undefined): OwnerVisitor {
  return value === "za" ? "za" : "us";
}

export const OWNER_MONTHLY_USD_LABEL = "$39/mo";

export function ownerPlanLine(input: {
  visitor: OwnerVisitor | null;
  accountantOnMilon: boolean;
  firmName: string | null;
  /** Server-built amount such as the ZA monthly label. Absent for everyone else. */
  zaMonthly?: string | null;
}): string {
  if (input.accountantOnMilon) {
    const who = input.firmName?.trim() || "Your accountant";
    return `Owner plan · included — ${who} is on Milōn`;
  }
  if (input.visitor === "za") {
    return input.zaMonthly ? `Owner plan · ${input.zaMonthly}` : "Owner plan";
  }
  if (input.visitor === "us") return `Owner plan · ${OWNER_MONTHLY_USD_LABEL}`;
  return "Owner plan";
}

/** Invite surfaces only. Not the home tiles and not the priced plan line. */
export function ownerPlanFreeLine(): string {
  return "Free when your accountant joins.";
}

/** Register <option> value. Not a Stripe price. */
export const OWNER_REGISTER_PLAN = "Business owner";

/**
 * Shown under the owner signup fields. The rand amount is supplied by the
 * server for a ZA visitor. A missing amount stays on the dollar label only
 * when the visitor is not ZA.
 */
export function ownerRegisterPlanNote(visitor: OwnerVisitor, zaMonthly?: string | null): string {
  return `Owner plan: ${ownerPlanPublicPrice(visitor, zaMonthly)} · free when your accountant joins`;
}

export function ownerPlanPublicPrice(visitor: OwnerVisitor, zaMonthly?: string | null): string {
  if (visitor === "za" && zaMonthly) return zaMonthly;
  if (visitor === "za") return "";
  return OWNER_MONTHLY_USD_LABEL;
}

export function ownerPlanPublicLine(visitor: OwnerVisitor, zaMonthly?: string | null): string {
  const price = ownerPlanPublicPrice(visitor, zaMonthly);
  if (!price) return "free when your accountant joins";
  return `${price} · free when your accountant joins`;
}
