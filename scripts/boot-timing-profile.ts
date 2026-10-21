/** Firm market with a decoy email. The boot line may keep only the country. */
export function useAccountantProfile() {
  return {
    firmId: null as string | null,
    firmMarket: { country: "ZA", note: "ada@example.com" },
    hasFirm: false,
    firms: [] as Array<{ id: string }>,
    firmsLoaded: false,
    firmsLoadFailed: false,
    refreshFirms: async () => {},
  };
}
