/**
 * Opt-out handling for Milōn Lighthouse cold outreach.
 *
 * Cold email carries a real, working unsubscribe: a human link in the footer
 * and an RFC 8058 one-click List-Unsubscribe header. Both land here.
 *
 * Opting out does three things, all of them permanent from the prospect's
 * point of view: the lead is marked do-not-contact, every unsent touch is
 * skipped so no queued draft can slip out, and the address joins the platform
 * suppression list so no other Milōn email reaches them either.
 */

import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import type { LooseAdmin } from "@/lib/owner-ops.guard";

export type OptOutLookup =
  | { found: false }
  | { found: true; alreadyOptedOut: boolean; company: string | null };

function admin(): LooseAdmin | null {
  const client = getSupabaseAdminOrNull();
  return client ? (client as unknown as LooseAdmin) : null;
}

function normaliseToken(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, 64);
}

export async function lookupLighthouseOptOut(rawToken: string): Promise<OptOutLookup> {
  const token = normaliseToken(rawToken);
  if (token.length < 6) return { found: false };

  const client = admin();
  if (!client) return { found: false };

  const { data, error } = await client
    .from("milon_ops_leads")
    .select("id, company, do_not_contact")
    .eq("optout_token", token)
    .maybeSingle();

  if (error || !data) return { found: false };
  return {
    found: true,
    alreadyOptedOut: Boolean((data as { do_not_contact?: boolean }).do_not_contact),
    company: ((data as { company?: string | null }).company ?? null) || null,
  };
}

export async function applyLighthouseOptOut(
  rawToken: string,
  source: "one_click" | "link" | "manual",
): Promise<{ ok: boolean; alreadyOptedOut: boolean }> {
  const token = normaliseToken(rawToken);
  if (token.length < 6) return { ok: false, alreadyOptedOut: false };

  const client = admin();
  if (!client) return { ok: false, alreadyOptedOut: false };

  const { data: lead, error } = await client
    .from("milon_ops_leads")
    .select("id, email, stage, do_not_contact")
    .eq("optout_token", token)
    .maybeSingle();

  if (error || !lead) return { ok: false, alreadyOptedOut: false };

  const row = lead as {
    id: string;
    email: string | null;
    stage: string | null;
    do_not_contact: boolean | null;
  };
  if (row.do_not_contact) return { ok: true, alreadyOptedOut: true };

  const now = new Date().toISOString();
  const earlyStage = ["sourced", "researched", "contacted", "nurture"].includes(
    row.stage ?? "sourced",
  );

  await client
    .from("milon_ops_leads")
    .update({
      do_not_contact: true,
      optout_at: now,
      optout_source: source,
      next_touch_on: null,
      lost_reason: "unsubscribed",
      ...(earlyStage ? { stage: "lost" } : {}),
    })
    .eq("id", row.id);

  // Anything drafted or approved but not yet sent must never go out.
  await client
    .from("lighthouse_touches")
    .update({ status: "skipped", error: "Lead unsubscribed before this touch was sent." })
    .eq("lead_id", row.id)
    .in("status", ["draft", "approved"]);

  if (row.email) {
    await client
      .from("suppressed_emails")
      .upsert({ email: row.email.toLowerCase(), reason: "unsubscribe" }, { onConflict: "email" });
  }

  return { ok: true, alreadyOptedOut: false };
}
