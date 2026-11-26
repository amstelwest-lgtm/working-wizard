/** Matches `version` in desktop/package.json. The landing href test keeps them together. */
export const DESKTOP_INSTALLER_VERSION = "0.1.0";

const VERSION_TAG = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * Stable public blob URLs are cached for a long time. A version query makes
 * the next landing page fetch a different URL.
 */
export function versionedInstallerHref(href: string, version = DESKTOP_INSTALLER_VERSION): string {
  if (!href) return "";
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return "";
  }
  if (url.protocol !== "https:") return "";
  const tag = version.trim();
  if (!VERSION_TAG.test(tag)) return url.href;
  url.searchParams.set("v", tag);
  return url.href;
}
