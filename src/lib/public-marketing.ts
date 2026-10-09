/** Routes that paint from inlined marketing CSS and must not download the app. */
export const PUBLIC_MARKETING_PATHS = [
  "/",
  "/for-accountants",
  "/for-owners",
  "/about",
  "/faq",
  "/privacy",
  "/terms",
  "/ai",
] as const;

export function isPublicMarketingPath(pathname: string): boolean {
  let path = pathname || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return (PUBLIC_MARKETING_PATHS as readonly string[]).includes(path);
}
