import { formatMoney, type MoneyMarket } from "@/lib/market/format";

/** Unicode minus, one sign for the owner door. Parentheses stay off the books. */
export function ownerMinus(text: string): string {
  return text.replace(/^-/, "−");
}

export function ownerMoney(n: number, market: MoneyMarket): string {
  return ownerMinus(formatMoney(n, market));
}
