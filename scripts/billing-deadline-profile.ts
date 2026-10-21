/** Ben's firm, with a known id, for the billing-gate deadline test. */
export const BILLING_DEADLINE_FIRM_ID = "e8f7a440-1111-4111-8111-111111111111";

export function useAccountantProfile() {
  return {
    firmId: BILLING_DEADLINE_FIRM_ID,
    firmMarket: { country: "US" },
    hasFirm: true,
    firms: [{ id: BILLING_DEADLINE_FIRM_ID }],
    firmsLoaded: true,
  };
}
