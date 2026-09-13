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
  PRACTICE_ACCESS_AMENDMENT_MIGRATION,
  PRACTICE_ACCESS_MIGRATION,
  PRACTICE_CLIENT_ACCESS_CAP,
  classAtMost,
  parseClassification,
  parseMembershipRole,
  type MembershipRole,
  type PracticeAccessStatus,
  type PracticeClassification,
} from "@/lib/practice-access";
import {
  accessApproveUrl,
  accessGrantedEmail,
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
  grantedAt: string | null;
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
  myClassification: PracticeClassification | null;
  actorIsPartner: boolean;
  cap: number;
  members: PracticeMember[];
  clients: PracticeClientRow[];
  assignments: PracticeAssignment[];
  invites: PracticeInviteRow[];
  migrationHint: string | null;
};

export type OwnerPracticePerson = {
  accessId: string;
  clientId: string;
  clientName: string;
  firmId: string;
  firmName: string;
  userId: string;
  name: string;
  email: string;
  classification: PracticeClassification;
  grantedAt: string | null;
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

function teamClassOf(m: { classification: PracticeClassification; isOwner: boolean }): PracticeClassification {
  return m.isOwner && m.classification === "staff" ? "partner" : m.classification;
}

async function writeAudit(
  admin: LooseAdmin,
  row: {
    actorId: string;
    action: string;
    firmId?: string | null;
    clientId?: string | null;
    subjectUserId?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin.from("audit_log").insert({
    actor_id: row.actorId,
    action: row.action,
    firm_id: row.firmId ?? null,
    client_id: row.clientId ?? null,
    subject_user_id: row.subjectUserId ?? null,
    details: row.details ?? {},
  });
  if (error) {
    const viaRpc = await admin.rpc("write_audit_log", {
      _action: row.action,
      _firm_id: row.firmId ?? null,
      _client_id: row.clientId ?? null,
      _subject_user_id: row.subjectUserId ?? null,
      _details: row.details ?? {},
      _actor_id: row.actorId,
    });
    if (viaRpc.error) {
      console.warn("audit_log write failed", error.message, viaRpc.error.message);
    }
  }
}

function assertCanAssignPartner(
  actorClass: PracticeClassification,
  nextClass: PracticeClassification | undefined,
): void {
  if (nextClass === "partner" && actorClass !== "partner") {
    throw new Error("Only a partner can assign partner status.");
  }
}

async function assertKeepsPartner(
  admin: LooseAdmin,
  firmId: string,
  exceptUserId: string,
): Promise<void> {
  const { data: firm } = await admin.from("firms").select("owner_user_id").eq("id", firmId).maybeSingle();
  if (firm?.owner_user_id && String(firm.owner_user_id) !== exceptUserId) return;
  const { data: partners } = await admin
    .from("firm_memberships")
    .select("user_id")
    .eq("firm_id", firmId)
    .eq("classification", "partner");
  const leftover = (partners ?? []).filter((p: { user_id: string }) => p.user_id !== exceptUserId);
  if (leftover.length === 0 && String(firm?.owner_user_id ?? "") === exceptUserId) {
    throw new Error("A practice must keep at least one partner.");
  }
  if (leftover.length === 0 && !firm?.owner_user_id) {
    throw new Error("A practice must keep at least one partner.");
  }
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
    myClassification: null,
    actorIsPartner: false,
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
          classification: teamClassOf(m),
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
          "id, client_id, user_id, classification, status, accountant_approved_at, owner_approved_at, created_at",
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
        grantedAt:
          (row.owner_approved_at as string | null) ??
          (row.accountant_approved_at as string | null) ??
          (row.created_at as string | null) ??
          null,
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
        myClassification: teamClassOf(mine),
        actorIsPartner: teamClassOf(mine) === "partner",
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
      if (missingRelation(msg)) {
        return emptyBoard(
          migrationHintFor(
            msg.includes("audit_log") || msg.includes("firm_connected") || msg.includes("deliverable")
              ? PRACTICE_ACCESS_AMENDMENT_MIGRATION
              : PRACTICE_ACCESS_MIGRATION,
          ),
        );
      }
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
    const actor = await membershipOf(admin, firm.id, ctx.userId);
    assertCanAssignPartner(teamClassOf(actor), data.classification);

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
      await writeAudit(admin, {
        actorId: ctx.userId,
        action: "member_invited",
        firmId: firm.id,
        subjectUserId: existing.id,
        details: { email, membershipRole: data.membershipRole, classification: data.classification, existing: true },
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
    await writeAudit(admin, {
      actorId: ctx.userId,
      action: "member_invited",
      firmId: firm.id,
      details: { email, membershipRole: data.membershipRole, classification: data.classification, existing: false },
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
    const actor = await membershipOf(admin, firm.id, ctx.userId);
    assertCanAssignPartner(teamClassOf(actor), data.classification);
    const current = await membershipOf(admin, firm.id, data.userId);
    if (
      current.classification === "partner" &&
      data.classification &&
      data.classification !== "partner"
    ) {
      await assertKeepsPartner(admin, firm.id, data.userId);
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
    if (data.membershipRole && data.membershipRole !== current.role) {
      await writeAudit(admin, {
        actorId: ctx.userId,
        action: "firm_permissions_changed",
        firmId: firm.id,
        subjectUserId: data.userId,
        details: { from: current.role, to: data.membershipRole },
      });
    }
    if (data.classification && data.classification !== current.classification) {
      await writeAudit(admin, {
        actorId: ctx.userId,
        action: "professional_level_changed",
        firmId: firm.id,
        subjectUserId: data.userId,
        details: { from: current.classification, to: data.classification },
      });
    }
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
    const leaving = await membershipOf(admin, firm.id, data.userId);
    if (leaving.classification === "partner") {
      await assertKeepsPartner(admin, firm.id, data.userId);
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
    await writeAudit(admin, {
      actorId: ctx.userId,
      action: "member_removed",
      firmId: firm.id,
      subjectUserId: data.userId,
    });
    return { ok: true as const };
  });

async function upsertPracticeGrant(
  admin: LooseAdmin,
  opts: {
    clientId: string;
    userId: string;
    firmId: string;
    classification: PracticeClassification;
    actorId: string;
  },
): Promise<{ id: string; activated: boolean }> {
  const { count } = await admin
    .from("client_practice_access")
    .select("id", { count: "exact", head: true })
    .eq("client_id", opts.clientId)
    .in("status", ["pending", "active"]);
  const { data: existing } = await admin
    .from("client_practice_access")
    .select("id, status")
    .eq("client_id", opts.clientId)
    .eq("user_id", opts.userId)
    .maybeSingle();
  const occupying =
    (count ?? 0) -
    (existing && (existing.status === "pending" || existing.status === "active") ? 1 : 0);
  if (occupying >= PRACTICE_CLIENT_ACCESS_CAP) {
    throw new Error(`A client file can have at most ${PRACTICE_CLIENT_ACCESS_CAP} practice users.`);
  }

  const now = new Date().toISOString();
  const row = {
    client_id: opts.clientId,
    user_id: opts.userId,
    firm_id: opts.firmId,
    classification: opts.classification,
    status: "active" as const,
    requested_by: opts.actorId,
    requested_at: now,
    accountant_approved_at: now,
    accountant_approved_by: opts.actorId,
    owner_approved_at: now,
    owner_approved_by: opts.actorId,
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
  const wasActive = existing?.status === "active";
  if (!wasActive) {
    await writeAudit(admin, {
      actorId: opts.actorId,
      action: "access_granted",
      firmId: opts.firmId,
      clientId: opts.clientId,
      subjectUserId: opts.userId,
      details: { classification: opts.classification },
    });
  }
  return { id: String(saved.id), activated: !wasActive };
}

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
    await assertManager(admin, ctx.userId, firm.id);

    const { data: client, error: cErr } = await admin
      .from("clients")
      .select("id, name, firm_id, firm_connected_at, owner_user_id, contact_email")
      .eq("id", data.clientId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!client || String(client.firm_id) !== firm.id) throw new Error("Client is not in this practice.");

    const memberMem = await membershipOf(admin, firm.id, data.userId);
    const ceiling = teamClassOf(memberMem);
    const classification = classAtMost(ceiling, data.classification);

    const saved = await upsertPracticeGrant(admin, {
      clientId: data.clientId,
      userId: data.userId,
      firmId: firm.id,
      classification,
      actorId: ctx.userId,
    });

    const owner = await ownerContact(admin, client);
    const actor = await profileById(admin, ctx.userId);
    const member = await profileById(admin, data.userId);
    const clientName = String(client.name ?? "Client");
    const firmConnected = Boolean(client.firm_id);

    if (firmConnected && owner?.isDistinctOwner && owner.email && saved.activated) {
      const mail = accessGrantedEmail({
        recipientName: owner.name,
        actorName: actor.name,
        memberName: member.name,
        memberEmail: member.email,
        clientName,
        firmName: firm.name,
        classification,
      });
      await sendAccessEmail({
        to: owner.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        idempotencyKey: `own-notify-${saved.id}`,
      });
    } else if (!firmConnected && owner?.isDistinctOwner && owner.email) {
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
        classification,
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
      status: (latest?.status as PracticeAccessStatus) ?? (firmConnected ? "active" : "pending"),
      emailedOwner: Boolean(owner?.isDistinctOwner && owner.email),
      emailedAccountant: false,
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
    const { data: revoked } = await admin
      .from("client_practice_access")
      .select("client_id, user_id")
      .eq("id", data.accessId)
      .maybeSingle();
    await writeAudit(admin, {
      actorId: ctx.userId,
      action: "access_revoked",
      firmId: firm.id,
      clientId: revoked?.client_id ? String(revoked.client_id) : null,
      subjectUserId: revoked?.user_id ? String(revoked.user_id) : null,
    });
    return { ok: true as const };
  });

export const saveClientAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        grants: z
          .array(
            z.object({
              clientId: z.string().uuid(),
              classification: z.enum([
                "partner",
                "manager",
                "staff",
                "bookkeeper",
                "reviewer",
                "read_only",
              ]),
            }),
          )
          .max(200),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const ctx = context as AuthCtx;
    const admin = adminLoose();
    const firm = await resolveFirm(admin, ctx.userId);
    if (!firm) throw new Error("No practice found.");
    await assertManager(admin, ctx.userId, firm.id);

    const memberMem = await membershipOf(admin, firm.id, data.userId);
    const ceiling = teamClassOf(memberMem);
    const wanted = new Map(
      data.grants.map((g) => [g.clientId, classAtMost(ceiling, g.classification)] as const),
    );

    const { data: clientRows } = await admin.from("clients").select("id, name").eq("firm_id", firm.id);
    const firmClientIds = new Set((clientRows ?? []).map((c: { id: string }) => String(c.id)));
    for (const id of wanted.keys()) {
      if (!firmClientIds.has(id)) throw new Error("Client is not in this practice.");
    }

    const { data: existing } = await admin
      .from("client_practice_access")
      .select("id, client_id, user_id, status")
      .eq("firm_id", firm.id)
      .eq("user_id", data.userId);

    const keep = new Set(wanted.keys());
    for (const row of existing ?? []) {
      const clientId = String(row.client_id);
      if (keep.has(clientId)) continue;
      if (row.status !== "pending" && row.status !== "active") continue;
      await admin
        .from("client_practice_access")
        .update({
          status: "revoked",
          revoked_at: new Date().toISOString(),
          revoked_by: ctx.userId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      await writeAudit(admin, {
        actorId: ctx.userId,
        action: "access_revoked",
        firmId: firm.id,
        clientId,
        subjectUserId: data.userId,
      });
    }

    const actor = await profileById(admin, ctx.userId);
    const member = await profileById(admin, data.userId);
    let granted = 0;
    for (const [clientId, classification] of wanted) {
      const saved = await upsertPracticeGrant(admin, {
        clientId,
        userId: data.userId,
        firmId: firm.id,
        classification,
        actorId: ctx.userId,
      });
      if (saved.activated) {
        granted += 1;
        const client = (clientRows ?? []).find((c: { id: string }) => String(c.id) === clientId);
        const { data: clientFull } = await admin
          .from("clients")
          .select("id, name, firm_id, owner_user_id, contact_email")
          .eq("id", clientId)
          .maybeSingle();
        if (clientFull) {
          const owner = await ownerContact(admin, clientFull);
          if (owner?.isDistinctOwner && owner.email) {
            const mail = accessGrantedEmail({
              recipientName: owner.name,
              actorName: actor.name,
              memberName: member.name,
              memberEmail: member.email,
              clientName: String(client?.name ?? clientFull.name ?? "Client"),
              firmName: firm.name,
              classification,
            });
            await sendAccessEmail({
              to: owner.email,
              subject: mail.subject,
              html: mail.html,
              text: mail.text,
              idempotencyKey: `own-notify-${saved.id}`,
            });
          }
        }
      }
    }
    return { ok: true as const, granted };
  });

export type OwnerFirmConnection = {
  clientId: string;
  clientName: string;
  firmId: string;
  firmName: string;
};

export const listOwnerPracticeAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({
    context,
  }): Promise<{
    people: OwnerPracticePerson[];
    connections: OwnerFirmConnection[];
    migrationHint: string | null;
  }> => {
    const ctx = context as AuthCtx;
    const admin = adminLoose();
    try {
      const { data: owned } = await admin
        .from("clients")
        .select("id, name, firm_id")
        .eq("owner_user_id", ctx.userId)
        .not("firm_id", "is", null);
      const people: OwnerPracticePerson[] = [];
      const connections: OwnerFirmConnection[] = [];
      for (const client of owned ?? []) {
        let firmName = "Practice";
        if (client.firm_id) {
          const { data: firm } = await admin.from("firms").select("name").eq("id", client.firm_id).maybeSingle();
          firmName = String(firm?.name ?? "Practice");
          connections.push({
            clientId: String(client.id),
            clientName: String(client.name ?? "Business"),
            firmId: String(client.firm_id),
            firmName,
          });
        }
        const { data: rows } = await admin
          .from("client_practice_access")
          .select("id, user_id, classification, status, owner_approved_at, created_at, firm_id")
          .eq("client_id", client.id)
          .eq("status", "active");
        for (const row of rows ?? []) {
          const profile = await profileById(admin, String(row.user_id));
          people.push({
            accessId: String(row.id),
            clientId: String(client.id),
            clientName: String(client.name ?? "Business"),
            firmId: String(row.firm_id ?? client.firm_id ?? ""),
            firmName,
            userId: String(row.user_id),
            name: profile.name,
            email: profile.email,
            classification: parseClassification(row.classification),
            grantedAt: (row.owner_approved_at as string | null) ?? (row.created_at as string | null),
          });
        }
      }
      people.sort((a, b) => a.clientName.localeCompare(b.clientName) || a.name.localeCompare(b.name));
      return { people, connections, migrationHint: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (missingRelation(msg)) {
        return {
          people: [],
          connections: [],
          migrationHint: migrationHintFor(PRACTICE_ACCESS_AMENDMENT_MIGRATION),
        };
      }
      throw e instanceof Error ? e : new Error(msg);
    }
  });

export const ownerRevokePracticeAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ accessId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = context as AuthCtx;
    const admin = adminLoose();
    const { data: row } = await admin
      .from("client_practice_access")
      .select("id, client_id, user_id, firm_id, status")
      .eq("id", data.accessId)
      .maybeSingle();
    if (!row) throw new Error("Access record not found.");
    const { data: client } = await admin
      .from("clients")
      .select("id, owner_user_id")
      .eq("id", row.client_id)
      .maybeSingle();
    if (!client || String(client.owner_user_id) !== ctx.userId) {
      throw new Error("Only the business owner can revoke this access.");
    }
    const { error } = await admin
      .from("client_practice_access")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by: ctx.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.accessId);
    if (error) throw new Error(error.message);
    await writeAudit(admin, {
      actorId: ctx.userId,
      action: "access_revoked",
      firmId: row.firm_id ? String(row.firm_id) : null,
      clientId: String(row.client_id),
      subjectUserId: String(row.user_id),
      details: { by: "owner" },
    });
    return { ok: true as const };
  });

export const ownerDisconnectFirm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = context as AuthCtx;
    const admin = adminLoose();
    const { data: client } = await admin
      .from("clients")
      .select("id, owner_user_id, firm_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client || String(client.owner_user_id) !== ctx.userId) {
      throw new Error("Only the business owner can disconnect the firm.");
    }
    const firmId = client.firm_id ? String(client.firm_id) : null;
    await admin
      .from("client_practice_access")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by: ctx.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", data.clientId)
      .in("status", ["pending", "active"]);
    const { error } = await admin
      .from("clients")
      .update({ firm_id: null, firm_connected_at: null })
      .eq("id", data.clientId)
      .eq("owner_user_id", ctx.userId);
    if (error) throw new Error(error.message);
    await writeAudit(admin, {
      actorId: ctx.userId,
      action: "firm_disconnected",
      firmId,
      clientId: data.clientId,
      details: { by: "owner" },
    });
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
      await writeAudit(loose, {
        actorId: data.userId,
        action: "member_invited",
        firmId: String(invite.firm_id),
        subjectUserId: data.userId,
        details: { accepted: true, email: invite.email },
      });
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
