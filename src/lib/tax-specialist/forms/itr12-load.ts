/**
 * Open an ITR12 from Work → Tax. A current draft wins. Otherwise the latest
 * tax pack is mapped onto an unsaved seed. Nothing is emailed.
 */
import { supabase } from "@/integrations/supabase/client";
import { TAX_PACK_KIND } from "@/lib/tax-deliverable";
import type { TaxFormDraft } from "./drafts.ts";
import {
  emptyItr12Inputs,
  findItr12Draft,
  itr12FromTaxPackBody,
  itr12YearOfAssessment,
  type Itr12Inputs,
} from "./itr12.ts";

export async function loadItr12Open(
  clientId: string,
  drafts: readonly TaxFormDraft[],
  today: string,
): Promise<{ year: number; seed: Itr12Inputs | null }> {
  let body: string | null = null;
  if (clientId.trim()) {
    const { data, error } = await supabase
      .from("deliverable_drafts")
      .select("body, status")
      .eq("client_id", clientId)
      .eq("kind", TAX_PACK_KIND)
      .order("created_at", { ascending: false })
      .limit(8);
    if (!error && Array.isArray(data)) {
      const row = data.find(
        (item) =>
          item.status !== "discarded" && typeof item.body === "string" && item.body.trim(),
      );
      body = row && typeof row.body === "string" ? row.body : null;
    }
  }
  const parsed = body ? itr12FromTaxPackBody(body) : null;
  const year = parsed?.year ?? itr12YearOfAssessment(today);
  if (findItr12Draft(drafts, year)) return { year, seed: null };
  return { year, seed: parsed?.inputs ?? emptyItr12Inputs() };
}
