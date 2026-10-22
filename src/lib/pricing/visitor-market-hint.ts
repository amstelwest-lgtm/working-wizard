/**
 * Landing dropdown choice carried on CTA links as ?market=.
 * A visitor hint only. It is not ?country=, and it does not price a firm
 * that already has a stored market.
 */

export function visitorMarketHint(country: string | null | undefined): "ZA" | "US" | null {
  const code = (country ?? "").trim().toUpperCase();
  if (code === "ZA" || code === "US") return code;
  return null;
}

/** Adds ?market=ZA or ?market=US. Leaves every other query key alone. Never sets country. */
export function withVisitorMarketHint(href: string, country: string | null | undefined): string {
  const hint = visitorMarketHint(country);
  if (!hint) return href;
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const before = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const split = before.indexOf("?");
  const path = split >= 0 ? before.slice(0, split) : before;
  const query = split >= 0 ? before.slice(split + 1) : "";
  const params = new URLSearchParams(query);
  params.delete("country");
  params.set("market", hint);
  const next = params.toString();
  return `${path}${next ? `?${next}` : ""}${hash}`;
}
