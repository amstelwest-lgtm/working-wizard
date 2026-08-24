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
import {
  attachInviteRedeemer,
  claimInviteToken,
  clientCodesMatch,
  releaseInviteToken,
  resolveInviteToClientId,
} from "@/lib/invite-tokens.resolve";

export type InviteMemberInput = {
  email: string;
  password: string;
  fullName?: string;
  /** Opaque invite token or legacy client UUID. */
  inviteClientId: string;
  /** Required when the client has a client_code (MLN-XXXXXX). */
  inviteClientCode?: string | null;
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
export async function signUpInvitedMember(input: InviteMemberInput): Promise<InviteMemberResult> {
  const resolved = await resolveInviteToClientId(input.inviteClientId);
  const clientId = resolved.clientId;

  let client: {
    id: string;
    owner_user_id: string;
    firm_id: string | null;
    client_code?: string | null;
  } | null = null;

  const first = await supabaseAdmin
    .from("clients")
    .select("id, owner_user_id, firm_id, client_code")
    .eq("id", clientId)
    .maybeSingle();
  if (first.error && (first.error.message ?? "").includes("client_code")) {
    const retry = await supabaseAdmin
      .from("clients")
      .select("id, owner_user_id, firm_id")
      .eq("id", clientId)
      .maybeSingle();
    if (retry.error) throw new Error(`Failed to load invite client: ${retry.error.message}`);
    client = retry.data ? { ...retry.data, client_code: null } : null;
  } else if (first.error) {
    throw new Error(`Failed to load invite client: ${first.error.message}`);
  } else {
    client = first.data;
  }
  if (!client) throw new Error("Invite link is invalid — client not found.");

  const storedCode = client.client_code ?? null;
  if (storedCode) {
    if (!input.inviteClientCode?.trim()) {
      throw new Error("Enter the client code from your accountant (MLN-XXXXXX).");
    }
    if (!clientCodesMatch(storedCode, input.inviteClientCode)) {
      throw new Error("That client code does not match this invite. Check the email and try again.");
    }
  }

  const shouldTransfer = await isPracticePlaceholderOwner(client.owner_user_id, client.firm_id);
  const role = shouldTransfer ? "client_owner" : "client_member";

  // Claim before createUser so concurrent signups can't both succeed.
  await claimInviteToken(resolved.tokenId);

  const { data: authData, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName?.trim() ?? "",
      signup_type: "customer",
      invite_client_id: clientId,
      invite_outcome: shouldTransfer ? "owner_handoff" : "staff_member",
    },
  });

  if (error) {
    await releaseInviteToken(resolved.tokenId);
    throw new Error(error.message);
  }
  if (!authData.user) {
    await releaseInviteToken(resolved.tokenId);
    throw new Error("User creation failed");
  }

  const userId = authData.user.id;

  if (shouldTransfer) {
    const { error: ownErr } = await supabaseAdmin
      .from("clients")
      .update({ owner_user_id: userId })
      .eq("id", clientId);
    if (ownErr) {
      await releaseInviteToken(resolved.tokenId);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(`Ownership handoff failed: ${ownErr.message}`);
    }
  }

  const { error: memErr } = await supabaseAdmin
    .from("client_memberships")
    .upsert({ client_id: clientId, user_id: userId, role }, { onConflict: "client_id,user_id" });
  if (memErr) {
    if (shouldTransfer) {
      await supabaseAdmin
        .from("clients")
        .update({ owner_user_id: client.owner_user_id })
        .eq("id", clientId);
    }
    await releaseInviteToken(resolved.tokenId);
    await supabaseAdmin.auth.admin.deleteUser(userId);
    throw new Error(`client_memberships upsert failed: ${memErr.message}`);
  }

  await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
  const { error: roleErr } = await supabaseAdmin
    .from("user_roles")
    .insert({ user_id: userId, role });
  if (roleErr) {
    if (shouldTransfer) {
      await supabaseAdmin
        .from("clients")
        .update({ owner_user_id: client.owner_user_id })
        .eq("id", clientId);
    }
    await releaseInviteToken(resolved.tokenId);
    await supabaseAdmin.auth.admin.deleteUser(userId);
    throw new Error(`user_roles insert failed: ${roleErr.message}`);
  }

  await attachInviteRedeemer(resolved.tokenId, userId);

  return {
    userId,
    email: authData.user.email ?? input.email,
    transferredOwnership: shouldTransfer,
  };
}
