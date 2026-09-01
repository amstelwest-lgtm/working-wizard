/**
 * Milōn IT section — tagged client notes + IT team list.
 * Deny-all RLS; service role after platform-owner or IT-member guard.
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
import { clientNoteProfilePath } from "@/lib/client-note-link";
import { inviteSiteUrl } from "@/lib/client-invite-email";

export const IT_QUERIES_MIGRATION = "20260901140000_milon_it_queries.sql";

export type LighthouseItMember = {
  id: string;
  email: string;
  name: string;
  userId: string | null;
  createdAt: string;
};

export type LighthouseItQuery = {
  id: string;
  clientId: string;
  clientName: string;
  tab: string;
  body: string;
  authorName: string;
  authorEmail: string | null;
  taggedAt: string;
  resolved: boolean;
  profilePath: string;
  profileUrl: string;
};

export type LighthouseItBoard = {
  queries: LighthouseItQuery[];
  members: LighthouseItMember[];
  migrationHint: string | null;
};

function mapMember(row: Record<string, unknown>): LighthouseItMember {
  return {
    id: String(row.id),
    email: String(row.email ?? ""),
    name: String(row.name ?? ""),
    userId: (row.user_id as string | null) ?? null,
    createdAt: String(row.created_at ?? ""),
  };
}

async function lookupUserIdByEmail(email: string): Promise<string | null> {
  const admin = adminLoose();
  const { data } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

export const getLighthouseItBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LighthouseItBoard> => {
    await assertOpsConsoleAccess(context as AuthCtx);
    const admin = adminLoose();
    const origin = inviteSiteUrl();

    let members: LighthouseItMember[] = [];
    try {
      const { data, error } = await admin
        .from("milon_it_members")
        .select("id, email, name, user_id, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      members = (data ?? []).map((r: Record<string, unknown>) => mapMember(r));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (missingRelation(msg)) {
        return {
          queries: [],
          members: [],
          migrationHint: migrationHintFor(IT_QUERIES_MIGRATION),
        };
      }
      throw e instanceof Error ? e : new Error(msg);
    }

    const { data: notes, error: noteErr } = await admin
      .from("client_notes")
      .select(
        "id, client_id, tab, body, author_name, author_email, tagged_milon_it_at, created_at, resolved",
      )
      .eq("tagged_milon_it", true)
      .order("tagged_milon_it_at", { ascending: false, nullsFirst: false });
    if (noteErr) throw new Error(noteErr.message);

    const clientIds = [
      ...new Set((notes ?? []).map((n: { client_id: string }) => String(n.client_id))),
    ];
    const nameById = new Map<string, string>();
    if (clientIds.length > 0) {
      const { data: clientRows } = await admin
        .from("clients")
        .select("id, name")
        .in("id", clientIds);
      for (const c of clientRows ?? []) {
        nameById.set(String(c.id), String(c.name ?? "Client"));
      }
    }

    const queries: LighthouseItQuery[] = (notes ?? []).map((row: Record<string, unknown>) => {
      const clientId = String(row.client_id);
      const noteId = String(row.id);
      const tab = String(row.tab ?? "");
      const taggedAt = String(row.tagged_milon_it_at ?? row.created_at ?? "");
      const path = clientNoteProfilePath(clientId, noteId, tab);
      return {
        id: noteId,
        clientId,
        clientName: nameById.get(clientId) ?? "Client",
        tab,
        body: String(row.body ?? ""),
        authorName: String(row.author_name ?? "User"),
        authorEmail: (row.author_email as string | null) ?? null,
        taggedAt,
        resolved: Boolean(row.resolved),
        profilePath: path,
        profileUrl: `${origin}${path}`,
      };
    });

    return { queries, members, migrationHint: null };
  });

export const addLighthouseItMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email().max(200),
        name: z.string().trim().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { userId } = await assertOpsConsoleAccess(context as AuthCtx);
    const admin = adminLoose();
    const email = data.email.trim().toLowerCase();
    const name = (data.name ?? "").trim() || email.split("@")[0];
    const linkedUserId = await lookupUserIdByEmail(email);

    const { data: row, error } = await admin
      .from("milon_it_members")
      .upsert(
        {
          email,
          name,
          user_id: linkedUserId,
          created_by: userId,
        },
        { onConflict: "email" },
      )
      .select("id, email, name, user_id, created_at")
      .single();
    if (error) throw new Error(error.message);
    return { member: mapMember(row as Record<string, unknown>) };
  });

export const removeLighthouseItMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    await assertOpsConsoleAccess(context as AuthCtx);
    const admin = adminLoose();
    const { error } = await admin.from("milon_it_members").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
