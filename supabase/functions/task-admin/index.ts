// MILŌN Action Plan — authenticated admin endpoint.
// POST { action: "mint", action_item_id }              → ensure active token, return raw link token
// POST { action: "reassign", action_item_id, employee_id } → revoke old tokens, set owner, mint new
// POST { action: "revoke", action_item_id }            → revoke all tokens for the item
// Caller must be an app user with access to the item's client (has_client_access).
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { "content-type": "application/json", ...CORS },
  });

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function mintToken(actionItemId: string, employeeId: string, dueDate: string | null) {
  // Reuse an active token if one exists for this assignee.
  const { data: existing } = await db
    .from("action_tokens")
    .select("id")
    .eq("action_item_id", actionItemId)
    .eq("employee_id", employeeId)
    .is("revoked_at", null)
    .gte("expires_at", new Date().toISOString())
    .maybeSingle();

  const raw = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(
    (dueDate ? new Date(dueDate).getTime() : Date.now()) + 60 * 86400_000,
  ).toISOString();

  if (existing) {
    // Rotate content but keep "one token per task per assignee": revoke & re-mint
    // is unnecessary — we cannot recover the raw token, so mint a fresh one and
    // revoke the old row to keep the invariant.
    await db.from("action_tokens").update({ revoked_at: new Date().toISOString() }).eq("id", existing.id);
  }
  const { error } = await db.from("action_tokens").insert({
    action_item_id: actionItemId,
    employee_id: employeeId,
    token_hash: await sha256hex(raw),
    expires_at: expires,
  });
  if (error) throw new Error("token_insert_failed");
  return raw;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Identify caller from JWT.
  const authHeader = req.headers.get("authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);

  let body: { action?: string; action_item_id?: string; employee_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const { action, action_item_id, employee_id } = body;
  if (!action || !action_item_id) return json({ error: "bad_request" }, 400);

  const { data: item } = await db
    .from("action_items")
    .select("id, client_id, owner_id, due_date, title")
    .eq("id", action_item_id)
    .single();
  if (!item) return json({ error: "not_found" }, 404);

  // Authorise: caller must be the client owner or a firm member.
  // client_member (invited) users are explicitly excluded — they cannot mint
  // tokens, reassign ownership, or revoke links even if they share client access.
  const { data: allowed } = await db.rpc("is_action_plan_writer", {
    _user_id: userId,
    _client_id: item.client_id,
  });
  if (!allowed) return json({ error: "forbidden" }, 403);

  try {
    if (action === "mint") {
      if (!item.owner_id) return json({ error: "no_owner" }, 400);
      // Tenant boundary: owner must belong to the item's client.
      const { data: emp } = await db
        .from("client_employees")
        .select("id, client_id")
        .eq("id", item.owner_id)
        .single();
      if (!emp || emp.client_id !== item.client_id) {
        return json({ error: "employee_not_in_client" }, 403);
      }
      const raw = await mintToken(item.id, item.owner_id, item.due_date);
      return json({ token: raw });
    }

    if (action === "reassign") {
      if (!employee_id) return json({ error: "bad_request" }, 400);
      // Tenant boundary: the new owner must belong to the same client.
      const { data: emp } = await db
        .from("client_employees")
        .select("id, client_id")
        .eq("id", employee_id)
        .single();
      if (!emp || emp.client_id !== item.client_id) {
        return json({ error: "employee_not_in_client" }, 403);
      }
      // Old links stop working immediately.
      await db
        .from("action_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("action_item_id", item.id)
        .is("revoked_at", null);
      await db.from("action_items").update({ owner_id: employee_id }).eq("id", item.id);
      const raw = await mintToken(item.id, employee_id, item.due_date);
      return json({ token: raw });
    }

    if (action === "revoke") {
      await db
        .from("action_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("action_item_id", item.id)
        .is("revoked_at", null);
      return json({ ok: true });
    }
  } catch (e) {
    return json({ error: (e as Error).message ?? "failed" }, 500);
  }

  return json({ error: "unknown_action" }, 400);
});
