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
 *
 * New accounts go through signUpInvitedMember (createUser + attach).
 * Existing accounts (already signed in, password sign-in, or Google) go through
 * acceptOwnerInviteForUser so the token is claimed without createUser.
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

export type AcceptOwnerInviteInput = {
  userId: string;
  email?: string | null;
  /** Opaque invite token or legacy client UUID. */
  inviteClientId: string;
  inviteClientCode?: string | null;
};

export type InviteMemberResult = {
  userId: string;
  email: string;
  /** Resolved client UUID (never the opaque invite token). */
  clientId: string;
  /** True when invitee became clients.owner_user_id (firm handoff). */
  transferredOwnership: boolean;
};

type InviteClientRow = {
  id: string;
  owner_user_id: string;
  firm_id: string | null;
  client_code?: string | null;
};

type PreparedInvite = {
  tokenId: string | null;
  client: InviteClientRow;
  shouldTransfer: boolean;
  role: "client_owner" | "client_member";
  alreadyRedeemedByCaller: boolean;
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

async function loadInviteClient(clientId: string): Promise<InviteClientRow> {
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
    if (!retry.data) throw new Error("Invite link is invalid — client not found.");
    return { ...retry.data, client_code: null };
  }
  if (first.error) throw new Error(`Failed to load invite client: ${first.error.message}`);
  if (!first.data) throw new Error("Invite link is invalid — client not found.");
  return first.data;
}

function assertClientCode(client: InviteClientRow, inviteClientCode?: string | null) {
  const storedCode = client.client_code ?? null;
  if (!storedCode) return;
  if (!inviteClientCode?.trim()) {
    throw new Error("Enter the client code from your accountant (MLN-XXXXXX).");
  }
  if (!clientCodesMatch(storedCode, inviteClientCode)) {
    throw new Error("That client code does not match this invite. Check the email and try again.");
  }
}

async function prepareInvite(
  inviteClientId: string,
  inviteClientCode?: string | null,
  redeemedByUserId?: string,
): Promise<PreparedInvite> {
  const resolved = await resolveInviteToClientId(inviteClientId, { redeemedByUserId });
  const client = await loadInviteClient(resolved.clientId);
  assertClientCode(client, inviteClientCode);
  const shouldTransfer = await isPracticePlaceholderOwner(client.owner_user_id, client.firm_id);
  const role = shouldTransfer ? "client_owner" : "client_member";
  return {
    tokenId: resolved.tokenId,
    client,
    shouldTransfer,
    role,
    alreadyRedeemedByCaller: Boolean(resolved.alreadyRedeemedByCaller),
  };
}

async function rollbackOwnership(clientId: string, previousOwnerId: string) {
  await supabaseAdmin.from("clients").update({ owner_user_id: previousOwnerId }).eq("id", clientId);
}

async function stampInviteMetadata(
  userId: string,
  clientId: string,
  shouldTransfer: boolean,
  extra: Record<string, unknown> = {},
) {
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    const prev = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...prev,
        ...extra,
        signup_type: typeof prev.signup_type === "string" ? prev.signup_type : "customer",
        invite_client_id: clientId,
        invite_outcome: shouldTransfer ? "owner_handoff" : "staff_member",
      },
    });
  } catch {
    /* metadata stamp is best-effort */
  }
}

async function ensureInviteRole(userId: string, role: "client_owner" | "client_member") {
  const { data: existingRoles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const have = new Set((existingRoles ?? []).map((r: { role: string }) => r.role));
  if (have.has(role)) return;
  const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: userId, role });
  if (error) throw new Error(`user_roles insert failed: ${error.message}`);
}

async function applyPreparedInvite(opts: {
  prepared: PreparedInvite;
  userId: string;
  email: string;
  replaceRoles: boolean;
  deleteUserOnFailure: boolean;
  alreadyClaimed: boolean;
}): Promise<InviteMemberResult> {
  const { prepared, userId, email, replaceRoles, deleteUserOnFailure, alreadyClaimed } = opts;
  const { client, shouldTransfer, role, tokenId } = prepared;
  const clientId = client.id;
  const previousOwnerId = client.owner_user_id;

  if (!alreadyClaimed && !prepared.alreadyRedeemedByCaller) {
    await claimInviteToken(tokenId);
  }

  const fail = async (message: string) => {
    if (shouldTransfer) await rollbackOwnership(clientId, previousOwnerId);
    await releaseInviteToken(tokenId);
    if (deleteUserOnFailure) await supabaseAdmin.auth.admin.deleteUser(userId);
    throw new Error(message);
  };

  if (shouldTransfer) {
    const { error: ownErr } = await supabaseAdmin
      .from("clients")
      .update({ owner_user_id: userId })
      .eq("id", clientId);
    if (ownErr) await fail(`Ownership handoff failed: ${ownErr.message}`);
  }

  const { error: memErr } = await supabaseAdmin
    .from("client_memberships")
    .upsert({ client_id: clientId, user_id: userId, role }, { onConflict: "client_id,user_id" });
  if (memErr) await fail(`client_memberships upsert failed: ${memErr.message}`);

  if (replaceRoles) {
    await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
    const { error: roleErr } = await supabaseAdmin.from("user_roles").insert({ user_id: userId, role });
    if (roleErr) await fail(`user_roles insert failed: ${roleErr.message}`);
  } else {
    try {
      await ensureInviteRole(userId, role);
    } catch (err) {
      await fail(err instanceof Error ? err.message : "user_roles insert failed");
    }
  }

  await stampInviteMetadata(userId, clientId, shouldTransfer);
  await attachInviteRedeemer(tokenId, userId);

  return {
    userId,
    email,
    clientId,
    transferredOwnership: shouldTransfer,
  };
}

/**
 * Sign up via invite link (new auth user).
 *
 * Steps:
 *   1. Create the auth user with email_confirm:true so no email link is needed.
 *   2. Decide ownership handoff vs staff membership (see module doc).
 *   3. Upsert client_memberships + user_roles accordingly.
 *   4. When handing off, UPDATE clients.owner_user_id via service role
 *      (trigger allows auth.uid() IS NULL); leave firm_id unchanged.
 *
 * If the email is already registered, this throws (token is released). The
 * client must authenticate as that user and call acceptOwnerInviteForUser —
 * attaching before password verification would let a leaked invite bind any
 * existing account.
 */
export async function signUpInvitedMember(input: InviteMemberInput): Promise<InviteMemberResult> {
  const prepared = await prepareInvite(input.inviteClientId, input.inviteClientCode);
  const clientId = prepared.client.id;

  // Claim before createUser so concurrent signups can't both succeed.
  await claimInviteToken(prepared.tokenId);

  const { data: authData, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName?.trim() ?? "",
      signup_type: "customer",
      invite_client_id: clientId,
      invite_outcome: prepared.shouldTransfer ? "owner_handoff" : "staff_member",
    },
  });

  if (error) {
    await releaseInviteToken(prepared.tokenId);
    throw new Error(error.message);
  }
  if (!authData.user) {
    await releaseInviteToken(prepared.tokenId);
    throw new Error("User creation failed");
  }

  return applyPreparedInvite({
    prepared,
    userId: authData.user.id,
    email: authData.user.email ?? input.email,
    replaceRoles: true,
    deleteUserOnFailure: true,
    alreadyClaimed: true,
  });
}

/**
 * Attach an already-authenticated user to the invited client.
 * Used when the invitee already has a Milōn login (or just signed in / Google).
 * Never creates or deletes auth users.
 */
export async function acceptOwnerInviteForUser(
  input: AcceptOwnerInviteInput,
): Promise<InviteMemberResult> {
  const prepared = await prepareInvite(
    input.inviteClientId,
    input.inviteClientCode,
    input.userId,
  );
  let email = input.email?.trim() ?? "";
  if (!email) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(input.userId);
    email = data.user?.email ?? "";
  }
  return applyPreparedInvite({
    prepared,
    userId: input.userId,
    email,
    replaceRoles: false,
    deleteUserOnFailure: false,
    alreadyClaimed: prepared.alreadyRedeemedByCaller,
  });
}
