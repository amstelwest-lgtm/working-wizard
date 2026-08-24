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
import { supabase } from "@/integrations/supabase/client";
import {
  fetchUserFirm,
  firmBrandIsEmpty,
  listUserFirms,
  profileFromFirm,
  readActiveFirmId,
  saveFirmBrand,
  writeActiveFirmId,
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

/** Legacy unscoped key — only migrated into a user-scoped key, never applied cross-user. */
const LEGACY_STORAGE_KEY = "milon_accountant_profile";

function storageKeyFor(userId: string): string {
  return `milon_accountant_profile:${userId}`;
}

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
  /** All firms this user can access (owned + memberships). */
  firms: FirmBrandRow[];
  /** Switch active firm (G27). Re-hydrates brand from the chosen firm. */
  setActiveFirm: (firmId: string) => Promise<void>;
  /** True when the signed-in user owns the firm (can UPDATE brand). */
  canEditBrand: boolean;
  /** Loading firm brand from Supabase. */
  brandLoading: boolean;
  /** Re-fetch owned/member firms (after auto-provision or add-client). */
  refreshFirms: () => Promise<void>;
  /** Persist current profile to the firm row. */
  saveProfile: () => Promise<{ ok: boolean; error?: string }>;
};

const AccountantProfileContext =
  createContext<AccountantProfileContextValue | null>(null);

function loadFromStorage(userId: string | null): AccountantProfile {
  if (typeof window === "undefined" || !userId) return DEFAULT_PROFILE;
  try {
    const scoped = localStorage.getItem(storageKeyFor(userId));
    if (scoped) return { ...DEFAULT_PROFILE, ...JSON.parse(scoped) };

    // One-shot migrate legacy unscoped cache into this user's key, then remove it
    // so another account on the same browser cannot flash the wrong firm brand (N8).
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed = { ...DEFAULT_PROFILE, ...JSON.parse(legacy) };
      localStorage.setItem(storageKeyFor(userId), JSON.stringify(parsed));
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return parsed;
    }
    return DEFAULT_PROFILE;
  } catch {
    return DEFAULT_PROFILE;
  }
}

function saveToStorage(userId: string | null, profile: AccountantProfile) {
  if (!userId) return;
  try {
    localStorage.setItem(storageKeyFor(userId), JSON.stringify(profile));
  } catch {
    // storage quota exceeded or private browsing — silently ignore
  }
}

function applyFirmToProfile(
  row: FirmBrandRow,
  userId: string,
  cached: AccountantProfile,
): AccountantProfile {
  const fromDb = profileFromFirm(row);

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
    saveToStorage(userId, merged);
    return merged;
  }

  const merged: AccountantProfile = {
    ...fromDb,
    firmName: fromDb.firmName || cached.firmName,
    accountantName: fromDb.accountantName || cached.accountantName,
    accountantEmail: fromDb.accountantEmail || cached.accountantEmail,
  };
  saveToStorage(userId, merged);
  return merged;
}

export function AccountantProfileProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user, loading: authLoading } = useAuth();
  // Stay on DEFAULT until the signed-in user is known — never paint another
  // browser tab's / previous user's brand (N8).
  const [profile, setProfile] = useState<AccountantProfile>(DEFAULT_PROFILE);
  const [firm, setFirm] = useState<FirmBrandRow | null>(null);
  const [firms, setFirms] = useState<FirmBrandRow[]>([]);
  const [brandLoading, setBrandLoading] = useState(true);
  const hydratedRef = useRef(false);
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      if (authLoading) return;
      if (!user) {
        if (!cancelled) {
          setFirm(null);
          setFirms([]);
          setProfile(DEFAULT_PROFILE);
          setBrandLoading(false);
          hydratedRef.current = false;
        }
        return;
      }

      setBrandLoading(true);
      // Soft cache for this user only — never cross-account.
      const cached = loadFromStorage(user.id);
      if (!cancelled && (cached.firmName || cached.logoUrl || cached.tagline)) {
        setProfile(cached);
      } else if (!cancelled) {
        setProfile(DEFAULT_PROFILE);
      }

      try {
        const preferred = readActiveFirmId(user.id);
        let [all, row] = await Promise.all([
          listUserFirms(user.id),
          fetchUserFirm(user.id, preferred),
        ]);
        if (cancelled) return;

        if (all.length === 0) {
          const firmName =
            cached.firmName ||
            (user.user_metadata?.firm_name as string | undefined) ||
            null;
          const { error: ensureErr } = await supabase.rpc("ensure_practice_firm", {
            p_name: firmName,
          });
          if (!ensureErr) {
            const again = await Promise.all([
              listUserFirms(user.id),
              fetchUserFirm(user.id, preferred),
            ]);
            all = again[0];
            row = again[1];
          }
        }

        if (cancelled) return;
        setFirms(all);
        setFirm(row);

        if (row) {
          writeActiveFirmId(user.id, row.id);
          setProfile(applyFirmToProfile(row, user.id, cached));
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
      saveToStorage(userIdRef.current, next);
      return next;
    });
  }, []);

  const resetProfile = useCallback(() => {
    saveToStorage(userIdRef.current, DEFAULT_PROFILE);
    setProfile(DEFAULT_PROFILE);
  }, []);

  const refreshFirms = useCallback(async () => {
    if (!user) return;
    const preferred = readActiveFirmId(user.id);
    const [all, row] = await Promise.all([
      listUserFirms(user.id),
      fetchUserFirm(user.id, preferred),
    ]);
    setFirms(all);
    setFirm(row);
    if (row) {
      writeActiveFirmId(user.id, row.id);
      const cached = loadFromStorage(user.id);
      setProfile(applyFirmToProfile(row, user.id, cached));
    }
  }, [user]);

  const setActiveFirm = useCallback(
    async (nextFirmId: string) => {
      if (!user) return;
      const match = firms.find((f) => f.id === nextFirmId);
      if (!match) return;
      if (firm?.id === nextFirmId) return;

      writeActiveFirmId(user.id, nextFirmId);
      setFirm(match);
      // Brand for the newly selected firm — don't bleed the previous firm's cache
      // colours into an already-branded firm.
      const cached = loadFromStorage(user.id);
      setProfile(applyFirmToProfile(match, user.id, cached));
    },
    [user, firms, firm?.id],
  );

  const saveProfile = useCallback(async () => {
    if (!firm) {
      return { ok: false, error: "No firm found for this account yet." };
    }
    if (user && firm.owner_user_id !== user.id) {
      return { ok: false, error: "Only the firm owner can update brand settings." };
    }
    const current = loadFromStorage(user?.id ?? null);
    const toSave: AccountantProfile = {
      ...DEFAULT_PROFILE,
      ...current,
      ...profile,
    };
    const { error } = await saveFirmBrand(firm.id, toSave);
    if (error) return { ok: false, error };
    saveToStorage(user?.id ?? null, toSave);
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
    setFirms((list) =>
      list.map((f) =>
        f.id === firm.id
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
      ),
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
        firms,
        setActiveFirm,
        canEditBrand,
        brandLoading,
        refreshFirms,
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
