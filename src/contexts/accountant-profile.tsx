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
import { listAppRoles, summarizeRoles, isPracticeSignupMeta } from "@/lib/user-roles";
import { parseMarketSelection } from "@/lib/market/parse";
import { resolveMarket } from "@/lib/market/resolve";
import {
  authDisplayName,
  practiceGreetingName,
  resolvePersistedAccountantIdentity,
  type PersistedNameChain,
} from "@/lib/accountant-identity";

function firmTimeZoneFromMarket(market: unknown): string | null {
  const selection = parseMarketSelection(market);
  if (!selection) return null;
  try {
    return resolveMarket(selection).timezone;
  } catch {
    return null;
  }
}

export type AccountantProfile = {
  firmName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  accountantName: string;
  accountantEmail: string;
  tagline: string | null;
  /** Personal drawn signature (data URL). Kept local to the accountant, copied onto each sign-off. */
  signatureDataUrl: string | null;
  /** IANA zone from the firm's stored market. Absent until the practice picks one. */
  timeZone?: string | null;
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
  signatureDataUrl: null,
  timeZone: null,
};

type AccountantProfileContextValue = {
  profile: AccountantProfile;
  /** Optimistic local edit (also caches to localStorage). Persist with saveProfile. */
  updateProfile: (partial: Partial<AccountantProfile>) => void;
  resetProfile: () => void;
  /** Firm row id when loaded; null if user has no firm yet. */
  firmId: string | null;
  /** firms.market JSON. Null when there is no firm row. */
  firmMarket: unknown;
  /** True once a firm row is loaded. Missing market is not a ZA firm. */
  hasFirm: boolean;
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
  /** Greeting name: firm contact, profile full name, auth full name, then email. */
  greetingSource: string;
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

/** Unsaved firm and person names must not survive a session load. */
function dropUnsavedIdentity(cached: AccountantProfile): AccountantProfile {
  return { ...cached, firmName: "", accountantName: "" };
}

function applyFirmToProfile(
  row: FirmBrandRow,
  userId: string,
  cached: AccountantProfile,
  identity: PersistedNameChain,
): AccountantProfile {
  const fromDb = profileFromFirm(row);
  const timeZone = firmTimeZoneFromMarket(row.market);
  const persisted = resolvePersistedAccountantIdentity({
    firmName: row.name,
    brandContactName: row.brand_contact_name,
    profileFullName: identity.profileFullName,
    authFullName: identity.authFullName,
  });
  // Colours and logo may still draft an unbranded firm. Name fields never do.
  const visuals = firmBrandIsEmpty(row) ? cached : null;
  const merged: AccountantProfile = {
    ...fromDb,
    firmName: persisted.firmName,
    accountantName: persisted.accountantName,
    logoUrl: visuals?.logoUrl ?? fromDb.logoUrl,
    primaryColor: visuals?.primaryColor || fromDb.primaryColor,
    secondaryColor: visuals?.secondaryColor || fromDb.secondaryColor,
    accentColor: visuals?.accentColor || fromDb.accentColor,
    accountantEmail: fromDb.accountantEmail || visuals?.accountantEmail || "",
    tagline: visuals ? (visuals.tagline ?? fromDb.tagline) : fromDb.tagline,
    signatureDataUrl: cached.signatureDataUrl ?? null,
    timeZone,
  };
  saveToStorage(userId, merged);
  return merged;
}

async function readPersistedNameChain(user: {
  id: string;
  user_metadata?: unknown;
}): Promise<PersistedNameChain> {
  const authFullName = authDisplayName(
    user.user_metadata as { full_name?: unknown; name?: unknown } | null | undefined,
  );
  const { data } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
  return {
    profileFullName: data?.full_name?.trim() ?? "",
    authFullName,
  };
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
  const [nameChain, setNameChain] = useState<PersistedNameChain>({
    profileFullName: "",
    authFullName: "",
  });
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
          setNameChain({ profileFullName: "", authFullName: "" });
          setBrandLoading(false);
          hydratedRef.current = false;
        }
        return;
      }

      setBrandLoading(true);
      // Soft cache for this user only — never cross-account.
      // Drop unsaved firm/name edits before paint so a sample draft cannot flash.
      const cachedRaw = loadFromStorage(user.id);
      const cached = dropUnsavedIdentity(cachedRaw);
      if (cachedRaw.firmName || cachedRaw.accountantName) {
        saveToStorage(user.id, cached);
      }
      if (!cancelled && (cached.logoUrl || cached.tagline)) {
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
          const roles = summarizeRoles(await listAppRoles(user.id));
          const meta = user.user_metadata as Record<string, unknown> | undefined;
          const practiceSignup = isPracticeSignupMeta(meta);
          const customerSignup = meta?.signup_type === "customer";
          // Only mint a practice firm on positive evidence of a practice account.
          // A freshly confirmed owner reaches /app before ensure_own_client has
          // written client_owner — "no roles yet" must not be read as "accountant",
          // or the owner is promoted to firm_admin and lands on /dashboard next login.
          if (!customerSignup && (roles.hasPracticeRole || practiceSignup)) {
            const metaFirmName = typeof meta?.firm_name === "string" ? meta.firm_name.trim() : "";
            const firmName = metaFirmName || cachedRaw.firmName || null;
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
        }

        if (cancelled) return;
        const identity = await readPersistedNameChain(user);
        if (cancelled) return;
        setNameChain(identity);
        setFirms(all);
        setFirm(row);

        if (row) {
          writeActiveFirmId(user.id, row.id);
          setProfile(applyFirmToProfile(row, user.id, cached, identity));
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
      const identity = await readPersistedNameChain(user);
      setNameChain(identity);
      const cached = dropUnsavedIdentity(loadFromStorage(user.id));
      setProfile(applyFirmToProfile(row, user.id, cached, identity));
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
      // colours into an already-branded firm. Name fields still come from the row.
      const identity = await readPersistedNameChain(user);
      setNameChain(identity);
      const cached = dropUnsavedIdentity(loadFromStorage(user.id));
      setProfile(applyFirmToProfile(match, user.id, cached, identity));
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
  const greetingSource = practiceGreetingName({
    accountantName: profile.accountantName,
    profileFullName: nameChain.profileFullName,
    authFullName: nameChain.authFullName,
    email: user?.email,
  });

  return (
    <AccountantProfileContext.Provider
      value={{
        profile,
        updateProfile,
        resetProfile,
        firmId: firm?.id ?? null,
        firmMarket: firm?.market ?? null,
        hasFirm: Boolean(firm),
        firms,
        setActiveFirm,
        canEditBrand,
        brandLoading,
        refreshFirms,
        saveProfile,
        greetingSource,
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

/** Null outside the provider (tests, or a shell that has not mounted it). */
export function useOptionalAccountantProfile(): AccountantProfileContextValue | null {
  return useContext(AccountantProfileContext);
}
