/**
 * Core invite-member signup logic, extracted so it can be exercised both from
 * the adminSignUp server function and from integration tests without needing to
 * go through the TanStack Start HTTP framing layer.
 *
 * This function creates a confirmed user, writes a client_memberships row with
 * role='client_member', and sets the user_roles entry to 'client_member'.
 * It is the source of truth for the invite → accept path; adminSignUp delegates
 * to it for invited users.
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
};

/**
 * Sign up an invited member.
 *
 * Steps (mirrors what adminSignUp does for the inviteClientId branch):
 *   1. Create the auth user with email_confirm:true so no email link is needed.
 *   2. Upsert a client_memberships row: client_member role.
 *   3. Delete any stale user_roles row, then insert client_member.
 *      (user_roles has UNIQUE(user_id,role) not UNIQUE(user_id), so we must
 *       delete-then-insert to avoid duplicate-role rows accumulating.)
 */
export async function signUpInvitedMember(
  input: InviteMemberInput,
): Promise<InviteMemberResult> {
  const { data: authData, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName?.trim() ?? "",
      signup_type: "customer",
      invite_client_id: input.inviteClientId,
    },
  });

  if (error) throw new Error(error.message);
  if (!authData.user) throw new Error("User creation failed");

  const userId = authData.user.id;

  const { error: memErr } = await supabaseAdmin
    .from("client_memberships")
    .upsert(
      { client_id: input.inviteClientId, user_id: userId, role: "client_member" },
      { onConflict: "client_id,user_id" },
    );
  if (memErr)
    throw new Error(`client_memberships upsert failed: ${memErr.message}`);

  // user_roles has UNIQUE(user_id, role) not UNIQUE(user_id).
  // Delete any existing row so the invited member always ends up with exactly
  // one 'client_member' entry — no stale 'client_owner' row can survive.
  await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
  const { error: roleErr } = await supabaseAdmin
    .from("user_roles")
    .insert({ user_id: userId, role: "client_member" });
  if (roleErr)
    throw new Error(`user_roles insert failed: ${roleErr.message}`);

  return { userId, email: authData.user.email ?? input.email };
}
