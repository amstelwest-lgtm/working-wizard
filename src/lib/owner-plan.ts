/**
 * Owner plan copy. One price, and only for the visitor's market.
 * Rand amounts are passed in from the server chunk. This module does not
 * contain them, so a US download never ships a rand price.
 */
import { firmUsdListPrice } from "./stripe-plans.ts";

const starterUsd = firmUsdListPrice("starter", "month");
if (!starterUsd) throw new Error("Starter has no published monthly price.");

export type OwnerVisitor = "za" | "us";

/** Loader data widens the pack to string. Only an explicit za value is ZA. */
export function ownerVisitorFromPack(value: string | null | undefined): OwnerVisitor {
  return value === "za" ? "za" : "us";
}

/** Same published dollar amount as Starter. The price table is the server source. */
export const OWNER_MONTHLY_USD_LABEL = `${starterUsd}/mo`;

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
  if (input.visitor === "us") {
    const amount = input.zaMonthly?.trim();
    return `Owner plan · ${amount || OWNER_MONTHLY_USD_LABEL}`;
  }
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

/**
 * Amount in a sentence such as "Business owners pay …".
 * US is the dollar catalog. ZA uses the server amount. A missing ZA amount,
 * or a visitor who is neither market, is the plan name.
 */
export function ownerQuotedAmount(
  visitor: string | null | undefined,
  zaMonthly?: string | null,
): string {
  if (visitor === "us") return OWNER_MONTHLY_USD_LABEL;
  if (visitor === "za") {
    const amount = zaMonthly?.trim() ?? "";
    return amount || "Owner plan";
  }
  return "Owner plan";
}

/**
 * "Business owners pay …". A missing amount names the Owner plan and does
 * not say "pay Owner plan".
 */
export function ownerPaySentence(
  visitor: string | null | undefined,
  zaMonthly?: string | null,
): string {
  const amount = ownerQuotedAmount(visitor, zaMonthly);
  if (!amount || amount === "Owner plan") {
    return "Business owners are on the Owner plan, or pay nothing when their accountant is on Milōn.";
  }
  return `Business owners pay ${amount}, or nothing when their accountant is on Milōn.`;
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
