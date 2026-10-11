/** Shared facts for the public legal notices. Keep pages and tests aligned. */

export const LEGAL_EFFECTIVE = "4 September 2026";
/** Registered company. The product name stays Milōn. */
export const LEGAL_ENTITY = "Milon, Inc.";
export const LEGAL_PRODUCT = "Milōn";
export const LEGAL_DOMAIN = "milonfinance.com";
/** Role inbox. Do not name a person. */
export const LEGAL_PRIVACY_EMAIL = "team@milonfinance.com";
export const LEGAL_INFORMATION_OFFICER = "the Milōn privacy team";

/**
 * One display address. Structured fields below must stay in lockstep with it.
 * Stripe tax head office for Milon, Inc.
 */
export const COMPANY_POSTAL_ADDRESS = {
  streetAddress: "800 N King Street, Suite 304, PMB 3836",
  addressLocality: "Wilmington",
  addressRegion: "DE",
  postalCode: "19801",
  addressCountry: "US",
} as const;

export const COMPANY_ADDRESS = `${COMPANY_POSTAL_ADDRESS.streetAddress}, ${COMPANY_POSTAL_ADDRESS.addressLocality}, ${COMPANY_POSTAL_ADDRESS.addressRegion} ${COMPANY_POSTAL_ADDRESS.postalCode}, United States`;

export const LEGAL_ADDRESS_LINES = [COMPANY_ADDRESS] as const;
export const LEGAL_ADDRESS = COMPANY_ADDRESS;

export const LEGAL_PATHS = {
  privacy: "/privacy",
  terms: "/terms",
  ai: "/ai",
  faq: "/faq",
} as const;
