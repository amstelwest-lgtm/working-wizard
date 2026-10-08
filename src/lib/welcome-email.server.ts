/**
 * Server-side welcome send. Uses the same Resend helper as firm staff invites
 * (`sendAccessEmail`: RESEND_API_KEY + RESEND_FROM_EMAIL). Never throws.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { inviteSiteUrl } from "@/lib/client-invite-email";
import { sendAccessEmail } from "@/lib/practice-access-email";
import {
  runWelcomeDelivery,
  welcomeAppPath,
  type WelcomeAudience,
  type WelcomeCandidate,
  type WelcomeDeliveryResult,
} from "@/lib/welcome-email";

function metaString(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

async function loadWelcomeCandidate(userId: string): Promise<WelcomeCandidate> {
  const [authRes, profileRes, firmRes, memberRes, clientRes] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(userId),
    supabaseAdmin
      .from("profiles")
      .select(
        "full_name, email, welcome_email_sent_at, welcome_email_attempts, welcome_email_last_attempt_at",
      )
      .eq("id", userId)
      .maybeSingle(),
    supabaseAdmin.from("firms").select("id").eq("owner_user_id", userId).limit(1),
    supabaseAdmin.from("firm_memberships").select("role").eq("user_id", userId),
    supabaseAdmin.from("clients").select("id").eq("owner_user_id", userId).limit(1),
  ]);

  if (authRes.error) throw new Error(authRes.error.message);
  const user = authRes.data.user;
  if (!user) throw new Error("user missing");
  if (profileRes.error) throw new Error(profileRes.error.message);
  if (firmRes.error) throw new Error(firmRes.error.message);
  if (memberRes.error) throw new Error(memberRes.error.message);
  if (clientRes.error) throw new Error(clientRes.error.message);
  if (!profileRes.data) throw new Error("profile missing");

  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const profile = profileRes.data;
  const roles = (memberRes.data ?? []).map((row) => (row.role ?? "").trim()).filter(Boolean);
  const firmMembershipRole =
    roles.find((role) => role.toLowerCase() === "owner") ?? roles[0] ?? null;

  return {
    userId,
    email: (profile.email ?? user.email ?? "").trim(),
    fullName:
      profile.full_name?.trim() || metaString(meta, "full_name") || metaString(meta, "name"),
    createdAt: user.created_at ?? null,
    signupType: metaString(meta, "signup_type"),
    inviteClientId: metaString(meta, "invite_client_id"),
    inviteOutcome: metaString(meta, "invite_outcome"),
    ownsFirm: (firmRes.data?.length ?? 0) > 0,
    firmMembershipRole,
    ownsClient: (clientRes.data?.length ?? 0) > 0,
    sentAt: profile.welcome_email_sent_at,
    attempts: profile.welcome_email_attempts ?? 0,
    lastAttemptAt: profile.welcome_email_last_attempt_at,
  };
}

export async function sendSignupWelcomeForUser(
  userId: string,
  now = new Date(),
): Promise<WelcomeDeliveryResult> {
  try {
    const candidate = await loadWelcomeCandidate(userId);
    return await runWelcomeDelivery({
      candidate,
      now,
      appUrlFor: (audience: WelcomeAudience) => `${inviteSiteUrl()}${welcomeAppPath(audience)}`,
      claimAttempt: async () => {
        const { data, error } = await supabaseAdmin
          .from("profiles")
          .update({
            welcome_email_attempts: candidate.attempts + 1,
            welcome_email_last_attempt_at: now.toISOString(),
          })
          .eq("id", userId)
          .eq("welcome_email_attempts", candidate.attempts)
          .is("welcome_email_sent_at", null)
          .select("id");
        if (error) throw new Error(error.message);
        return (data?.length ?? 0) > 0;
      },
      markSent: async (sentAt) => {
        const { error } = await supabaseAdmin
          .from("profiles")
          .update({ welcome_email_sent_at: sentAt })
          .eq("id", userId);
        if (error) throw new Error(error.message);
      },
      send: (mail) =>
        sendAccessEmail({
          to: mail.to,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          idempotencyKey: mail.idempotencyKey,
        }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[welcome-email] send failed", {
      status: "error",
      message: message.slice(0, 500),
    });
    return { outcome: "failed", reason: message };
  }
}
