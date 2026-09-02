/**
 * Practice team + per-client access. Deny-all RLS; service role after firm-manager guard.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import {
  adminLoose,
  migrationHintFor,
  missingRelation,
  type AuthCtx,
  type LooseAdmin,
} from "@/lib/owner-ops.guard";
import {
  CLASSIFICATION_LABELS,
  MEMBERSHIP_LABELS,
  PRACTICE_ACCESS_MIGRATION,
  PRACTICE_CLIENT_ACCESS_CAP,
  parseClassification,
  parseMembershipRole,
  type MembershipRole,
  type PracticeAccessStatus,
  type PracticeClassification,
} from "@/lib/practice-access";
import {
  accessApproveUrl,
  accessRequestEmail,
  firmInviteEmail,
  sendAccessEmail,
} from "@/lib/practice-access-email";
import { inviteSiteUrl } from "@/lib/client-invite-email";

export type PracticeMember = {
  userId: string;
  email: string;
  name: string;
  membershipRole: MembershipRole;
  classification: PracticeClassification;
  isFirmOwner: boolean;
};

export type PracticeClientRow = {
  id: string;
  name: string;
  code: string | null;
  ownerEmail: string | null;
  ownerUserId: string | null;
  assignedCount: number;
};

export type PracticeAssignment = {
  id: string;
  clientId: string;
  userId: string;
  classification: PracticeClassification;
  status: PracticeAccessStatus;
  accountantApproved: boolean;
  ownerApproved: boolean;
};

export type PracticeInviteRow = {
  id: string;
  email: string;
  name: string;
  membershipRole: MembershipRole;
  classification: PracticeClassification;
  createdAt: string;
  expiresAt: string;
};

export type PracticeAccessBoard = {
  firmId: string;
  firmName: string;
  canManage: boolean;
  membershipRole: MembershipRole | null;
  cap: number;
  members: PracticeMember[];
  clients: PracticeClientRow[];
  assignments: PracticeAssignment[];
  invites: PracticeInviteRow[];
  migrationHint: string | null;
};

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

async function profileByEmail(
  admin: LooseAdmin,
  email: string,
): Promise<{ id: string; name: string } | null> {
  const { data } = await admin.from("profiles").select("id, full_name").ilike("email", email).maybeSingle();
  if (data?.id) return { id: String(data.id), name: String(data.full_name ?? "") };
  return null;
}

async function resolveFirm(
  admin: LooseAdmin,
  userId: string,
  preferredFirmId?: string | null,
): Promise<{ id: string; name: string; ownerUserId: string } | null> {
  const { data: owned } = await admin
    .from("firms")
    .select("id, name, owner_user_id")
    .eq("owner_user_id", userId)
    .order("created_at", { ascending: true });
  const { data: mems } = await admin.from("firm_memberships").select("firm_id").eq("user_id", userId);
  const ids = [
    ...new Set([
      ...(owned ?? []).map((f: { id: string }) => f.id),
      ...(mems ?? []).map((m: { firm_id: string }) => m.firm_id),
    ]),
  ];
  if (ids.length === 0) return null;
  const pick = preferredFirmId && ids.includes(preferredFirmId) ? preferredFirmId : ids[0];
  const { data: firm } = await admin
    .from("firms")
    .select("id, name, owner_user_id")
    .eq("id", pick)
    .maybeSingle();
  if (!firm) return null;
  return { id: String(firm.id), name: String(firm.name ?? "Practice"), ownerUserId: String(firm.owner_user_id) };
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

async function assertManager(
  admin: LooseAdmin,
  userId: string,
  firmId: string,
): Promise<{ role: MembershipRole; isOwner: boolean }> {
  const m = await membershipOf(admin, firmId, userId);
  if (!canManage(m.role, m.isOwner)) {
    throw new Error("Only the practice owner or a firm admin can manage team access.");
  }
  return { role: m.role, isOwner: m.isOwner };
}

async function insertToken(
  admin: LooseAdmin,
  row: {
    purpose: string;
    email: string;
    accessId?: string | null;
    inviteId?: string | null;
  },
): Promise<string> {
  const token = newToken();
  const { error } = await admin.from("access_approval_tokens").insert({
    purpose: row.purpose,
    email: row.email,
    access_id: row.accessId ?? null,
    invite_id: row.inviteId ?? null,
    token_hash: hashToken(token),
  });
  if (error) throw new Error(error.message);
  return token;
}

async function activateIfReady(admin: LooseAdmin, accessId: string): Promise<boolean> {
  const { data } = await admin
    .from("client_practice_access")
    .select("accountant_approved_at, owner_approved_at, status")
    .eq("id", accessId)
    .maybeSingle();
  if (!data || data.status !== "pending") return false;
  if (!data.accountant_approved_at || !data.owner_approved_at) return false;
  const { error } = await admin
    .from("client_practice_access")
    .update({ status: "active", updated_at: new Date().toISOString() })
    .eq("id", accessId);
  if (error) throw new Error(error.message);
  return true;
}

async function ownerContact(
  admin: LooseAdmin,
  client: { owner_user_id: string | null; contact_email: string | null; firm_id: string | null },
): Promise<{ email: string; name: string; isDistinctOwner: boolean } | null> {
  const contact = (client.contact_email ?? "").trim().toLowerCase();
  if (client.owner_user_id) {
    const profile = await profileById(admin, client.owner_user_id);
    let isPractice = false;
    if (client.firm_id) {
      const m = await membershipOf(admin, client.firm_id, client.owner_user_id);
      isPractice = m.isOwner || Boolean(m.role);
      const { data: mem } = await admin
        .from("firm_memberships")
        .select("id")
        .eq("firm_id", client.firm_id)
        .eq("user_id", client.owner_user_id)
        .maybeSingle();
      isPractice = m.isOwner || Boolean(mem?.id);
    }
    const email = profile.email || contact;
    if (email && !isPractice) return { email, name: profile.name, isDistinctOwner: true };
    if (contact && isPractice) return { email: contact, name: profile.name, isDistinctOwner: true };
    return { email: email || contact, name: profile.name, isDistinctOwner: false };
  }
  if (contact) return { email: contact, name: contact.split("@")[0], isDistinctOwner: true };
  return null;
}

function emptyBoard(hint: string | null): PracticeAccessBoard {
  return {
    firmId: "",
    firmName: "",
    canManage: false,
    membershipRole: null,
    cap: PRACTICE_CLIENT_ACCESS_CAP,
    members: [],
    clients: [],
    assignments: [],
    invites: [],
    migrationHint: hint,
  };
}

export const getPracticeAccessBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PracticeAccessBoard> => {
    const ctx = context as AuthCtx;
    const admin = adminLoose();
    try {
      const firm = await resolveFirm(admin, ctx.userId);
      if (!firm) return emptyBoard(null);
      const mine = await membershipOf(admin, firm.id, ctx.userId);
      const manage = canManage(mine.role, mine.isOwner);

      const { data: memRows, error: memErr } = await admin
        .from("firm_memberships")
        .select("user_id, role, classification")
        .eq("firm_id", firm.id);
      if (memErr) throw memErr;

      const memberIds = new Set<string>([firm.ownerUserId]);
      for (const row of memRows ?? []) memberIds.add(String(row.user_id));

      const members: PracticeMember[] = [];
      for (const uid of memberIds) {
        const profile = await profileById(admin, uid);
        const m = await membershipOf(admin, firm.id, uid);
        members.push({
          userId: uid,
          email: profile.email,
          name: profile.name,
          membershipRole: m.role,
          classification: m.classification === "staff" && m.isOwner ? "partner" : m.classification,
          isFirmOwner: m.isOwner,
        });
      }
      members.sort((a, b) => Number(b.isFirmOwner) - Number(a.isFirmOwner) || a.name.localeCompare(b.name));

      const { data: clientRows, error: cErr } = await admin
        .from("clients")
        .select("id, name, client_code, owner_user_id, contact_email")
        .eq("firm_id", firm.id)
        .order("name");
      if (cErr) throw cErr;

      const { data: assignRows, error: aErr } = await admin
        .from("client_practice_access")
        .select(
          "id, client_id, user_id, classification, status, accountant_approved_at, owner_approved_at",
        )
        .eq("firm_id", firm.id);
      if (aErr) throw aErr;

      const assignments: PracticeAssignment[] = (assignRows ?? []).map((row: Record<string, unknown>) => ({
        id: String(row.id),
        clientId: String(row.client_id),
        userId: String(row.user_id),
        classification: parseClassification(row.classification),
        status: (row.status as PracticeAccessStatus) ?? "pending",
        accountantApproved: Boolean(row.accountant_approved_at),
        ownerApproved: Boolean(row.owner_approved_at),
      }));

      const countByClient = new Map<string, number>();
      for (const a of assignments) {
        if (a.status === "active" || a.status === "pending") {
          countByClient.set(a.clientId, (countByClient.get(a.clientId) ?? 0) + 1);
        }
      }

      const clients: PracticeClientRow[] = [];
      for (const c of clientRows ?? []) {
        const owner =
          c.owner_user_id != null ? await profileById(admin, String(c.owner_user_id)) : { email: "", name: "" };
        clients.push({
          id: String(c.id),
          name: String(c.name ?? "Client"),
          code: (c.client_code as string | null) ?? null,
          ownerEmail: owner.email || (c.contact_email as string | null),
          ownerUserId: (c.owner_user_id as string | null) ?? null,
          assignedCount: countByClient.get(String(c.id)) ?? 0,
        });
      }

      let invites: PracticeInviteRow[] = [];
      if (manage) {
        const { data: inv } = await admin
          .from("firm_staff_invites")
          .select("id, email, name, membership_role, classification, created_at, expires_at, accepted_at")
          .eq("firm_id", firm.id)
          .is("accepted_at", null)
          .order("created_at", { ascending: false });
        invites = (inv ?? []).map((row: Record<string, unknown>) => ({
          id: String(row.id),
          email: String(row.email ?? ""),
          name: String(row.name ?? ""),
          membershipRole: parseMembershipRole(row.membership_role),
          classification: parseClassification(row.classification),
          createdAt: String(row.created_at ?? ""),
          expiresAt: String(row.expires_at ?? ""),
        }));
      }

      const visibleClients = manage
        ? clients
        : clients.filter((c) =>
            assignments.some((a) => a.clientId === c.id && a.userId === ctx.userId && a.status === "active"),
          );

      return {
        firmId: firm.id,
        firmName: firm.name,
        canManage: manage,
        membershipRole: mine.role,
        cap: PRACTICE_CLIENT_ACCESS_CAP,
        members,
        clients: visibleClients,
        assignments: manage
          ? assignments
          : assignments.filter((a) => a.userId === ctx.userId),
        invites,
        migrationHint: null,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (missingRelation(msg)) return emptyBoard(migrationHintFor(PRACTICE_ACCESS_MIGRATION));
      throw e instanceof Error ? e : new Error(msg);
    }
  });

export const inviteFirmStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email().max(200),
        name: z.string().trim().max(120).optional(),
        membershipRole: z.enum(["admin", "member"]).default("member"),
        classification: z.enum([
          "partner",
          "manager",
          "staff",
          "bookkeeper",
          "reviewer",
          "read_only",
        ]).default("staff"),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const ctx = context as AuthCtx;
    const admin = adminLoose();
    const firm = await resolveFirm(admin, ctx.userId);
    if (!firm) throw new Error("No practice found.");
    await assertManager(admin, ctx.userId, firm.id);

    const email = data.email.trim().toLowerCase();
    const name = (data.name ?? "").trim() || email.split("@")[0];
    const existing = await profileByEmail(admin, email);
    if (existing) {
      const { error } = await admin.from("firm_memberships").upsert(
        {
          firm_id: firm.id,
          user_id: existing.id,
          role: data.membershipRole,
          classification: data.classification,
        },
        { onConflict: "firm_id,user_id" },
      );
      if (error) throw new Error(error.message);
      const role = data.membershipRole === "admin" ? "firm_admin" : "accountant";
      await admin.from("user_roles").upsert(
        { user_id: existing.id, role },
        { onConflict: "user_id,role" },
      );
      const inviter = await profileById(admin, ctx.userId);
      const mail = firmInviteEmail({
        recipientName: existing.name || name,
        firmName: firm.name,
        inviterName: inviter.name,
        roleLabel: MEMBERSHIP_LABELS[data.membershipRole],
        url: `${inviteSiteUrl()}/auth`,
      });
      await sendAccessEmail({
        to: email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        idempotencyKey: `firm-add-${firm.id}-${email}`,
      });
      return { addedExisting: true as const, invited: false as const };
    }

    const token = newToken();
    const { data: invite, error } = await admin
      .from("firm_staff_invites")
      .insert({
        firm_id: firm.id,
        email,
        name,
        membership_role: data.membershipRole,
        classification: data.classification,
        invited_by: ctx.userId,
        token_hash: hashToken(token),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await admin.from("access_approval_tokens").insert({
      purpose: "firm_invite",
      email,
      invite_id: invite.id,
      token_hash: hashToken(token),
    });
    const inviter = await profileById(admin, ctx.userId);
    const mail = firmInviteEmail({
      recipientName: name,
      firmName: firm.name,
      inviterName: inviter.name,
      roleLabel: MEMBERSHIP_LABELS[data.membershipRole],
      url: accessApproveUrl(token),
    });
    const sent = await sendAccessEmail({
      to: email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey: `firm-invite-${invite.id}`,
    });
    return { addedExisting: false as const, invited: true as const, emailed: sent.ok };
  });

export const updateFirmMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        membershipRole: z.enum(["admin", "member"]).optional(),
        classification: z
          .enum(["partner", "manager", "staff", "bookkeeper", "reviewer", "read_only"])
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const ctx = context as AuthCtx;
    const admin = adminLoose();
    const firm = await resolveFirm(admin, ctx.userId);
    if (!firm) throw new Error("No practice found.");
    await assertManager(admin, ctx.userId, firm.id);
    if (data.userId === firm.ownerUserId) {
      throw new Error("The practice owner’s role cannot be changed here.");
    }
    const patch: Record<string, string> = {};
    if (data.membershipRole) patch.role = data.membershipRole;
    if (data.classification) patch.classification = data.classification;
    if (Object.keys(patch).length === 0) return { ok: true as const };
    const { error } = await admin
      .from("firm_memberships")
      .update(patch)
      .eq("firm_id", firm.id)
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const removeFirmMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = context as AuthCtx;
    const admin = adminLoose();
    const firm = await resolveFirm(admin, ctx.userId);
    if (!firm) throw new Error("No practice found.");
    await assertManager(admin, ctx.userId, firm.id);
    if (data.userId === firm.ownerUserId || data.userId === ctx.userId) {
      throw new Error("The practice owner cannot be removed.");
    }
    await admin.from("firm_memberships").delete().eq("firm_id", firm.id).eq("user_id", data.userId);
    await admin
      .from("client_practice_access")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by: ctx.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("firm_id", firm.id)
      .eq("user_id", data.userId)
      .in("status", ["pending", "active"]);
    return { ok: true as const };
  });

export const requestClientAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        userId: z.string().uuid(),
        classification: z.enum([
          "partner",
          "manager",
          "staff",
          "bookkeeper",
          "reviewer",
          "read_only",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const ctx = context as AuthCtx;
    const admin = adminLoose();
    const firm = await resolveFirm(admin, ctx.userId);
    if (!firm) throw new Error("No practice found.");
    const mine = await assertManager(admin, ctx.userId, firm.id);

    const { data: client, error: cErr } = await admin
      .from("clients")
      .select("id, name, firm_id, owner_user_id, contact_email")
      .eq("id", data.clientId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!client || String(client.firm_id) !== firm.id) throw new Error("Client is not in this practice.");

    const { count } = await admin
      .from("client_practice_access")
      .select("id", { count: "exact", head: true })
      .eq("client_id", data.clientId)
      .in("status", ["pending", "active"]);
    const { data: existing } = await admin
      .from("client_practice_access")
      .select("id, status")
      .eq("client_id", data.clientId)
      .eq("user_id", data.userId)
      .maybeSingle();
    const occupying = (count ?? 0) - (existing && (existing.status === "pending" || existing.status === "active") ? 1 : 0);
    if (occupying >= PRACTICE_CLIENT_ACCESS_CAP) {
      throw new Error(`A client file can have at most ${PRACTICE_CLIENT_ACCESS_CAP} practice users.`);
    }

    const now = new Date().toISOString();
    const owner = await ownerContact(admin, client);
    const managerAuto = mine.isOwner || mine.role === "owner" || mine.role === "admin";
    const ownerAuto = !owner?.isDistinctOwner;

    const row = {
      client_id: data.clientId,
      user_id: data.userId,
      firm_id: firm.id,
      classification: data.classification,
      status: "pending" as const,
      requested_by: ctx.userId,
      requested_at: now,
      accountant_approved_at: managerAuto ? now : null,
      accountant_approved_by: managerAuto ? ctx.userId : null,
      owner_approved_at: ownerAuto ? now : null,
      owner_approved_by: ownerAuto ? ctx.userId : null,
      revoked_at: null,
      revoked_by: null,
      updated_at: now,
    };

    const { data: saved, error } = await admin
      .from("client_practice_access")
      .upsert(row, { onConflict: "client_id,user_id" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await activateIfReady(admin, saved.id);

    const actor = await profileById(admin, ctx.userId);
    const member = await profileById(admin, data.userId);
    const clientName = String(client.name ?? "Client");

    if (!managerAuto) {
      const approver = await profileById(admin, firm.ownerUserId);
      if (approver.email) {
        const token = await insertToken(admin, {
          purpose: "accountant_approve",
          email: approver.email,
          accessId: saved.id,
        });
        const mail = accessRequestEmail({
          recipientName: approver.name,
          actorName: actor.name,
          memberName: member.name,
          memberEmail: member.email,
          clientName,
          firmName: firm.name,
          classification: data.classification,
          approveUrl: accessApproveUrl(token),
          side: "accountant",
        });
        await sendAccessEmail({
          to: approver.email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          idempotencyKey: `acc-approve-${saved.id}`,
        });
      }
    }

    if (owner?.isDistinctOwner && owner.email) {
      const token = await insertToken(admin, {
        purpose: "owner_approve",
        email: owner.email,
        accessId: saved.id,
      });
      const mail = accessRequestEmail({
        recipientName: owner.name,
        actorName: actor.name,
        memberName: member.name,
        memberEmail: member.email,
        clientName,
        firmName: firm.name,
        classification: data.classification,
        approveUrl: accessApproveUrl(token),
        side: "owner",
      });
      await sendAccessEmail({
        to: owner.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        idempotencyKey: `own-approve-${saved.id}`,
      });
    }

    const { data: latest } = await admin
      .from("client_practice_access")
      .select("status")
      .eq("id", saved.id)
      .maybeSingle();
    return {
      status: (latest?.status as PracticeAccessStatus) ?? "pending",
      emailedOwner: Boolean(owner?.isDistinctOwner && owner.email),
      emailedAccountant: !managerAuto,
    };
  });

export const revokeClientAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ accessId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = context as AuthCtx;
    const admin = adminLoose();
    const firm = await resolveFirm(admin, ctx.userId);
    if (!firm) throw new Error("No practice found.");
    await assertManager(admin, ctx.userId, firm.id);
    const { error } = await admin
      .from("client_practice_access")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by: ctx.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.accessId)
      .eq("firm_id", firm.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export type AccessTokenPreview = {
  purpose: string;
  clientName: string | null;
  memberName: string | null;
  memberEmail: string | null;
  classification: string | null;
  firmName: string | null;
  expired: boolean;
  used: boolean;
};

export const previewAccessToken = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: z.string().min(16).max(80) }).parse(input))
  .handler(async ({ data }): Promise<AccessTokenPreview> => {
    const admin = getSupabaseAdminOrNull();
    if (!admin) throw new Error("Server is not configured.");
    const loose = admin as unknown as LooseAdmin;
    const { data: tok } = await loose
      .from("access_approval_tokens")
      .select("purpose, access_id, invite_id, expires_at, used_at")
      .eq("token_hash", hashToken(data.token))
      .maybeSingle();
    if (!tok) {
      return {
        purpose: "",
        clientName: null,
        memberName: null,
        memberEmail: null,
        classification: null,
        firmName: null,
        expired: false,
        used: false,
      };
    }
    const expired = tok.expires_at ? Date.parse(String(tok.expires_at)) < Date.now() : false;
    const used = Boolean(tok.used_at);
    let clientName: string | null = null;
    let memberName: string | null = null;
    let memberEmail: string | null = null;
    let classification: string | null = null;
    let firmName: string | null = null;
    if (tok.access_id) {
      const { data: acc } = await loose
        .from("client_practice_access")
        .select("client_id, user_id, classification, firm_id")
        .eq("id", tok.access_id)
        .maybeSingle();
      if (acc) {
        classification = CLASSIFICATION_LABELS[parseClassification(acc.classification)];
        const { data: client } = await loose.from("clients").select("name").eq("id", acc.client_id).maybeSingle();
        clientName = client?.name ?? null;
        const member = await profileById(loose, String(acc.user_id));
        memberName = member.name;
        memberEmail = member.email;
        const { data: firm } = await loose.from("firms").select("name").eq("id", acc.firm_id).maybeSingle();
        firmName = firm?.name ?? null;
      }
    }
    if (tok.invite_id) {
      const { data: inv } = await loose
        .from("firm_staff_invites")
        .select("name, email, firm_id, classification")
        .eq("id", tok.invite_id)
        .maybeSingle();
      if (inv) {
        memberName = String(inv.name ?? "");
        memberEmail = String(inv.email ?? "");
        classification = CLASSIFICATION_LABELS[parseClassification(inv.classification)];
        const { data: firm } = await loose.from("firms").select("name").eq("id", inv.firm_id).maybeSingle();
        firmName = firm?.name ?? null;
      }
    }
    return {
      purpose: String(tok.purpose ?? ""),
      clientName,
      memberName,
      memberEmail,
      classification,
      firmName,
      expired,
      used,
    };
  });

export const redeemAccessToken = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().min(16).max(80),
        decision: z.enum(["approve", "decline"]),
        userId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const admin = getSupabaseAdminOrNull();
    if (!admin) throw new Error("Server is not configured.");
    const loose = admin as unknown as LooseAdmin;
    const { data: tok, error } = await loose
      .from("access_approval_tokens")
      .select("id, purpose, access_id, invite_id, email, expires_at, used_at")
      .eq("token_hash", hashToken(data.token))
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!tok) throw new Error("This link is invalid.");
    if (tok.used_at) throw new Error("This link has already been used.");
    if (tok.expires_at && Date.parse(String(tok.expires_at)) < Date.now()) {
      throw new Error("This link has expired.");
    }

    const now = new Date().toISOString();
    const purpose = String(tok.purpose);

    if (purpose === "firm_invite") {
      if (data.decision === "decline") {
        await loose.from("access_approval_tokens").update({ used_at: now }).eq("id", tok.id);
        return { ok: true as const, kind: "firm_invite" as const, accepted: false };
      }
      if (!data.userId) {
        throw new Error("Sign in with the invited email, then open this link again.");
      }
      const { data: invite } = await loose
        .from("firm_staff_invites")
        .select("id, firm_id, email, membership_role, classification, accepted_at")
        .eq("id", tok.invite_id)
        .maybeSingle();
      if (!invite) throw new Error("Invitation not found.");
      if (invite.accepted_at) throw new Error("This invitation was already accepted.");
      const me = await profileById(loose, data.userId);
      if (me.email && me.email !== String(invite.email).toLowerCase()) {
        throw new Error(`Sign in as ${invite.email} to accept this invitation.`);
      }
      await loose.from("firm_memberships").upsert(
        {
          firm_id: invite.firm_id,
          user_id: data.userId,
          role: invite.membership_role,
          classification: invite.classification,
        },
        { onConflict: "firm_id,user_id" },
      );
      const role = invite.membership_role === "admin" ? "firm_admin" : "accountant";
      await loose.from("user_roles").upsert({ user_id: data.userId, role }, { onConflict: "user_id,role" });
      await loose
        .from("firm_staff_invites")
        .update({ accepted_at: now, accepted_by: data.userId })
        .eq("id", invite.id);
      await loose.from("access_approval_tokens").update({ used_at: now }).eq("id", tok.id);
      return { ok: true as const, kind: "firm_invite" as const, accepted: true };
    }

    if (!tok.access_id) throw new Error("This link is not tied to a client file.");
    const approved = data.decision === "approve";
    const patch: Record<string, unknown> = { updated_at: now };
    if (purpose === "accountant_approve") {
      patch.accountant_approved_at = approved ? now : null;
      patch.accountant_approved_by = data.userId ?? null;
      if (!approved) patch.status = "declined";
    } else if (purpose === "owner_approve" || purpose === "owner_decline") {
      patch.owner_approved_at = approved ? now : null;
      patch.owner_approved_by = data.userId ?? null;
      if (!approved) patch.status = "declined";
    } else {
      throw new Error("Unknown approval type.");
    }
    const { error: upErr } = await loose.from("client_practice_access").update(patch).eq("id", tok.access_id);
    if (upErr) throw new Error(upErr.message);
    if (approved) await activateIfReady(loose, String(tok.access_id));
    await loose.from("access_approval_tokens").update({ used_at: now }).eq("id", tok.id);
    return { ok: true as const, kind: "access" as const, accepted: approved };
  });
