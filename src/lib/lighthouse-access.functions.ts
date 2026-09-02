/**
 * Lighthouse Access — platform-wide roles, firms, and client assignments.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  adminLoose,
  assertOpsConsoleAccess,
  migrationHintFor,
  missingRelation,
  type AuthCtx,
} from "@/lib/owner-ops.guard";
import {
  PRACTICE_ACCESS_MIGRATION,
  PRACTICE_CLIENT_ACCESS_CAP,
  parseClassification,
  parseMembershipRole,
  type MembershipRole,
  type PracticeAccessStatus,
  type PracticeClassification,
} from "@/lib/practice-access";

export type LighthouseAccessUser = {
  id: string;
  email: string;
  name: string;
  roles: string[];
  firms: Array<{ id: string; name: string; role: MembershipRole }>;
  clientAccess: Array<{
    accessId: string;
    clientId: string;
    clientName: string;
    classification: PracticeClassification;
    status: PracticeAccessStatus;
  }>;
  ownedClients: Array<{ id: string; name: string }>;
};

export type LighthouseAccessBoard = {
  users: LighthouseAccessUser[];
  firms: Array<{ id: string; name: string }>;
  clients: Array<{ id: string; name: string; firmId: string | null; firmName: string | null }>;
  cap: number;
  migrationHint: string | null;
};

export const getLighthouseAccessBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LighthouseAccessBoard> => {
    await assertOpsConsoleAccess(context as AuthCtx);
    const admin = adminLoose();
    try {
      const { data: profiles, error: pErr } = await admin
        .from("profiles")
        .select("id, email, full_name")
        .order("created_at", { ascending: false })
        .limit(400);
      if (pErr) throw pErr;

      const { data: roleRows } = await admin.from("user_roles").select("user_id, role");
      const { data: memRows } = await admin
        .from("firm_memberships")
        .select("user_id, firm_id, role");
      const { data: firms } = await admin.from("firms").select("id, name, owner_user_id");
      const { data: clients } = await admin.from("clients").select("id, name, firm_id, owner_user_id");
      const { data: accessRows } = await admin
        .from("client_practice_access")
        .select("id, client_id, user_id, classification, status");

      const firmName = new Map((firms ?? []).map((f: { id: string; name: string }) => [String(f.id), String(f.name)]));
      const clientName = new Map((clients ?? []).map((c: { id: string; name: string }) => [String(c.id), String(c.name)]));

      const rolesByUser = new Map<string, string[]>();
      for (const r of roleRows ?? []) {
        const uid = String(r.user_id);
        const list = rolesByUser.get(uid) ?? [];
        list.push(String(r.role));
        rolesByUser.set(uid, list);
      }

      const firmsByUser = new Map<string, Array<{ id: string; name: string; role: MembershipRole }>>();
      for (const m of memRows ?? []) {
        const uid = String(m.user_id);
        const list = firmsByUser.get(uid) ?? [];
        list.push({
          id: String(m.firm_id),
          name: firmName.get(String(m.firm_id)) ?? "Firm",
          role: parseMembershipRole(m.role),
        });
        firmsByUser.set(uid, list);
      }
      for (const f of firms ?? []) {
        const uid = String(f.owner_user_id ?? "");
        if (!uid) continue;
        const list = firmsByUser.get(uid) ?? [];
        if (!list.some((x) => x.id === String(f.id))) {
          list.push({ id: String(f.id), name: String(f.name), role: "owner" });
          firmsByUser.set(uid, list);
        }
      }

      const accessByUser = new Map<string, LighthouseAccessUser["clientAccess"]>();
      for (const a of accessRows ?? []) {
        const uid = String(a.user_id);
        const list = accessByUser.get(uid) ?? [];
        list.push({
          accessId: String(a.id),
          clientId: String(a.client_id),
          clientName: clientName.get(String(a.client_id)) ?? "Client",
          classification: parseClassification(a.classification),
          status: (a.status as PracticeAccessStatus) ?? "pending",
        });
        accessByUser.set(uid, list);
      }

      const ownedByUser = new Map<string, Array<{ id: string; name: string }>>();
      for (const c of clients ?? []) {
        const uid = String(c.owner_user_id ?? "");
        if (!uid) continue;
        const list = ownedByUser.get(uid) ?? [];
        list.push({ id: String(c.id), name: String(c.name ?? "Client") });
        ownedByUser.set(uid, list);
      }

      const users: LighthouseAccessUser[] = (profiles ?? []).map((p: { id: string; email: string | null; full_name: string | null }) => ({
        id: String(p.id),
        email: String(p.email ?? ""),
        name: String(p.full_name ?? p.email ?? "User"),
        roles: rolesByUser.get(String(p.id)) ?? [],
        firms: firmsByUser.get(String(p.id)) ?? [],
        clientAccess: accessByUser.get(String(p.id)) ?? [],
        ownedClients: ownedByUser.get(String(p.id)) ?? [],
      }));

      return {
        users,
        firms: (firms ?? []).map((f: { id: string; name: string }) => ({ id: String(f.id), name: String(f.name) })),
        clients: (clients ?? []).map((c: { id: string; name: string; firm_id: string | null }) => ({
          id: String(c.id),
          name: String(c.name ?? "Client"),
          firmId: c.firm_id ? String(c.firm_id) : null,
          firmName: c.firm_id ? firmName.get(String(c.firm_id)) ?? null : null,
        })),
        cap: PRACTICE_CLIENT_ACCESS_CAP,
        migrationHint: null,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (missingRelation(msg)) {
        return {
          users: [],
          firms: [],
          clients: [],
          cap: PRACTICE_CLIENT_ACCESS_CAP,
          migrationHint: migrationHintFor(PRACTICE_ACCESS_MIGRATION),
        };
      }
      throw e instanceof Error ? e : new Error(msg);
    }
  });

export const lighthouseGrantClientAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        clientId: z.string().uuid(),
        classification: z
          .enum(["partner", "manager", "staff", "bookkeeper", "reviewer", "read_only"])
          .default("staff"),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { userId } = await assertOpsConsoleAccess(context as AuthCtx);
    const admin = adminLoose();
    const { data: client } = await admin
      .from("clients")
      .select("id, firm_id")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!client?.firm_id) throw new Error("Client has no practice firm — assign a firm first.");
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
    const occupying =
      (count ?? 0) - (existing && (existing.status === "pending" || existing.status === "active") ? 1 : 0);
    if (occupying >= PRACTICE_CLIENT_ACCESS_CAP) {
      throw new Error(`Cap is ${PRACTICE_CLIENT_ACCESS_CAP} practice users on one client.`);
    }
    const now = new Date().toISOString();
    const { error } = await admin.from("client_practice_access").upsert(
      {
        client_id: data.clientId,
        user_id: data.userId,
        firm_id: client.firm_id,
        classification: data.classification,
        status: "active",
        requested_by: userId,
        accountant_approved_at: now,
        accountant_approved_by: userId,
        owner_approved_at: now,
        owner_approved_by: userId,
        revoked_at: null,
        updated_at: now,
      },
      { onConflict: "client_id,user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const lighthouseRevokeClientAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ accessId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { userId } = await assertOpsConsoleAccess(context as AuthCtx);
    const admin = adminLoose();
    const { error } = await admin
      .from("client_practice_access")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.accessId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const lighthouseSetUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(["accountant", "firm_admin", "client_owner", "client_member"]),
        enabled: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertOpsConsoleAccess(context as AuthCtx);
    const admin = adminLoose();
    if (data.enabled) {
      const { error } = await admin.from("user_roles").upsert(
        { user_id: data.userId, role: data.role },
        { onConflict: "user_id,role" },
      );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });
