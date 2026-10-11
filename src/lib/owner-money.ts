import { formatMoney, type MoneyMarket } from "@/lib/market/format";

/** Unicode minus, one sign for the owner door. Parentheses stay off the books. */
export function ownerMinus(text: string): string {
  return text.replace(/^-/, "−");
}

export function ownerMoney(n: number, market: MoneyMarket): string {
  return ownerMinus(formatMoney(n, market));
}

/** A positive formatted amount, shown as money out with the owner minus. */
export function ownerOutflow(formattedAbs: string): string {
  return `−${formattedAbs.replace(/^[−-]/, "")}`;
}
