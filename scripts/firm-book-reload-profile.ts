import { useSyncExternalStore } from "react";
import { FIRM_BOOK_USER_ID } from "./firm-book-reload-auth";

export const FIRM_BOOK_FIRM_ID = "firm-book-reload";

let firmId: string | null = FIRM_BOOK_FIRM_ID;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Firm id is null until membership resolves, then the practice reloads the book. */
export function setFirmBookFirmId(next: string | null) {
  firmId = next;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return firmId;
}

function profileValue(id: string | null) {
  return {
    firmId: id,
    firmMarket: { country: "ZA" },
    hasFirm: id != null,
    firms: id
      ? [
          {
            id,
            name: "North",
            referral_code: null,
            owner_user_id: FIRM_BOOK_USER_ID,
          },
        ]
      : [],
    firmsLoaded: true,
    firmsLoadFailed: false,
    brandLoading: false,
    profile: {
      firmName: id ? "North" : "",
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
  const id = useSyncExternalStore(subscribe, snapshot, snapshot);
  return profileValue(id);
}

export function useOptionalAccountantProfile() {
  const id = useSyncExternalStore(subscribe, snapshot, snapshot);
  return profileValue(id);
}
