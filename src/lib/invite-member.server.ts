/**
 * Core invite-member signup logic, extracted so it can be exercised both from
 * the adminSignUp server function and from integration tests without needing to
 * go through the TanStack Start HTTP framing layer.
 *
 * Two invite outcomes (G25):
 *   A) Firm-created client (current owner is a practice placeholder) →
 *      transfer clients.owner_user_id to the invitee, keep firm_id, promote
 *      invitee to client_owner so Action Plan / owner UI gates work.
 *   B) True client owner inviting staff → membership only as client_member;
 *      ownership stays put.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type InviteMemberInput = {
  email: string;
  password: string;
  fullName?: string;
  inviteClientId: string;
};

export type InviteMemberResult = {
  userId: string;
  email: string;
  /** True when invitee became clients.owner_user_id (firm handoff). */
  transferredOwnership: boolean;
};

/** Current owner is a firm / practice placeholder for this client (not the real business owner). */
async function isPracticePlaceholderOwner(
  ownerUserId: string,
  firmId: string | null,
): Promise<boolean> {
  if (firmId) {
    const { data: firm } = await supabaseAdmin
      .from("firms")
      .select("owner_user_id")
      .eq("id", firmId)
      .maybeSingle();
    if (firm?.owner_user_id === ownerUserId) return true;

    const { data: membership } = await supabaseAdmin
      .from("firm_memberships")
      .select("user_id")
      .eq("firm_id", firmId)
      .eq("user_id", ownerUserId)
      .maybeSingle();
    if (membership?.user_id) return true;
  }

  // N20: firm_id may be null on older firm-created clients. Still treat as a
  // practice placeholder when the current owner holds a practice role or owns /
  // belongs to any firm — so invite still hands ownership to the real owner.
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", ownerUserId);
  const roleList = (roles ?? []).map((r: { role: string }) => r.role);
  if (roleList.includes("accountant") || roleList.includes("firm_admin")) return true;

  const { data: ownedFirm } = await supabaseAdmin
    .from("firms")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .limit(1)
    .maybeSingle();
  if (ownedFirm?.id) return true;

  const { data: anyMembership } = await supabaseAdmin
    .from("firm_memberships")
    .select("user_id")
    .eq("user_id", ownerUserId)
    .limit(1)
    .maybeSingle();
  return Boolean(anyMembership?.user_id);
}

/**
 * Sign up via invite link.
 *
 * Steps:
 *   1. Create the auth user with email_confirm:true so no email link is needed.
 *   2. Decide ownership handoff vs staff membership (see module doc).
 *   3. Upsert client_memberships + user_roles accordingly.
 *   4. When handing off, UPDATE clients.owner_user_id via service role
 *      (trigger allows auth.uid() IS NULL); leave firm_id unchanged.
 */
export async function signUpInvitedMember(
  input: InviteMemberInput,
): Promise<InviteMemberResult> {
  const { data: client, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("id, owner_user_id, firm_id")
    .eq("id", input.inviteClientId)
    .maybeSingle();
  if (clientErr) throw new Error(`Failed to load invite client: ${clientErr.message}`);
  if (!client) throw new Error("Invite link is invalid — client not found.");

  const shouldTransfer = await isPracticePlaceholderOwner(
    client.owner_user_id,
    client.firm_id,
  );
  const role = shouldTransfer ? "client_owner" : "client_member";

  const { data: authData, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName?.trim() ?? "",
      signup_type: "customer",
      invite_client_id: input.inviteClientId,
      invite_outcome: shouldTransfer ? "owner_handoff" : "staff_member",
    },
  });

  if (error) throw new Error(error.message);
  if (!authData.user) throw new Error("User creation failed");

  const userId = authData.user.id;

  if (shouldTransfer) {
    const { error: ownErr } = await supabaseAdmin
      .from("clients")
      .update({ owner_user_id: userId })
      .eq("id", input.inviteClientId);
    if (ownErr) {
      // Roll back auth user so a retry can succeed cleanly.
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(`Ownership handoff failed: ${ownErr.message}`);
    }
  }

  const { error: memErr } = await supabaseAdmin
    .from("client_memberships")
    .upsert(
      { client_id: input.inviteClientId, user_id: userId, role },
      { onConflict: "client_id,user_id" },
    );
  if (memErr) {
    if (shouldTransfer) {
      // Best-effort revert ownership so the accountant remains writer.
      await supabaseAdmin
        .from("clients")
        .update({ owner_user_id: client.owner_user_id })
        .eq("id", input.inviteClientId);
    }
    await supabaseAdmin.auth.admin.deleteUser(userId);
    throw new Error(`client_memberships upsert failed: ${memErr.message}`);
  }

  // user_roles has UNIQUE(user_id, role) not UNIQUE(user_id).
  // Delete any existing row so the invitee ends with exactly one role entry.
  await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
  const { error: roleErr } = await supabaseAdmin
    .from("user_roles")
    .insert({ user_id: userId, role });
  if (roleErr) {
    await supabaseAdmin.auth.admin.deleteUser(userId);
    throw new Error(`user_roles insert failed: ${roleErr.message}`);
  }

  return {
    userId,
    email: authData.user.email ?? input.email,
    transferredOwnership: shouldTransfer,
  };
}
