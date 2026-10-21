import { supabase } from "@/integrations/supabase/client";
import { settleWithin } from "@/lib/bounded-load";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";

/** Brand shape used by PDF theme + Brand Settings (mirrors AccountantProfile). */
export type FirmBrandProfile = {
  firmName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  accountantName: string;
  accountantEmail: string;
  tagline: string | null;
};

const DEFAULT_BRAND: FirmBrandProfile = {
  firmName: "",
  logoUrl: null,
  primaryColor: "#102A43",
  secondaryColor: "#16213e",
  accentColor: "#0f3460",
  accountantName: "",
  accountantEmail: "",
  tagline: null,
};

/**
 * The old brand screen default. The column has no database default; rows and
 * browser caches still store this hex from before navy became the default.
 * It is not a chosen brand colour.
 */
export const LEGACY_DEFAULT_PRIMARY = "#1a1a2e";

export function brandPrimaryColor(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw || raw.toLowerCase() === LEGACY_DEFAULT_PRIMARY) return DEFAULT_BRAND.primaryColor;
  return raw;
}

const FIRM_SELECT =
  "id, name, owner_user_id, referral_code, logo_url, accent_color, primary_color, secondary_color, tagline, brand_contact_name, brand_contact_email, brand_updated_at, market";

export type FirmBrandRow = {
  id: string;
  name: string;
  owner_user_id: string;
  referral_code: string | null;
  logo_url: string | null;
  accent_color: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  tagline: string | null;
  brand_contact_name: string | null;
  brand_contact_email: string | null;
  brand_updated_at: string | null;
  /** Practice home market `{country, regionCode}`. Null until the firm picks one. */
  market?: unknown | null;
};

function activeFirmStorageKey(userId: string): string {
  return `milon_active_firm_id:${userId}`;
}

export function readActiveFirmId(userId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(activeFirmStorageKey(userId));
  } catch {
    return null;
  }
}

export function writeActiveFirmId(userId: string, firmId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(activeFirmStorageKey(userId), firmId);
  } catch {
    // storage quota / private browsing
  }
}

/**
 * All firms the user owns or is a member of (deduped, owned first by created_at).
 * `error` is set when a read failed. Callers that only need rows should use
 * listUserFirms, which still returns whatever rows were collected (often []).
 * Sign-in must not treat that [] as "this person has no firm".
 */
const FIRM_LIST_TTL_MS = 60_000;
const firmListCache = new Map<
  string,
  { at: number; value: { firms: FirmBrandRow[]; error: string | null } }
>();
const firmListInflight = new Map<string, Promise<{ firms: FirmBrandRow[]; error: string | null }>>();

export async function readUserFirms(
  userId: string,
  opts?: { fresh?: boolean },
): Promise<{
  firms: FirmBrandRow[];
  error: string | null;
}> {
  if (!opts?.fresh) {
    const hit = firmListCache.get(userId);
    if (hit && Date.now() - hit.at < FIRM_LIST_TTL_MS) return hit.value;
    const pending = firmListInflight.get(userId);
    if (pending) return pending;
  }
  // The in-flight entry is this promise, not the raw read. A hang used to
  // leave that entry in place, so the next call waited on the same promise.
  const tracked = (async () => {
    const settled = await settleWithin(readUserFirmsNow(userId), SHELL_GATE_TIMEOUT_MS);
    if (settled.status === "value") {
      if (!settled.value.error) firmListCache.set(userId, { at: Date.now(), value: settled.value });
      return settled.value;
    }
    if (settled.status === "timeout") return { firms: [], error: "timeout" };
    const message = settled.error instanceof Error ? settled.error.message : "firm list failed";
    return { firms: [], error: message || "firm list failed" };
  })().finally(() => {
    if (firmListInflight.get(userId) === tracked) firmListInflight.delete(userId);
  });
  firmListInflight.set(userId, tracked);
  return tracked;
}

async function readUserFirmsNow(userId: string): Promise<{
  firms: FirmBrandRow[];
  error: string | null;
}> {
  const byId = new Map<string, FirmBrandRow>();

  const [owned, mems] = await Promise.all([
    supabase
      .from("firms")
      .select(FIRM_SELECT)
      .eq("owner_user_id", userId)
      .order("created_at", { ascending: true }),
    supabase.from("firm_memberships").select("firm_id").eq("user_id", userId),
  ]);
  if (owned.error) return { firms: [], error: owned.error.message };
  for (const row of owned.data ?? []) {
    byId.set(row.id, row as FirmBrandRow);
  }

  if (mems.error) return { firms: Array.from(byId.values()), error: mems.error.message };
  const memberIds = (mems.data ?? [])
    .map((m) => m.firm_id)
    .filter((id): id is string => Boolean(id) && !byId.has(id));

  if (memberIds.length > 0) {
    const memberFirms = await supabase
      .from("firms")
      .select(FIRM_SELECT)
      .in("id", memberIds)
      .order("created_at", { ascending: true });
    if (memberFirms.error) {
      return { firms: Array.from(byId.values()), error: memberFirms.error.message };
    }
    for (const row of memberFirms.data ?? []) {
      byId.set(row.id, row as FirmBrandRow);
    }
  }

  return { firms: Array.from(byId.values()), error: null };
}

/** All firms the user owns or is a member of. Errors become an empty list. */
export async function listUserFirms(userId: string): Promise<FirmBrandRow[]> {
  const { firms } = await readUserFirms(userId);
  return firms;
}

/**
 * Resolve the active firm: preferred id if still accessible, else first owned,
 * else first membership (G27).
 */
export async function fetchUserFirm(
  userId: string,
  preferredFirmId?: string | null,
): Promise<FirmBrandRow | null> {
  const firms = await listUserFirms(userId);
  if (firms.length === 0) return null;
  if (preferredFirmId) {
    const preferred = firms.find((f) => f.id === preferredFirmId);
    if (preferred) return preferred;
  }
  return firms[0] ?? null;
}

/** Id of the firm this user is in, or null when they have none yet. */
export async function activeFirmIdForUser(userId: string): Promise<string | null> {
  const firm = await fetchUserFirm(userId, readActiveFirmId(userId));
  return firm?.id ?? null;
}

export function profileFromFirm(firm: FirmBrandRow): FirmBrandProfile {
  return {
    firmName: firm.name ?? "",
    logoUrl: firm.logo_url ?? null,
    primaryColor: brandPrimaryColor(firm.primary_color),
    secondaryColor: firm.secondary_color || DEFAULT_BRAND.secondaryColor,
    accentColor: firm.accent_color || DEFAULT_BRAND.accentColor,
    accountantName: firm.brand_contact_name ?? "",
    accountantEmail: firm.brand_contact_email ?? "",
    tagline: firm.tagline ?? null,
  };
}

/** True when the firm has never had brand fields filled (fresh row). */
export function firmBrandIsEmpty(firm: FirmBrandRow): boolean {
  return (
    !firm.logo_url &&
    !firm.accent_color &&
    !firm.primary_color &&
    !firm.secondary_color &&
    !firm.tagline &&
    !firm.brand_contact_name &&
    !firm.brand_contact_email
  );
}

export async function saveFirmBrand(
  firmId: string,
  profile: FirmBrandProfile,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("firms")
    .update({
      name: profile.firmName.trim() || "Practice",
      logo_url: profile.logoUrl,
      accent_color: profile.accentColor,
      primary_color: profile.primaryColor,
      secondary_color: profile.secondaryColor,
      tagline: profile.tagline,
      brand_contact_name: profile.accountantName || null,
      brand_contact_email: profile.accountantEmail || null,
      brand_updated_at: new Date().toISOString(),
    })
    .eq("id", firmId);

  return { error: error?.message ?? null };
}

const LOGO_BUCKET = "firm-logos";

function extForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/svg+xml") return "svg";
  return "bin";
}

/**
 * Upload a logo to storage and return its public URL.
 * Falls back to a data URL string when storage is unavailable.
 */
export async function uploadFirmLogo(
  firmId: string,
  file: File,
): Promise<{ url: string; error: string | null }> {
  const ext = extForMime(file.type);
  const path = `${firmId}/logo.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type, cacheControl: "3600" });

  if (!upErr) {
    const { data } = supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
    const url = `${data.publicUrl}?v=${Date.now()}`;
    return { url, error: null };
  }

  // Fallback: embed as data URL so brand still works before storage is migrated.
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read logo file"));
    };
    reader.onerror = () => reject(new Error("Could not read logo file"));
    reader.readAsDataURL(file);
  });
  return {
    url: dataUrl,
    error: `Storage upload failed (${upErr.message}); saved as embedded logo instead.`,
  };
}

export async function removeFirmLogo(firmId: string, logoUrl: string | null): Promise<void> {
  if (logoUrl && !logoUrl.startsWith("data:")) {
    try {
      const marker = `/object/public/${LOGO_BUCKET}/`;
      const idx = logoUrl.indexOf(marker);
      if (idx >= 0) {
        const pathWithQuery = logoUrl.slice(idx + marker.length);
        const path = decodeURIComponent(pathWithQuery.split("?")[0] ?? "");
        if (path.startsWith(`${firmId}/`)) {
          await supabase.storage.from(LOGO_BUCKET).remove([path]);
        }
      }
    } catch {
      // non-fatal
    }
  }
}
