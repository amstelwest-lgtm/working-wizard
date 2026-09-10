/**
 * Redeem an owner→accountant invite: create/reuse a practice firm, link
 * clients.firm_id, grant a practice seat. Never transfers ownership.
 */

import {
  ACCOUNTANT_INVITE_PURPOSE,
  assertAccountantLinkPurpose,
  defaultPracticeName,
  planAccountantLink,
} from "@/lib/accountant-invite";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type LooseFrom = {
  from: (table: string) => {
    upsert: (
      row: Record<string, unknown>,
      opts?: { onConflict: string },
    ) => Promise<{ error: { message: string } | null }>;
  };
};

const looseAdmin = () => supabaseAdmin as unknown as LooseFrom;
import {
  attachInviteRedeemer,
  claimInviteToken,
  releaseInviteToken,
  resolveInviteToClientId,
} from "@/lib/invite-tokens.resolve";

export type AccountantInviteResult = {
  userId: string;
  email: string;
  clientId: string;
  firmId: string;
  createdFirm: boolean;
};

type ClientRow = {
  id: string;
  name: string;
  owner_user_id: string;
  firm_id: string | null;
  market?: unknown;
};

async function loadClient(clientId: string): Promise<ClientRow> {
  const first = await supabaseAdmin
    .from("clients")
    .select("id, name, owner_user_id, firm_id, market")
    .eq("id", clientId)
    .maybeSingle();
  if (first.error && /market/i.test(first.error.message ?? "")) {
    const retry = await supabaseAdmin
      .from("clients")
      .select("id, name, owner_user_id, firm_id")
      .eq("id", clientId)
      .maybeSingle();
    if (retry.error) throw new Error(retry.error.message);
    if (!retry.data) throw new Error("Invite link is invalid — client not found.");
    return retry.data;
  }
  if (first.error) throw new Error(first.error.message);
  if (!first.data) throw new Error("Invite link is invalid — client not found.");
  return first.data;
}

async function findRedeemerFirmId(userId: string): Promise<string | null> {
  const { data: owned } = await supabaseAdmin
    .from("firms")
    .select("id")
    .eq("owner_user_id", userId)
    .limit(1)
    .maybeSingle();
  if (owned?.id) return owned.id;
  const { data: mem } = await supabaseAdmin
    .from("firm_memberships")
    .select("firm_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return mem?.firm_id ?? null;
}

function emailsMatch(invited: string | null | undefined, actual: string): boolean {
  if (!invited?.trim()) return true;
  return invited.trim().toLowerCase() === actual.trim().toLowerCase();
}

async function ensurePracticeRole(userId: string, asFirmOwner: boolean) {
  const role = asFirmOwner ? "firm_admin" : "accountant";
  const { data: existing } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const have = new Set((existing ?? []).map((r: { role: string }) => r.role));
  if (have.has(role) || (asFirmOwner && have.has("accountant") && have.has("firm_admin"))) {
    return;
  }
  if (asFirmOwner && have.has("accountant") && !have.has("firm_admin")) {
    const { error } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "firm_admin" });
    if (error && !/duplicate|unique/i.test(error.message)) {
      throw new Error(`user_roles insert failed: ${error.message}`);
    }
    return;
  }
  const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: userId, role });
  if (error && !/duplicate|unique/i.test(error.message)) {
    throw new Error(`user_roles insert failed: ${error.message}`);
  }
}

async function isFirmOwner(userId: string, firmId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("firms")
    .select("id")
    .eq("id", firmId)
    .eq("owner_user_id", userId)
    .maybeSingle();
  return Boolean(data?.id);
}

async function ensureFirmMembership(firmId: string, userId: string, asOwner: boolean) {
  const row = {
    firm_id: firmId,
    user_id: userId,
    role: asOwner ? "owner" : "member",
    classification: asOwner ? "partner" : "staff",
  };
  const { error } = await looseAdmin().from("firm_memberships").upsert(row, { onConflict: "firm_id,user_id" });
  if (error && /classification/i.test(error.message ?? "")) {
    const { classification: _c, ...rest } = row;
    const retry = await looseAdmin()
      .from("firm_memberships")
      .upsert(rest, { onConflict: "firm_id,user_id" });
    if (retry.error) throw new Error(`firm_memberships upsert failed: ${retry.error.message}`);
    return;
  }
  if (error) throw new Error(`firm_memberships upsert failed: ${error.message}`);
}

async function ensurePracticeAccess(opts: {
  clientId: string;
  userId: string;
  firmId: string;
}) {
  const now = new Date().toISOString();
  const { error } = await looseAdmin().from("client_practice_access").upsert(
    {
      client_id: opts.clientId,
      user_id: opts.userId,
      firm_id: opts.firmId,
      classification: "partner",
      status: "active",
      requested_at: now,
      accountant_approved_at: now,
      owner_approved_at: now,
    },
    { onConflict: "client_id,user_id" },
  );
  if (error) throw new Error(`client_practice_access upsert failed: ${error.message}`);
}

async function createPracticeFirm(opts: {
  userId: string;
  name: string;
  market?: unknown;
}): Promise<string> {
  const base = { name: opts.name, owner_user_id: opts.userId };
  const withMarket = opts.market ? { ...base, market: opts.market } : base;
  let { data: firm, error } = await supabaseAdmin
    .from("firms")
    .insert(withMarket)
    .select("id")
    .single();
  if (error && opts.market && /market/i.test(error.message ?? "")) {
    const retry = await supabaseAdmin.from("firms").insert(base).select("id").single();
    firm = retry.data;
    error = retry.error;
  }
  if (error || !firm) throw new Error(error?.message ?? "Could not create practice firm");
  return firm.id;
}

async function stampAccountantMetadata(
  userId: string,
  extra: Record<string, unknown>,
) {
  try {
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    const prev = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...prev,
        ...extra,
        signup_type: "accountant",
        invite_outcome: ACCOUNTANT_INVITE_PURPOSE,
      },
    });
  } catch {
    /* metadata is best-effort */
  }
}

type ResolvedAccountantInvite = {
  clientId: string;
  tokenId: string;
  invitedEmail?: string | null;
  alreadyRedeemedByCaller?: boolean;
};

async function resolveAccountantInvite(
  token: string,
  redeemedByUserId?: string,
): Promise<ResolvedAccountantInvite> {
  const resolved = await resolveInviteToClientId(token, { redeemedByUserId });
  assertAccountantLinkPurpose(resolved.purpose);
  if (resolved.legacy || !resolved.tokenId) {
    throw new Error("This accountant invite link is invalid.");
  }
  return {
    clientId: resolved.clientId,
    tokenId: resolved.tokenId,
    invitedEmail: resolved.invitedEmail,
    alreadyRedeemedByCaller: resolved.alreadyRedeemedByCaller,
  };
}

async function applyAccountantInvite(opts: {
  resolved: ResolvedAccountantInvite;
  userId: string;
  email: string;
  firmName?: string | null;
  alreadyClaimed: boolean;
  deleteUserOnFailure: boolean;
}): Promise<AccountantInviteResult> {
  const resolved = opts.resolved;
  if (!emailsMatch(resolved.invitedEmail, opts.email)) {
    throw new Error(`Sign in as ${resolved.invitedEmail} to accept this invitation.`);
  }

  const client = await loadClient(resolved.clientId);
  const redeemerFirmId = await findRedeemerFirmId(opts.userId);
  const plan = planAccountantLink({
    clientOwnerUserId: client.owner_user_id,
    clientFirmId: client.firm_id,
    redeemerUserId: opts.userId,
    redeemerFirmId,
  });

  if (plan.kind === "reject_self") {
    throw new Error("You cannot accept your own accountant invite.");
  }
  if (plan.kind === "reject_other_firm") {
    throw new Error(
      "This workspace is already linked to a practice. Ask them to add a colleague from the practice portal.",
    );
  }

  if (!opts.alreadyClaimed && !resolved.alreadyRedeemedByCaller) {
    await claimInviteToken(resolved.tokenId);
  }

  let createdFirm = false;
  let linkedClient = false;
  let firmId =
    plan.kind === "create_firm"
      ? ""
      : plan.kind === "link_existing_firm" || plan.kind === "already_on_firm"
        ? plan.firmId
        : "";
  const previousFirmId = client.firm_id;

  const fail = async (message: string) => {
    if (linkedClient) {
      await supabaseAdmin
        .from("clients")
        .update({ firm_id: previousFirmId })
        .eq("id", client.id);
    }
    await releaseInviteToken(resolved.tokenId);
    if (opts.deleteUserOnFailure) await supabaseAdmin.auth.admin.deleteUser(opts.userId);
    throw new Error(message);
  };

  try {
    if (plan.kind === "create_firm") {
      firmId = await createPracticeFirm({
        userId: opts.userId,
        name: defaultPracticeName(opts.email, opts.firmName),
        market: client.market,
      });
      createdFirm = true;
    }

    const asOwner = createdFirm || (await isFirmOwner(opts.userId, firmId));
    await ensureFirmMembership(firmId, opts.userId, asOwner);
    await ensurePracticeRole(opts.userId, asOwner);

    if (!client.firm_id) {
      const { error: linkErr } = await supabaseAdmin
        .from("clients")
        .update({ firm_id: firmId })
        .eq("id", client.id)
        .is("firm_id", null);
      if (linkErr) throw new Error(`Could not link workspace: ${linkErr.message}`);
      linkedClient = true;
    }

    await ensurePracticeAccess({
      clientId: client.id,
      userId: opts.userId,
      firmId,
    });
    await stampAccountantMetadata(opts.userId, {
      invite_client_id: client.id,
      firm_name: defaultPracticeName(opts.email, opts.firmName),
    });
    await attachInviteRedeemer(resolved.tokenId, opts.userId);
  } catch (err) {
    await fail(err instanceof Error ? err.message : "Could not accept the accountant invite.");
  }

  return {
    userId: opts.userId,
    email: opts.email,
    clientId: client.id,
    firmId,
    createdFirm,
  };
}

export async function signUpInvitedAccountant(input: {
  email: string;
  password: string;
  fullName?: string;
  token: string;
  firmName?: string | null;
}): Promise<AccountantInviteResult> {
  const prepared = await resolveAccountantInvite(input.token);
  if (!emailsMatch(prepared.invitedEmail, input.email)) {
    throw new Error(`This invite was sent to ${prepared.invitedEmail}.`);
  }

  await claimInviteToken(prepared.tokenId);

  const { data: authData, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName?.trim() ?? "",
      signup_type: "accountant",
      invite_client_id: prepared.clientId,
      invite_outcome: ACCOUNTANT_INVITE_PURPOSE,
      firm_name: defaultPracticeName(input.email, input.firmName),
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

  return applyAccountantInvite({
    resolved: prepared,
    userId: authData.user.id,
    email: authData.user.email ?? input.email,
    firmName: input.firmName,
    alreadyClaimed: true,
    deleteUserOnFailure: true,
  });
}

export async function acceptAccountantInviteForUser(input: {
  userId: string;
  email?: string | null;
  token: string;
  firmName?: string | null;
}): Promise<AccountantInviteResult> {
  let email = input.email?.trim() ?? "";
  if (!email) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(input.userId);
    email = data.user?.email ?? "";
  }
  const resolved = await resolveAccountantInvite(input.token, input.userId);
  return applyAccountantInvite({
    resolved,
    userId: input.userId,
    email,
    firmName: input.firmName,
    alreadyClaimed: false,
    deleteUserOnFailure: false,
  });
}
