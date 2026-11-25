/** Existing page: src/routes/reset-password.tsx on the canonical host. */
export const PASSWORD_RESET_URL = "https://www.milonfinance.com/reset-password";

/**
 * The only URL the desktop app may open in the system browser.
 * Anything else, including other https hosts, is rejected.
 */
export function allowedPasswordResetUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.hostname !== "www.milonfinance.com") return null;
  if (url.port !== "") return null;
  if (url.pathname !== "/reset-password") return null;
  if (url.search !== "" || url.hash !== "") return null;
  if (url.href !== PASSWORD_RESET_URL) return null;
  return PASSWORD_RESET_URL;
}
