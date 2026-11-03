/**
 * Product wordmark for advisory and report PDFs.
 * U+014D is the macron o. Helvetica (WinAnsi) cannot encode it.
 */

export const MILON_WORDMARK = "Mil\u014Dn";
export const MILON_WORDMARK_FONT = "Milon Wordmark";

/**
 * No custom firm, or the old product-name fallbacks ("Milon", "MILON ADVISORY").
 * Those draw the macron wordmark instead of an ASCII firm name.
 */
export function isProductBrandName(name: string | null | undefined): boolean {
  const folded = (name ?? "")
    .trim()
    .replace(/\u014C/g, "O")
    .replace(/\u014D/g, "o");
  return !folded || /^milon( advisory)?$/i.test(folded);
}
