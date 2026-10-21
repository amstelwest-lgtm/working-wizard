/**
 * DB reads for the Add client cap shortcut.
 * Service role matches the cap check. Without it the counts are not trusted
 * and the create path uses the live Stripe allowance.
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import { collapseDuplicateClientShells } from "@/lib/client-display-name";
import type { StoredCreateEntitlement } from "@/lib/firm-client-create-gate";

const FIRM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type FirmPlanRow = {
  billing_plan_known?: string | null;
  starter_trial_generation_blocked?: boolean | null;
};

/**
 * The trial-mirror column is on the firm row. Generated types omit it, so this
 * select is typed by hand. A missing column comes back as an error and the
 * create path uses live Stripe.
 */
type FirmPlanQuery = {
  select: (columns: string) => {
    eq: (
      column: string,
      value: string,
    ) => {
      maybeSingle: () => Promise<{
        data: FirmPlanRow | null;
        error: { message: string } | null;
      }>;
    };
  };
};

export async function readStoredCreateEntitlement(
  firmId: string | null | undefined,
): Promise<StoredCreateEntitlement | null> {
  const id = firmId?.trim() ?? "";
  if (!FIRM_UUID.test(id)) return null;
  const admin = getSupabaseAdminOrNull();
  if (!admin) return null;
  const { data, error } = await (admin.from("firms") as unknown as FirmPlanQuery)
    .select("billing_plan_known, starter_trial_generation_blocked")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const rawPlan = data.billing_plan_known;
  const plan = rawPlan === "entitled" || rawPlan === "none" ? rawPlan : null;
  const rawTrial = data.starter_trial_generation_blocked;
  const trialBlocked = typeof rawTrial === "boolean" ? rawTrial : null;
  return { plan, trialBlocked };
}

/**
 * Same set the live cap counts: non-demo rows, empty same-name shells collapsed.
 * Null means the count was not read. The caller must not treat that as zero.
 */
export async function countFirmClientsForCreate(
  firmId: string | null | undefined,
): Promise<number | null> {
  const id = firmId?.trim() ?? "";
  if (!FIRM_UUID.test(id)) return null;
  const admin = getSupabaseAdminOrNull();
  if (!admin) return null;
  const { data, error } = await admin
    .from("clients")
    .select("id, name, created_at, financials, cashflow")
    .eq("firm_id", id)
    .eq("is_demo", false);
  if (error || !data) return null;
  const rows = (
    data as Array<{
      id?: string | null;
      name?: string | null;
      created_at?: string | null;
      financials?: unknown;
      cashflow?: unknown;
    }>
  ).flatMap((row) => {
    const clientId = row?.id ? String(row.id) : "";
    if (!clientId) return [];
    return [
      {
        id: clientId,
        name: String(row?.name ?? ""),
        created_at: row?.created_at ?? null,
        financials: row?.financials,
        cashflow: row?.cashflow,
      },
    ];
  });
  return collapseDuplicateClientShells(rows).length;
}
