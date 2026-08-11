import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

export type NoteMention = {
  userId: string;
  email: string;
  name: string;
  handle: string;
};

export type NoteReply = {
  id: string;
  text: string;
  authorId: string;
  author: string;
  authorEmail: string | null;
  timestamp: string;
  mentions: NoteMention[];
};

export type ClientNote = {
  id: string;
  clientId: string;
  tab: string;
  x: number;
  y: number;
  text: string;
  authorId: string;
  author: string;
  authorEmail: string | null;
  timestamp: string;
  resolved: boolean;
  mentions: NoteMention[];
  replies: NoteReply[];
};

export type NoteCollaborator = {
  userId: string;
  email: string;
  name: string;
  handle: string;
  roleLabel: string;
};

type LooseSb = { from: (t: string) => any; rpc: (...args: any[]) => any };

function authedSupabase() {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) throw new Error("Missing Supabase env vars");
  const req = getRequest();
  const token = req?.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  return createClient<Database>(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

async function assertClientAccess(
  userId: string,
  clientId: string,
  sb: ReturnType<typeof authedSupabase>,
) {
  const { data, error } = await sb.rpc("has_client_access" as never, {
    _user_id: userId,
    _client_id: clientId,
  } as never);
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have access to this client");
}

function handleFrom(email: string | null | undefined, name: string): string {
  const local = (email ?? "").split("@")[0]?.trim();
  if (local) return local.toLowerCase().replace(/[^a-z0-9._-]/g, "");
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 32);
}

function parseMentions(raw: unknown): NoteMention[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => {
      if (!m || typeof m !== "object") return null;
      const o = m as Record<string, unknown>;
      const userId = typeof o.userId === "string" ? o.userId : "";
      const email = typeof o.email === "string" ? o.email : "";
      const name = typeof o.name === "string" ? o.name : email;
      const handle =
        typeof o.handle === "string" && o.handle
          ? o.handle
          : handleFrom(email, name);
      if (!userId || !email) return null;
      return { userId, email, name, handle };
    })
    .filter((m): m is NoteMention => !!m);
}

function mapNote(
  row: Record<string, unknown>,
  replies: NoteReply[] = [],
): ClientNote {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    tab: String(row.tab ?? "overview"),
    x: Number(row.x ?? 0),
    y: Number(row.y ?? 0),
    text: String(row.body ?? ""),
    authorId: String(row.author_id),
    author: String(row.author_name ?? "User"),
    authorEmail: (row.author_email as string | null) ?? null,
    timestamp: String(row.created_at ?? new Date().toISOString()),
    resolved: Boolean(row.resolved),
    mentions: parseMentions(row.mentions),
    replies,
  };
}

function mapReply(row: Record<string, unknown>): NoteReply {
  return {
    id: String(row.id),
    text: String(row.body ?? ""),
    authorId: String(row.author_id),
    author: String(row.author_name ?? "User"),
    authorEmail: (row.author_email as string | null) ?? null,
    timestamp: String(row.created_at ?? new Date().toISOString()),
    mentions: parseMentions(row.mentions),
  };
}

const mentionSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email().max(200),
  name: z.string().min(1).max(120),
  handle: z.string().min(1).max(64),
});

function authorFromUser(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}) {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta.name === "string" && meta.name.trim()) ||
    (user.email ? user.email.split("@")[0] : null) ||
    "User";
  return {
    authorId: user.id,
    authorName: name,
    authorEmail: user.email ?? null,
  };
}

/** Everyone with access to this client who can be @mentioned. */
export const listNoteCollaborators = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);

    const admin = supabaseAdmin as unknown as LooseSb;
    const { data: client, error: clientErr } = await admin
      .from("clients")
      .select("id, name, owner_user_id, firm_id, contact_email")
      .eq("id", data.clientId)
      .maybeSingle();
    if (clientErr) throw new Error(clientErr.message);
    if (!client) throw new Error("Client not found");

    const userIds = new Set<string>();
    const roleByUser = new Map<string, string>();
    if (client.owner_user_id) {
      userIds.add(client.owner_user_id);
      roleByUser.set(client.owner_user_id, "Owner");
    }

    const { data: members } = await admin
      .from("client_memberships")
      .select("user_id, role")
      .eq("client_id", data.clientId);
    for (const m of members ?? []) {
      userIds.add(m.user_id);
      if (!roleByUser.has(m.user_id)) {
        roleByUser.set(
          m.user_id,
          m.role === "client_owner" ? "Owner" : "Team",
        );
      }
    }

    if (client.firm_id) {
      const { data: firmMembers } = await admin
        .from("firm_memberships")
        .select("user_id")
        .eq("firm_id", client.firm_id);
      for (const fm of firmMembers ?? []) {
        userIds.add(fm.user_id);
        if (!roleByUser.has(fm.user_id)) roleByUser.set(fm.user_id, "Accountant");
      }
    }

    const ids = [...userIds];
    const { data: profiles } = ids.length
      ? await admin.from("profiles").select("id, email, full_name").in("id", ids)
      : { data: [] as { id: string; email: string | null; full_name: string | null }[] };

    const byId = new Map(
      (profiles ?? []).map((p: { id: string; email: string | null; full_name: string | null }) => [
        p.id,
        p,
      ]),
    );

    const collaborators: NoteCollaborator[] = [];
    for (const id of ids) {
      const p = byId.get(id) as
        | { id: string; email: string | null; full_name: string | null }
        | undefined;
      const email = (p?.email ?? "").trim();
      if (!email) continue;
      const name = (p?.full_name ?? "").trim() || email.split("@")[0];
      collaborators.push({
        userId: id,
        email,
        name,
        handle: handleFrom(email, name),
        roleLabel: roleByUser.get(id) ?? "Access",
      });
    }

    // Deduplicate by handle (prefer owner label)
    const seen = new Set<string>();
    const unique = collaborators.filter((c) => {
      const key = c.handle.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    unique.sort((a, b) => a.name.localeCompare(b.name));
    return {
      clientName: (client.name as string) ?? "Client",
      collaborators: unique,
    };
  });

export const listClientNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);

    const loose = sb as unknown as LooseSb;
    const { data: notes, error } = await loose
      .from("client_notes")
      .select("*")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const noteIds = (notes ?? []).map((n: { id: string }) => n.id);
    let replies: Record<string, unknown>[] = [];
    if (noteIds.length > 0) {
      const { data: replyRows, error: replyErr } = await loose
        .from("client_note_replies")
        .select("*")
        .in("note_id", noteIds)
        .order("created_at", { ascending: true });
      if (replyErr) throw new Error(replyErr.message);
      replies = replyRows ?? [];
    }

    const repliesByNote = new Map<string, NoteReply[]>();
    for (const r of replies) {
      const noteId = String(r.note_id);
      const list = repliesByNote.get(noteId) ?? [];
      list.push(mapReply(r));
      repliesByNote.set(noteId, list);
    }

    return {
      notes: (notes ?? []).map((n: Record<string, unknown>) =>
        mapNote(n, repliesByNote.get(String(n.id)) ?? []),
      ) as ClientNote[],
    };
  });

export const createClientNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        tab: z.string().min(1).max(64),
        x: z.number().finite(),
        y: z.number().finite(),
        text: z.string().trim().min(1).max(4000),
        mentions: z.array(mentionSchema).max(20).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);

    const author = authorFromUser(userData.user);
    // Never email yourself for self-mentions
    const mentions = data.mentions.filter((m) => m.userId !== author.authorId);

    const loose = sb as unknown as LooseSb;
    const { data: row, error } = await loose
      .from("client_notes")
      .insert({
        client_id: data.clientId,
        tab: data.tab,
        x: data.x,
        y: data.y,
        body: data.text,
        author_id: author.authorId,
        author_name: author.authorName,
        author_email: author.authorEmail,
        mentions,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    return {
      note: mapNote(row as Record<string, unknown>, []),
      notifyMentions: mentions,
      authorName: author.authorName,
    };
  });

export const replyToClientNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        noteId: z.string().uuid(),
        text: z.string().trim().min(1).max(4000),
        mentions: z.array(mentionSchema).max(20).default([]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);

    const author = authorFromUser(userData.user);
    const mentions = data.mentions.filter((m) => m.userId !== author.authorId);

    const loose = sb as unknown as LooseSb;
    const { data: parent, error: parentErr } = await loose
      .from("client_notes")
      .select("id, client_id")
      .eq("id", data.noteId)
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (parentErr) throw new Error(parentErr.message);
    if (!parent) throw new Error("Note not found");

    const { data: row, error } = await loose
      .from("client_note_replies")
      .insert({
        note_id: data.noteId,
        client_id: data.clientId,
        body: data.text,
        author_id: author.authorId,
        author_name: author.authorName,
        author_email: author.authorEmail,
        mentions,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    return {
      reply: mapReply(row as Record<string, unknown>),
      notifyMentions: mentions,
      authorName: author.authorName,
    };
  });

export const resolveClientNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        noteId: z.string().uuid(),
        resolved: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);

    const loose = sb as unknown as LooseSb;
    const { data: existing, error: findErr } = await loose
      .from("client_notes")
      .select("id, resolved")
      .eq("id", data.noteId)
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!existing) throw new Error("Note not found");

    const next =
      typeof data.resolved === "boolean" ? data.resolved : !existing.resolved;

    const { data: row, error } = await loose
      .from("client_notes")
      .update({ resolved: next })
      .eq("id", data.noteId)
      .eq("client_id", data.clientId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { noteId: data.noteId, resolved: Boolean(row.resolved) };
  });

export const deleteClientNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        clientId: z.string().uuid(),
        noteId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sb = authedSupabase();
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("Not authenticated");
    await assertClientAccess(userData.user.id, data.clientId, sb);

    const loose = sb as unknown as LooseSb;
    const { error } = await loose
      .from("client_notes")
      .delete()
      .eq("id", data.noteId)
      .eq("client_id", data.clientId)
      .eq("author_id", userData.user.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Match @handles in free text against the collaborator directory. */
export function extractMentionsFromText(
  text: string,
  collaborators: NoteCollaborator[],
): NoteMention[] {
  if (!text || collaborators.length === 0) return [];
  const byHandle = new Map(
    collaborators.map((c) => [c.handle.toLowerCase(), c]),
  );
  // Also allow @FirstName when unique
  for (const c of collaborators) {
    const first = c.name.split(/\s+/)[0]?.toLowerCase();
    if (first && !byHandle.has(first)) byHandle.set(first, c);
  }

  const found = new Map<string, NoteMention>();
  const re = /@([a-zA-Z0-9._-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const hit = byHandle.get(m[1].toLowerCase());
    if (hit) {
      found.set(hit.userId, {
        userId: hit.userId,
        email: hit.email,
        name: hit.name,
        handle: hit.handle,
      });
    }
  }
  return [...found.values()];
}
