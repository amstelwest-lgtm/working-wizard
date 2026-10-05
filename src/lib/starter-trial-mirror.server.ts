/**
 * Writes the Starter-trial generation mirror. Edge functions read this
 * column. They do not call Stripe. A missing column or a failed write
 * leaves the row untouched so the edge check fails open.
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";

export async function writeStarterTrialGenerationBlock(
  firmId: string,
  blocked: boolean,
): Promise<void> {
  const id = firmId.trim();
  if (!id) return;
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return;
    const { error } = await admin
      .from("firms")
      .update({ starter_trial_generation_blocked: blocked })
      .eq("id", id);
    if (error && !/starter_trial_generation_blocked/i.test(error.message)) {
      console.warn("[starter-trial] mirror write failed", error.message);
    }
  } catch (err) {
    console.warn(
      "[starter-trial] mirror write failed",
      err instanceof Error ? err.message : err,
    );
  }
}
