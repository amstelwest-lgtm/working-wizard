/**
 * Owner plan copy. One price, and only for the visitor's market.
 * A linked accountant replaces the price. The line is for the Plan view.
 */
export type OwnerVisitor = "za" | "us";

export function ownerPlanLine(input: {
  visitor: OwnerVisitor | null;
  accountantOnMilon: boolean;
  firmName: string | null;
}): string {
  if (input.accountantOnMilon) {
    const who = input.firmName?.trim() || "Your accountant";
    return `Owner plan · included — ${who} is on Milōn`;
  }
  if (input.visitor === "za") return "Owner plan · R299/mo";
  if (input.visitor === "us") return "Owner plan · $39/mo";
  return "Owner plan";
}

/** Invite surfaces only. Not the home tiles and not the priced plan line. */
export function ownerPlanFreeLine(): string {
  return "Free when your accountant is on Milōn.";
}

/** Register <option> value. Not a Stripe price. Checkout for owners does not exist yet. */
export const OWNER_REGISTER_PLAN = "Business owner";

/**
 * Shown under the owner signup fields. One market's price. There is no owner Checkout.
 */
export function ownerRegisterPlanNote(visitor: OwnerVisitor): string {
  return `Owner plan: ${ownerPlanPublicPrice(visitor)} · free when your accountant is on Milōn`;
}

/** Display-only. R299 is for a known SA visitor. There is no owner Checkout. */
export function ownerPlanPublicPrice(visitor: OwnerVisitor): string {
  return visitor === "za" ? "R299/mo" : "$39/mo";
}

export function ownerPlanPublicLine(visitor: OwnerVisitor): string {
  return `${ownerPlanPublicPrice(visitor)} · free when your accountant is on Milōn`;
}
