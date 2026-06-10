import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";

export type AccountantProfile = {
  firmName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  accountantName: string;
  accountantEmail: string;
  tagline: string | null;
};

const STORAGE_KEY = "milon_accountant_profile";

export const DEFAULT_PROFILE: AccountantProfile = {
  firmName: "",
  logoUrl: null,
  primaryColor: "#1a1a2e",
  secondaryColor: "#16213e",
  accentColor: "#0f3460",
  accountantName: "",
  accountantEmail: "",
  tagline: null,
};

type AccountantProfileContextValue = {
  profile: AccountantProfile;
  updateProfile: (partial: Partial<AccountantProfile>) => void;
  resetProfile: () => void;
};

const AccountantProfileContext =
  createContext<AccountantProfileContextValue | null>(null);

function loadFromStorage(): AccountantProfile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROFILE;
    return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PROFILE;
  }
}

function saveToStorage(profile: AccountantProfile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // storage quota exceeded or private browsing — silently ignore
  }
}

export function AccountantProfileProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [profile, setProfile] = useState<AccountantProfile>(DEFAULT_PROFILE);

  useEffect(() => {
    setProfile(loadFromStorage());
  }, []);

  const updateProfile = (partial: Partial<AccountantProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...partial };
      saveToStorage(next);
      return next;
    });
  };

  const resetProfile = () => {
    saveToStorage(DEFAULT_PROFILE);
    setProfile(DEFAULT_PROFILE);
  };

  return (
    <AccountantProfileContext.Provider
      value={{ profile, updateProfile, resetProfile }}
    >
      {children}
    </AccountantProfileContext.Provider>
  );
}

export function useAccountantProfile(): AccountantProfileContextValue {
  const ctx = useContext(AccountantProfileContext);
  if (!ctx) {
    throw new Error(
      "useAccountantProfile must be used inside <AccountantProfileProvider>",
    );
  }
  return ctx;
}
