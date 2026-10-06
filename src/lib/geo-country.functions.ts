import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/** Country from Vercel's edge header. Empty when the header is absent (local, non-ZA). */
export const readRequestGeoCountry = createServerFn({ method: "GET" }).handler(async () => {
  try {
    return getRequest().headers.get("x-vercel-ip-country") ?? "";
  } catch {
    return "";
  }
});
