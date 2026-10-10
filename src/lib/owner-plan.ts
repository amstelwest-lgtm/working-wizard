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
