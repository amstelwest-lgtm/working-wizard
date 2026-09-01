/**
 * Lighthouse Access — every profile that can enter Milōn:
 * portal roles, practice firms, business files, and IT flag.
 * Deny-all RLS tables stay untouched; all writes go through service role
 * after owner/IT ops-console guard.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  adminLoose,
  assertOpsConsoleAccess,
  missingRelation,
  type AuthCtx,
  type LooseAdmin,
} from "@/lib/owner-ops.guard";

export const PORTAL_ROLES = ["accountant", "firm_admin", "client_owner", "client_member"] as const;
export type PortalRole = (typeof PORTAL_ROLES)[number];

export type LighthouseAccessUser = {
  id: string;
  email: string;
  name: string;
  roles: PortalRole[];
  itMember: boolean;
  firms: Array<{ id: string; name: string; role: string; membershipId: string | null }>;
  ownedClients: Array<{ id: string; name: string }>;
  clientMemberships: Array<{ id: string; clientId: string; clientName: string; role: string }>;
};

export type LighthouseAccessBoard = {
  users: LighthouseAccessUser[];
  firms: Array<{ id: string; name: string }>;
  clients: Array<{ id: string; name: string; firmName: string | null }>;
  itEmails: string[];
};

async function rowsOrEmpty(
  admin: LooseAdmin,
  table: string,
  columns: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await admin.from(table).select(columns);
  if (error) {
    if (missingRelation(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as Record<string, unknown>[];
}

function asPortalRoles(list: string[]): PortalRole[] {
  return list.filter((r): r is PortalRole => (PORTAL_ROLES as readonly string[]).includes(r));
}

export const getLighthouseAccessBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LighthouseAccessBoard> => {
    await assertOpsConsoleAccess(context as AuthCtx);
    const admin = adminLoose();

    const { data: profiles, error: pErr } = await admin
      .from("profiles")
      .select("id, email, full_name")
      .order("created_at", { ascending: false })
      .limit(500);
    if (pErr) throw new Error(pErr.message);

    const [roleRows, memRows, firms, clients, clientMems, itMembers] = await Promise.all([
      rowsOrEmpty(admin, "user_roles", "user_id, role"),
      rowsOrEmpty(admin, "firm_memberships", "id, user_id, firm_id, role"),
      rowsOrEmpty(admin, "firms", "id, name, owner_user_id"),
      rowsOrEmpty(admin, "clients", "id, name, firm_id, owner_user_id"),
      rowsOrEmpty(admin, "client_memberships", "id, client_id, user_id, role"),
      rowsOrEmpty(admin, "milon_it_members", "email"),
    ]);

    const firmName = new Map(firms.map((f) => [String(f.id), String(f.name ?? "Firm")]));
    const clientName = new Map(clients.map((c) => [String(c.id), String(c.name ?? "Client")]));
    const itEmails = itMembers
      .map((m) => String(m.email ?? "").trim().toLowerCase())
      .filter(Boolean);

    const rolesByUser = new Map<string, string[]>();
    for (const r of roleRows) {
      const uid = String(r.user_id);
      const list = rolesByUser.get(uid) ?? [];
      list.push(String(r.role));
      rolesByUser.set(uid, list);
    }

    const firmsByUser = new Map<string, LighthouseAccessUser["firms"]>();
    for (const m of memRows) {
      const uid = String(m.user_id);
      const list = firmsByUser.get(uid) ?? [];
      list.push({
        id: String(m.firm_id),
        name: firmName.get(String(m.firm_id)) ?? "Firm",
        role: String(m.role ?? "member"),
        membershipId: String(m.id),
      });
      firmsByUser.set(uid, list);
    }
    for (const f of firms) {
      const uid = String(f.owner_user_id ?? "");
      if (!uid) continue;
      const list = firmsByUser.get(uid) ?? [];
      if (!list.some((x) => x.id === String(f.id))) {
        list.push({ id: String(f.id), name: String(f.name ?? "Firm"), role: "owner", membershipId: null });
        firmsByUser.set(uid, list);
      }
    }

    const ownedByUser = new Map<string, Array<{ id: string; name: string }>>();
    for (const c of clients) {
      const uid = String(c.owner_user_id ?? "");
      if (!uid) continue;
      const list = ownedByUser.get(uid) ?? [];
      list.push({ id: String(c.id), name: String(c.name ?? "Client") });
      ownedByUser.set(uid, list);
    }

    const clientMemByUser = new Map<string, LighthouseAccessUser["clientMemberships"]>();
    for (const m of clientMems) {
      const uid = String(m.user_id);
      const list = clientMemByUser.get(uid) ?? [];
      list.push({
        id: String(m.id),
        clientId: String(m.client_id),
        clientName: clientName.get(String(m.client_id)) ?? "Client",
        role: String(m.role ?? "member"),
      });
      clientMemByUser.set(uid, list);
    }

    const users: LighthouseAccessUser[] = (profiles ?? []).map(
      (p: { id: string; email: string | null; full_name: string | null }) => {
        const email = String(p.email ?? "");
        return {
          id: String(p.id),
          email,
          name: String(p.full_name ?? p.email ?? "User"),
          roles: asPortalRoles(rolesByUser.get(String(p.id)) ?? []),
          itMember: itEmails.includes(email.trim().toLowerCase()),
          firms: firmsByUser.get(String(p.id)) ?? [],
          ownedClients: ownedByUser.get(String(p.id)) ?? [],
          clientMemberships: clientMemByUser.get(String(p.id)) ?? [],
        };
      },
    );

    return {
      users,
      firms: firms.map((f) => ({ id: String(f.id), name: String(f.name ?? "Firm") })),
      clients: clients.map((c) => ({
        id: String(c.id),
        name: String(c.name ?? "Client"),
        firmName: c.firm_id ? firmName.get(String(c.firm_id)) ?? null : null,
      })),
      itEmails,
    };
  });

export const lighthouseSetUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        role: z.enum(PORTAL_ROLES),
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

export const lighthouseSetFirmMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        firmId: z.string().uuid(),
        enabled: z.boolean(),
        role: z.enum(["member", "admin"]).default("member"),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertOpsConsoleAccess(context as AuthCtx);
    const admin = adminLoose();
    if (data.enabled) {
      const { error } = await admin.from("firm_memberships").upsert(
        { firm_id: data.firmId, user_id: data.userId, role: data.role },
        { onConflict: "firm_id,user_id" },
      );
      if (error) throw new Error(error.message);
      const { error: roleErr } = await admin.from("user_roles").upsert(
        { user_id: data.userId, role: "accountant" },
        { onConflict: "user_id,role" },
      );
      if (roleErr && !/duplicate|unique/i.test(roleErr.message)) throw new Error(roleErr.message);
    } else {
      const { error } = await admin
        .from("firm_memberships")
        .delete()
        .eq("firm_id", data.firmId)
        .eq("user_id", data.userId);
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });

export const lighthouseSetClientMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        clientId: z.string().uuid(),
        enabled: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertOpsConsoleAccess(context as AuthCtx);
    const admin = adminLoose();
    if (data.enabled) {
      const { error } = await admin.from("client_memberships").upsert(
        { client_id: data.clientId, user_id: data.userId, role: "member" },
        { onConflict: "client_id,user_id" },
      );
      if (error) throw new Error(error.message);
      const { error: roleErr } = await admin.from("user_roles").upsert(
        { user_id: data.userId, role: "client_member" },
        { onConflict: "user_id,role" },
      );
      if (roleErr && !/duplicate|unique/i.test(roleErr.message)) throw new Error(roleErr.message);
    } else {
      const { error } = await admin
        .from("client_memberships")
        .delete()
        .eq("client_id", data.clientId)
        .eq("user_id", data.userId);
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
  });
