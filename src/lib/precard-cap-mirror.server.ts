/**
 * Edge functions read firms.precard_cap_applies. They do not call Stripe.
 * Vercel writes the flag from the live subscription phase. A missing column
 * or a failed write leaves the row untouched so the edge check fails open.
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";

export async function writePrecardCapApplies(firmId: string, applies: boolean): Promise<void> {
  const id = firmId.trim();
  if (!id) return;
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return;
    const { error } = await admin.from("firms").update({ precard_cap_applies: applies }).eq("id", id);
    if (error && !/precard_cap_applies/i.test(error.message)) {
      console.warn("[precard-cap] mirror write failed", error.message);
    }
  } catch (err) {
    console.warn("[precard-cap] mirror write failed", err instanceof Error ? err.message : err);
  }
}
