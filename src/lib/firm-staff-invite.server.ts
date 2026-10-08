/**
 * Firm staff invite rotation. Server-only: mints tokens with node:crypto.
 * Called from practice-access.functions.ts inside the server-fn handler.
 */
import { createHash, randomBytes } from "node:crypto";
import type { LooseAdmin } from "@/lib/owner-ops.guard";
import {
  MEMBERSHIP_LABELS,
  parseClassification,
  parseMembershipRole,
  type MembershipRole,
  type PracticeClassification,
} from "@/lib/practice-access";
import { accessApproveUrl, firmInviteEmail, sendAccessEmail } from "@/lib/practice-access-email";

/** Fresh staff-invite links stay valid for two weeks. */
export const STAFF_INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function newToken(): string {
  return randomBytes(24).toString("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function profileById(
  admin: LooseAdmin,
  userId: string,
): Promise<{ email: string; name: string }> {
  const { data } = await admin.from("profiles").select("email, full_name").eq("id", userId).maybeSingle();
  const email = String(data?.email ?? "").trim().toLowerCase();
  const name = String(data?.full_name ?? "").trim();
  if (email) return { email, name: name || email.split("@")[0] };
  try {
    const { data: auth } = await admin.auth.admin.getUserById(userId);
    const authEmail = (auth.user?.email ?? "").trim().toLowerCase();
    return { email: authEmail, name: name || authEmail.split("@")[0] || "User" };
  } catch {
    return { email: "", name: name || "User" };
  }
}

async function membershipOf(
  admin: LooseAdmin,
  firmId: string,
  userId: string,
): Promise<{ role: MembershipRole; classification: PracticeClassification; isOwner: boolean }> {
  const { data: firm } = await admin.from("firms").select("owner_user_id").eq("id", firmId).maybeSingle();
  const isOwner = String(firm?.owner_user_id ?? "") === userId;
  const { data: mem } = await admin
    .from("firm_memberships")
    .select("role, classification")
    .eq("firm_id", firmId)
    .eq("user_id", userId)
    .maybeSingle();
  const role = isOwner ? "owner" : parseMembershipRole(mem?.role);
  return {
    role,
    classification: parseClassification(mem?.classification),
    isOwner,
  };
}

function canManage(role: MembershipRole, isOwner: boolean): boolean {
  return isOwner || role === "owner" || role === "admin";
}

async function assertManager(admin: LooseAdmin, userId: string, firmId: string): Promise<void> {
  const m = await membershipOf(admin, firmId, userId);
  if (!canManage(m.role, m.isOwner)) {
    throw new Error("Only the practice owner or a firm admin can manage team access.");
  }
}

async function writeAudit(
  admin: LooseAdmin,
  row: {
    actorId: string;
    action: string;
    firmId?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin.from("audit_log").insert({
    actor_id: row.actorId,
    action: row.action,
    firm_id: row.firmId ?? null,
    client_id: null,
    subject_user_id: null,
    details: row.details ?? {},
  });
  if (error) {
    const viaRpc = await admin.rpc("write_audit_log", {
      _action: row.action,
      _firm_id: row.firmId ?? null,
      _client_id: null,
      _subject_user_id: null,
      _details: row.details ?? {},
      _actor_id: row.actorId,
    });
    if (viaRpc.error) {
      console.warn("audit_log write failed", error.message, viaRpc.error.message);
    }
  }
}

export async function rotateFirmStaffInviteLink(
  admin: LooseAdmin,
  opts: {
    actorId: string;
    inviteId: string;
    sendEmail: boolean;
    now?: Date;
    mintToken?: () => string;
    send?: typeof sendAccessEmail;
  },
): Promise<{ inviteUrl: string; emailed: boolean; error: string | null }> {
  const { data: invite, error: inviteErr } = await admin
    .from("firm_staff_invites")
    .select("id, firm_id, email, name, membership_role, classification, accepted_at")
    .eq("id", opts.inviteId)
    .maybeSingle();
  if (inviteErr) throw new Error(inviteErr.message);
  if (!invite) throw new Error("Invitation not found.");
  if (invite.accepted_at) throw new Error("This invitation was already accepted.");

  const firmId = String(invite.firm_id);
  await assertManager(admin, opts.actorId, firmId);

  const now = opts.now ?? new Date();
  const token = (opts.mintToken ?? newToken)();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(now.getTime() + STAFF_INVITE_TTL_MS).toISOString();
  const email = String(invite.email ?? "").trim().toLowerCase();

  const { data: tokenRows, error: tokenReadErr } = await admin
    .from("access_approval_tokens")
    .select("id")
    .eq("invite_id", invite.id)
    .eq("purpose", "firm_invite");
  if (tokenReadErr) throw new Error(tokenReadErr.message);

  const tokenIds = ((tokenRows ?? []) as Array<{ id?: string }>)
    .map((row) => String(row.id ?? ""))
    .filter(Boolean);
  if (tokenIds.length === 0) {
    const { error: insErr } = await admin.from("access_approval_tokens").insert({
      purpose: "firm_invite",
      email,
      invite_id: invite.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      used_at: null,
    });
    if (insErr) throw new Error(insErr.message);
  } else {
    const [keep, ...rest] = tokenIds;
    const { error: upErr } = await admin
      .from("access_approval_tokens")
      .update({ token_hash: tokenHash, expires_at: expiresAt, used_at: null })
      .eq("id", keep);
    if (upErr) throw new Error(upErr.message);
    for (const extra of rest) {
      const { error: delErr } = await admin.from("access_approval_tokens").delete().eq("id", extra);
      if (delErr) throw new Error(delErr.message);
    }
  }

  const { error: hashErr } = await admin
    .from("firm_staff_invites")
    .update({ token_hash: tokenHash, expires_at: expiresAt })
    .eq("id", invite.id)
    .eq("firm_id", firmId);
  if (hashErr) throw new Error(hashErr.message);

  const inviteUrl = accessApproveUrl(token);
  if (!opts.sendEmail) return { inviteUrl, emailed: false, error: null };

  const { data: firmRow } = await admin.from("firms").select("name").eq("id", firmId).maybeSingle();
  const inviter = await profileById(admin, opts.actorId);
  const mail = firmInviteEmail({
    recipientName: String(invite.name ?? "").trim() || email.split("@")[0],
    firmName: String(firmRow?.name ?? "Practice"),
    inviterName: inviter.name,
    roleLabel: MEMBERSHIP_LABELS[parseMembershipRole(invite.membership_role)],
    url: inviteUrl,
  });
  const send = opts.send ?? sendAccessEmail;
  const sent = await send({
    to: email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    idempotencyKey: `firm-invite-${invite.id}-${tokenHash.slice(0, 16)}`,
  });
  if (!sent.ok) console.error("rotateFirmStaffInviteLink email failed", { error: sent.error });
  await writeAudit(admin, {
    actorId: opts.actorId,
    action: "member_invited",
    firmId,
    details: { email, rotated: true, emailed: sent.ok },
  });
  return { inviteUrl, emailed: sent.ok, error: sent.ok ? null : sent.error };
}

export async function revokeFirmStaffInviteRecord(
  admin: LooseAdmin,
  opts: { actorId: string; inviteId: string },
): Promise<{ ok: true }> {
  const { data: invite, error } = await admin
    .from("firm_staff_invites")
    .select("id, firm_id, email, accepted_at")
    .eq("id", opts.inviteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!invite) throw new Error("Invitation not found.");
  if (invite.accepted_at) throw new Error("This invitation was already accepted.");
  const firmId = String(invite.firm_id);
  await assertManager(admin, opts.actorId, firmId);
  const { error: tokenErr } = await admin.from("access_approval_tokens").delete().eq("invite_id", invite.id);
  if (tokenErr) throw new Error(tokenErr.message);
  const { error: delErr } = await admin
    .from("firm_staff_invites")
    .delete()
    .eq("id", invite.id)
    .eq("firm_id", firmId);
  if (delErr) throw new Error(delErr.message);
  await writeAudit(admin, {
    actorId: opts.actorId,
    action: "member_removed",
    firmId,
    details: { email: invite.email, invite: true },
  });
  return { ok: true as const };
}
