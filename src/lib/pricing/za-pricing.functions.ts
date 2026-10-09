import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { isSaPricingCountry } from "@/lib/geo-country";

/**
 * Rand sentences for a ZA edge only. Anyone else gets null, so the
 * literals stay in the server chunk. The header read stays inside this
 * handler so the client bundle does not import the server request API.
 */
export const readSaPricingCopy = createServerFn({ method: "GET" }).handler(async () => {
  let country = "";
  try {
    const header = getRequest().headers.get("x-vercel-ip-country") ?? "";
    if (header.trim()) country = header.trim();
  } catch {
    // No request scope (tests, build). Fall through.
  }
  if (!country && process.env.NODE_ENV !== "production") {
    country = (process.env.MILON_DEV_GEO ?? "").trim();
  }
  if (!isSaPricingCountry(country)) return null;
  const { loadSaPricingCopy } = await import("@/lib/pricing/za-pricing-chunk.server");
  return loadSaPricingCopy();
});
