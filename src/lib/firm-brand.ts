import { supabase } from "@/integrations/supabase/client";

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
  primaryColor: "#1a1a2e",
  secondaryColor: "#16213e",
  accentColor: "#0f3460",
  accountantName: "",
  accountantEmail: "",
  tagline: null,
};

export type FirmBrandRow = {
  id: string;
  name: string;
  owner_user_id: string;
  logo_url: string | null;
  accent_color: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  tagline: string | null;
  brand_contact_name: string | null;
  brand_contact_email: string | null;
  brand_updated_at: string | null;
};

/** Resolve the current user's firm (owned first, else first membership). */
export async function fetchUserFirm(userId: string): Promise<FirmBrandRow | null> {
  const { data: owned } = await supabase
    .from("firms")
    .select(
      "id, name, owner_user_id, logo_url, accent_color, primary_color, secondary_color, tagline, brand_contact_name, brand_contact_email, brand_updated_at",
    )
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (owned) return owned as FirmBrandRow;

  const { data: mem } = await supabase
    .from("firm_memberships")
    .select("firm_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (!mem?.firm_id) return null;

  const { data: firm } = await supabase
    .from("firms")
    .select(
      "id, name, owner_user_id, logo_url, accent_color, primary_color, secondary_color, tagline, brand_contact_name, brand_contact_email, brand_updated_at",
    )
    .eq("id", mem.firm_id)
    .maybeSingle();
  return (firm as FirmBrandRow | null) ?? null;
}

export function profileFromFirm(firm: FirmBrandRow): FirmBrandProfile {
  return {
    firmName: firm.name ?? "",
    logoUrl: firm.logo_url ?? null,
    primaryColor: firm.primary_color || DEFAULT_BRAND.primaryColor,
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
