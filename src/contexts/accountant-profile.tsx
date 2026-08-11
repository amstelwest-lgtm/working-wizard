import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  fetchUserFirm,
  firmBrandIsEmpty,
  profileFromFirm,
  saveFirmBrand,
  type FirmBrandRow,
} from "@/lib/firm-brand";

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
  /** Optimistic local edit (also caches to localStorage). Persist with saveProfile. */
  updateProfile: (partial: Partial<AccountantProfile>) => void;
  resetProfile: () => void;
  /** Firm row id when loaded; null if user has no firm yet. */
  firmId: string | null;
  /** True when the signed-in user owns the firm (can UPDATE brand). */
  canEditBrand: boolean;
  /** Loading firm brand from Supabase. */
  brandLoading: boolean;
  /** Persist current profile to the firm row. */
  saveProfile: () => Promise<{ ok: boolean; error?: string }>;
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
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<AccountantProfile>(DEFAULT_PROFILE);
  const [firm, setFirm] = useState<FirmBrandRow | null>(null);
  const [brandLoading, setBrandLoading] = useState(true);
  const hydratedRef = useRef(false);

  // Initial local cache so PDF preview doesn't flash empty before firm fetch.
  useEffect(() => {
    setProfile(loadFromStorage());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      if (authLoading) return;
      if (!user) {
        if (!cancelled) {
          setFirm(null);
          setBrandLoading(false);
          hydratedRef.current = false;
        }
        return;
      }

      setBrandLoading(true);
      try {
        const row = await fetchUserFirm(user.id);
        if (cancelled) return;
        setFirm(row);

        if (row) {
          const fromDb = profileFromFirm(row);
          const cached = loadFromStorage();

          // One-shot import: if firm brand is empty but this browser has local
          // settings, prefer the cache (and later Save writes it to the firm).
          if (firmBrandIsEmpty(row) && (cached.firmName || cached.logoUrl || cached.tagline)) {
            const merged: AccountantProfile = {
              ...fromDb,
              firmName: cached.firmName || fromDb.firmName || row.name,
              logoUrl: cached.logoUrl ?? fromDb.logoUrl,
              primaryColor: cached.primaryColor || fromDb.primaryColor,
              secondaryColor: cached.secondaryColor || fromDb.secondaryColor,
              accentColor: cached.accentColor || fromDb.accentColor,
              accountantName: cached.accountantName || fromDb.accountantName,
              accountantEmail: cached.accountantEmail || fromDb.accountantEmail,
              tagline: cached.tagline ?? fromDb.tagline,
            };
            setProfile(merged);
            saveToStorage(merged);
          } else {
            const merged: AccountantProfile = {
              ...fromDb,
              // Prefer DB name; fall back to cache only when firm name empty
              firmName: fromDb.firmName || cached.firmName,
              accountantName: fromDb.accountantName || cached.accountantName,
              accountantEmail: fromDb.accountantEmail || cached.accountantEmail,
            };
            setProfile(merged);
            saveToStorage(merged);
          }
        }
      } finally {
        if (!cancelled) {
          setBrandLoading(false);
          hydratedRef.current = true;
        }
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const updateProfile = useCallback((partial: Partial<AccountantProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...partial };
      saveToStorage(next);
      return next;
    });
  }, []);

  const resetProfile = useCallback(() => {
    saveToStorage(DEFAULT_PROFILE);
    setProfile(DEFAULT_PROFILE);
  }, []);

  const saveProfile = useCallback(async () => {
    if (!firm) {
      return { ok: false, error: "No firm found for this account yet." };
    }
    if (user && firm.owner_user_id !== user.id) {
      return { ok: false, error: "Only the firm owner can update brand settings." };
    }
    // Read latest profile from a ref-less path: use functional state snapshot
    // by saving whatever is currently in storage (kept in sync by updateProfile).
    const current = loadFromStorage();
    const toSave: AccountantProfile = {
      ...DEFAULT_PROFILE,
      ...current,
      // Prefer live React state when available — merge via closure profile
      ...profile,
    };
    const { error } = await saveFirmBrand(firm.id, toSave);
    if (error) return { ok: false, error };
    saveToStorage(toSave);
    setProfile(toSave);
    setFirm((f) =>
      f
        ? {
            ...f,
            name: toSave.firmName.trim() || f.name,
            logo_url: toSave.logoUrl,
            accent_color: toSave.accentColor,
            primary_color: toSave.primaryColor,
            secondary_color: toSave.secondaryColor,
            tagline: toSave.tagline,
            brand_contact_name: toSave.accountantName || null,
            brand_contact_email: toSave.accountantEmail || null,
            brand_updated_at: new Date().toISOString(),
          }
        : f,
    );
    return { ok: true };
  }, [firm, user, profile]);

  const canEditBrand = Boolean(user && firm && firm.owner_user_id === user.id);

  return (
    <AccountantProfileContext.Provider
      value={{
        profile,
        updateProfile,
        resetProfile,
        firmId: firm?.id ?? null,
        canEditBrand,
        brandLoading,
        saveProfile,
      }}
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
