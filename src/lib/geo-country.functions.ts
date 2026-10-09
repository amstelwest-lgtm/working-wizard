import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Country from Vercel's edge header. Empty when the header is absent.
 * Local dev may set MILON_DEV_GEO. That fallback is ignored in production.
 * The header read stays inside the server function so the client bundle
 * does not import the server request API.
 */
export const readRequestGeoCountry = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const header = getRequest().headers.get("x-vercel-ip-country") ?? "";
    if (header.trim()) return header.trim();
  } catch {
    // No request scope (tests, build). Fall through.
  }
  if (process.env.NODE_ENV !== "production") {
    return (process.env.MILON_DEV_GEO ?? "").trim();
  }
  return "";
});
