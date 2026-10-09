import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";

type PaidInvoice = {
  id?: string | null;
  currency?: string | null;
  amount_paid?: number | null;
  status?: string | null;
  status_transitions?: { paid_at?: number | null } | null;
};

/**
 * Rolling SA revenue reads this table. A missing table or a failed write
 * must not fail the webhook. No secrets in the log line.
 */
export async function recordPaidZarInvoice(invoice: PaidInvoice | null | undefined): Promise<void> {
  const id = invoice?.id?.trim() ?? "";
  const currency = (invoice?.currency ?? "").trim().toLowerCase();
  if (!id || currency !== "zar" || invoice?.status !== "paid") return;
  const amount = invoice.amount_paid;
  if (typeof amount !== "number" || amount < 0) return;
  const paidUnix = invoice.status_transitions?.paid_at;
  const paidAt =
    typeof paidUnix === "number" && paidUnix > 0
      ? new Date(paidUnix * 1000).toISOString()
      : new Date().toISOString();
  try {
    const admin = getSupabaseAdminOrNull();
    if (!admin) return;
    const { error } = await admin.from("stripe_invoice_payments").upsert({
      id,
      currency: "zar",
      amount_paid_cents: amount,
      paid_at: paidAt,
      status: "paid",
    });
    if (error) console.warn("[stripe] zar revenue row skipped");
  } catch {
    console.warn("[stripe] zar revenue row skipped");
  }
}
