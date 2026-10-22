import { FIRM_BOOK_USER_ID } from "./firm-book-reload-auth";

export const FIRM_BOOK_FIRM_ID = "firm-book-reload";

function profileValue() {
  return {
    firmId: FIRM_BOOK_FIRM_ID,
    firmMarket: { country: "ZA" },
    hasFirm: true,
    firms: [
      {
        id: FIRM_BOOK_FIRM_ID,
        name: "North",
        referral_code: null,
        owner_user_id: FIRM_BOOK_USER_ID,
      },
    ],
    firmsLoaded: true,
    firmsLoadFailed: false,
    brandLoading: false,
    profile: {
      firmName: "North",
      accountantName: "Ada",
      logoUrl: null,
      primaryColor: "#102A43",
      secondaryColor: "#16213e",
      accentColor: "#0f3460",
      accountantEmail: "",
      tagline: null,
      signatureDataUrl: null,
      timeZone: "Africa/Johannesburg",
    },
    refreshFirms: async () => {},
    greetingSource: "Ada",
    headerName: "Ada",
    setActiveFirm: async () => {},
    canEditBrand: false,
    updateProfile: () => {},
    resetProfile: () => {},
    saveProfile: async () => ({ ok: true }),
  };
}

export const DEFAULT_PROFILE = {
  firmName: "",
  logoUrl: null,
  primaryColor: "#102A43",
  secondaryColor: "#16213e",
  accentColor: "#0f3460",
  accountantName: "",
  accountantEmail: "",
  tagline: null,
  signatureDataUrl: null,
  timeZone: null,
};

export function useAccountantProfile() {
  return profileValue();
}

export function useOptionalAccountantProfile() {
  return profileValue();
}
