/** Shared facts for the public legal notices. Keep pages and tests aligned. */

export const LEGAL_EFFECTIVE = "4 September 2026";
/** Registered company. The product name stays Milōn. */
export const LEGAL_ENTITY = "Milon Inc";
export const LEGAL_PRODUCT = "Milōn";
export const LEGAL_DOMAIN = "milonfinance.com";
export const LEGAL_INFORMATION_OFFICER = "Privacy contact";
/** Public mailbox for privacy requests. Not a named person. */
export const LEGAL_CONTACT_EMAIL = "hello@milonfinance.com";
/** Visible placeholder until a US street address is supplied. */
export const LEGAL_ADDRESS_LINES = ["[US ADDRESS]"] as const;
export const LEGAL_ADDRESS = LEGAL_ADDRESS_LINES.join(", ");

export const LEGAL_PATHS = {
  privacy: "/privacy",
  terms: "/terms",
  ai: "/ai",
  faq: "/faq",
} as const;
