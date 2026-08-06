// MILŌN Action Plan — public tokenised task endpoint.
// GET  /task-link/:token  → read-only task payload (safe for mail-scanner prefetch)
// POST /task-link/:token  → apply an update (status / progress / milestones / note)
// A GET must NEVER change data. Outlook Safe Links & Gmail proxies prefetch URLs.
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_ADDRESS = "MILŌN <noreply@notify.milon.co.za>";

// ── Owner notification email ──────────────────────────────────────────────────

function buildOwnerNotificationHtml(opts: {
  employeeName: string;
  taskTitle: string;
  newStatus: string;
  note: string | null;
  actionPlanUrl: string;
  businessName: string | null;
}): { html: string; text: string; subject: string } {
  const { employeeName, taskTitle, newStatus, note, actionPlanUrl, businessName } = opts;

  const statusLabel: Record<string, string> = {
    not_started: "Not started",
    in_progress: "In progress",
    done: "Done ✓",
    blocked: "Blocked",
  };
  const statusDisplay = statusLabel[newStatus] ?? newStatus;
  const isBlocked = newStatus === "blocked";
  const statusColour = newStatus === "done" ? "#22c55e" : isBlocked ? "#ef4444" : "#b8860b";

  const subject = isBlocked
    ? `${employeeName} is blocked on "${taskTitle}"`
    : newStatus === "done"
      ? `${employeeName} completed "${taskTitle}"`
      : `${employeeName} updated "${taskTitle}"`;

  const noteLine = note
    ? `<p style="font-size:14px;color:#334155;line-height:1.5;margin:12px 0 0"><strong>Note:</strong> ${note}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#ffffff;font-family:Arial,sans-serif;margin:0;padding:0">
  <div style="padding:24px 28px;max-width:600px">
    <h1 style="font-size:18px;font-weight:bold;color:#0f172a;margin:0 0 14px">
      ${businessName ? `Action plan update · ${businessName}` : "Action plan update"}
    </h1>
    <p style="font-size:14px;color:#334155;line-height:1.5;margin:0 0 14px">
      <strong>${employeeName}</strong> just updated their task:
    </p>

    <div style="border:1px solid #e7dcc3;border-left:3px solid ${statusColour};border-radius:8px;padding:16px 18px;margin:8px 0 4px;background:#fdfaf3">
      <p style="font-size:15px;font-weight:bold;letter-spacing:0.04em;color:#0f172a;margin:0 0 6px">
        ${taskTitle.toUpperCase()}
      </p>
      <p style="font-size:13px;font-weight:bold;color:${statusColour};margin:0">
        ${statusDisplay}
      </p>
      ${noteLine}
    </div>

    <div style="margin:20px 0">
      <a href="${actionPlanUrl}" style="background:#b8860b;color:#ffffff;font-size:13px;font-weight:bold;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">
        View action plan →
      </a>
    </div>

    <p style="font-size:12px;color:#94a3b8;margin:20px 0 0">— MILŌN${businessName ? ` · ${businessName}` : ""}</p>
  </div>
</body>
</html>`;

  const text = [
    businessName ? `Action plan update · ${businessName}` : "Action plan update",
    "",
    `${employeeName} just updated their task:`,
    "",
    taskTitle.toUpperCase(),
    statusDisplay,
    note ? `Note: ${note}` : "",
    "",
    `View action plan: ${actionPlanUrl}`,
    "",
    `— MILŌN${businessName ? ` · ${businessName}` : ""}`,
  ].filter((l) => l !== undefined).join("\n");

  return { html, text, subject };
}

async function sendOwnerNotification(opts: {
  db: ReturnType<typeof createClient>;
  clientId: string;
  employeeName: string;
  taskTitle: string;
  newStatus: string;
  note: string | null;
  actionItemId: string;
  siteUrl: string;
  resendApiKey: string;
}): Promise<boolean> {
  try {
    // Look up the client record to get the owner's user ID and business name.
    const { data: client } = await opts.db
      .from("clients")
      .select("owner_user_id, name")
      .eq("id", opts.clientId)
      .maybeSingle();
    if (!client?.owner_user_id) return false;

    // Get the owner's email from auth.admin — service role has access.
    const { data: { user: ownerUser } } = await opts.db.auth.admin.getUserById(
      client.owner_user_id,
    );
    const ownerEmail = ownerUser?.email;
    if (!ownerEmail) return false;

    // Suppression check.
    const { data: suppressed } = await opts.db
      .from("suppressed_emails")
      .select("id")
      .eq("email", ownerEmail.toLowerCase())
      .maybeSingle();
    if (suppressed) return false;

    const actionPlanUrl = `${opts.siteUrl}/app`;
    const { html, text, subject } = buildOwnerNotificationHtml({
      employeeName: opts.employeeName,
      taskTitle: opts.taskTitle,
      newStatus: opts.newStatus,
      note: opts.note,
      actionPlanUrl,
      businessName: client.name ?? null,
    });

    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [ownerEmail],
        subject,
        html,
        text,
        headers: { "X-Entity-Ref-ID": `task-update-${opts.actionItemId}-${Date.now()}` },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(`Owner notification Resend error (${res.status}): ${errBody}`);
      return false;
    }

    // Log the send.
    await opts.db.from("action_emails").insert({
      action_item_id: opts.actionItemId,
      client_id: opts.clientId,
      recipient_email: ownerEmail,
      email_type: "owner_update",
      status: "sent",
      sent_at: new Date().toISOString(),
    }).catch(() => {/* non-fatal */});

    return true;
  } catch (err) {
    console.error("sendOwnerNotification failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { "content-type": "application/json", ...CORS },
  });

async function hash(token: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function resolve(token: string) {
  if (!token || token.length < 20) return { error: "not_found" as const };
  const { data } = await db
    .from("action_tokens")
    .select("id, action_item_id, employee_id, expires_at, revoked_at, use_count")
    .eq("token_hash", await hash(token))
    .maybeSingle();
  if (!data) return { error: "not_found" as const };
  if (data.revoked_at) return { error: "revoked" as const };
  if (new Date(data.expires_at) < new Date()) return { error: "expired" as const };
  return { token: data };
}

const VALID_STATUS = ["not_started", "in_progress", "done", "blocked"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const token = new URL(req.url).pathname.split("/").filter(Boolean).pop()!;
  const t = await resolve(token);
  if ("error" in t) return json({ error: t.error }, 404);

  // ---- READ: never mutates. ----
  if (req.method === "GET") {
    const { data: item } = await db
      .from("action_items_v")
      .select(
        "id, plan_id, seq, title, outcome_why, due_date, status, progress_pct, health, owner_name, blocker_note, days_remaining, updated_at",
      )
      .eq("id", t.token.action_item_id)
      .single();
    if (!item) return json({ error: "not_found" }, 404);

    const [{ data: milestones }, { data: plan }, { data: emp }] = await Promise.all([
      db.from("action_milestones")
        .select("id, week_no, label, is_done")
        .eq("action_item_id", t.token.action_item_id)
        .order("week_no"),
      db.from("action_plans")
        .select("outcome_goal, period_label, client_id")
        .eq("id", item.plan_id)
        .single(),
      db.from("client_employees").select("name").eq("id", t.token.employee_id).single(),
    ]);

    let ownerFirstName = "your plan owner";
    if (plan?.client_id) {
      const { data: client } = await db
        .from("clients").select("name").eq("id", plan.client_id).single();
      if (client?.name) ownerFirstName = client.name;
    }

    return json({
      item,
      milestones: milestones ?? [],
      plan: plan ? { outcome_goal: plan.outcome_goal, period_label: plan.period_label } : null,
      assignee_name: emp?.name ?? null,
      business_name: ownerFirstName,
    });
  }

  // ---- WRITE ----
  if (req.method === "POST") {
    // Rate limit: 30 writes per token per hour.
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await db
      .from("action_updates")
      .select("id", { count: "exact", head: true })
      .eq("action_item_id", t.token.action_item_id)
      .eq("actor_type", "assignee_link")
      .gte("created_at", hourAgo);
    if ((count ?? 0) >= 30) return json({ error: "rate_limited" }, 429);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: "bad_request" }, 400);
    }

    const { data: itemRow } = await db
      .from("action_items")
      .select("status, progress_pct, client_id, title")
      .eq("id", t.token.action_item_id)
      .single();
    if (!itemRow) return json({ error: "not_found" }, 404);

    const patch: Record<string, unknown> = {};
    if (typeof body.status === "string") {
      if (!VALID_STATUS.includes(body.status)) return json({ error: "bad_status" }, 400);
      patch.status = body.status;
      if (body.status === "blocked" && !(typeof body.note === "string" && body.note.trim())) {
        return json({ error: "blocker_needs_note" }, 400);
      }
    }
    if (typeof body.progress_pct === "number") {
      patch.progress_pct = Math.max(0, Math.min(100, Math.round(body.progress_pct)));
    }
    if (patch.status === "done") {
      patch.completed_at = new Date().toISOString();
      patch.progress_pct = 100;
    } else if (typeof patch.status === "string") {
      patch.completed_at = null;
    }
    if (typeof body.note === "string") {
      patch.blocker_note = patch.status === "blocked" ? String(body.note).slice(0, 2000) : itemRow.status === "blocked" && patch.status ? null : undefined;
      if (patch.blocker_note === undefined) delete patch.blocker_note;
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await db.from("action_items").update(patch).eq("id", t.token.action_item_id);
      if (error) return json({ error: "update_failed" }, 500);
    }

    if (Array.isArray(body.milestones)) {
      for (const m of body.milestones as Array<{ id?: string; is_done?: boolean }>) {
        if (!m?.id || typeof m.is_done !== "boolean") continue;
        await db
          .from("action_milestones")
          .update({ is_done: m.is_done, done_at: m.is_done ? new Date().toISOString() : null })
          .eq("id", m.id)
          .eq("action_item_id", t.token.action_item_id);
      }
    }

    const { data: emp } = await db
      .from("client_employees").select("name").eq("id", t.token.employee_id).single();

    await db.from("action_updates").insert({
      action_item_id: t.token.action_item_id,
      client_id: itemRow.client_id,
      actor_type: "assignee_link",
      actor_label: emp?.name ?? "Assignee",
      status_from: itemRow.status,
      status_to: (patch.status as string) ?? itemRow.status,
      progress_from: itemRow.progress_pct,
      progress_to: (patch.progress_pct as number) ?? itemRow.progress_pct,
      note: typeof body.note === "string" && body.note.trim() ? String(body.note).slice(0, 2000) : null,
    });

    await db
      .from("action_tokens")
      .update({ last_used_at: new Date().toISOString(), use_count: t.token.use_count + 1 })
      .eq("id", t.token.id);

    // Notify the client owner — fire-and-forget (never blocks the success response).
    const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const siteUrl = Deno.env.get("SITE_URL") ?? "";
    const newStatus = (patch.status as string) ?? itemRow.status;
    const noteText = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
    let ownerNotified = false;
    if (resendApiKey && siteUrl) {
      ownerNotified = await sendOwnerNotification({
        db,
        clientId: itemRow.client_id,
        employeeName: emp?.name ?? "Your assignee",
        taskTitle: itemRow.title ?? "Action plan task",
        newStatus,
        note: noteText,
        actionItemId: t.token.action_item_id,
        siteUrl,
        resendApiKey,
      });
    }

    return json({ ok: true, ownerNotified });
  }

  return json({ error: "method_not_allowed" }, 405);
});
