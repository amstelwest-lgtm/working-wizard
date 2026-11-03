/**
 * Money printed on a PDF.
 *
 * ZA product amounts use a space after R and a space between thousands
 * (`R 320 444`, `R 46 300`). `toLocaleString("en-ZA")` puts a comma before
 * cents (`R 9,27`). PDF cents keep the space grouping and use a period.
 */

type PdfMoneyMarket = { currency?: string | null };

function grouped(intDigits: string, separator: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

export function formatPdfMoney(
  n: number,
  market: PdfMoneyMarket = {},
  opts?: { fractionDigits?: number },
): string {
  if (!Number.isFinite(n)) return "—";
  const digits = Math.max(0, opts?.fractionDigits ?? 0);
  const negative = n < 0;
  const abs = Math.abs(n);
  const fixed = digits > 0 ? abs.toFixed(digits) : String(Math.round(abs));
  const [intPart, frac = ""] = fixed.split(".");
  const usd = market.currency === "USD";
  const separator = usd ? "," : " ";
  const whole = grouped(intPart, separator);
  const body = frac ? `${whole}.${frac}` : whole;
  const sign = negative ? "-" : "";
  if (usd) return `${sign}$${body}`;
  return `${sign}R ${body}`;
}
