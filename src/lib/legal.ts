/** Shared facts for the public legal notices. Keep pages and tests aligned. */

export const LEGAL_EFFECTIVE = "4 September 2026";
/** Registered company — not the product name. */
export const LEGAL_ENTITY = "Eish2oh (Pty) Ltd";
export const LEGAL_PRODUCT = "Milōn";
export const LEGAL_DOMAIN = "milon.co.za";
export const LEGAL_INFORMATION_OFFICER = "Theo";
export const LEGAL_ADDRESS_LINES = [
  "152 Melville Street",
  "Sunnyside",
  "Pretoria",
  "Gauteng",
  "0002",
] as const;
export const LEGAL_ADDRESS = LEGAL_ADDRESS_LINES.join(", ");

export const LEGAL_PATHS = {
  privacy: "/privacy",
  terms: "/terms",
  ai: "/ai",
  faq: "/faq",
} as const;
