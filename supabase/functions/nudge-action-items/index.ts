/**
 * MILŌN — Automatic nudge dispatcher.
 *
 * Finds action items that are overdue, at-risk, or off-track, and sends a
 * nudge or overdue email to the assigned owner once per week per item.
 *
 * Triggered by pg_cron (daily). Can also be POSTed to manually for testing.
 *
 * Auth: service role key as Bearer token.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_DOMAIN = "milon.co.za";
const SENDER_DOMAIN = "notify.milon.co.za";
const SITE_NAME = "Working Capital Compass";
// How long to wait before re-nudging the same item (7 days).
const COOLDOWN_DAYS = 7;

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

// ── Token minting (mirrors task-admin) ────────────────────────────────────────
function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function mintToken(
  db: ReturnType<typeof createClient>,
  actionItemId: string,
  employeeId: string,
  dueDate: string | null,
): Promise<string> {
  // Revoke any existing active token for this item+employee pair.
  await db
    .from("action_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("action_item_id", actionItemId)
    .eq("employee_id", employeeId)
    .is("revoked_at", null);

  const raw = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(
    (dueDate ? new Date(dueDate).getTime() : Date.now()) + 60 * 86_400_000,
  ).toISOString();

  const { error } = await db.from("action_tokens").insert({
    action_item_id: actionItemId,
    employee_id: employeeId,
    token_hash: await sha256hex(raw),
    expires_at: expires,
  });
  if (error) throw new Error(`token_insert_failed: ${error.message}`);
  return raw;
}

// ── Email HTML generation ─────────────────────────────────────────────────────
function buildEmailHtml(opts: {
  employeeName: string;
  taskTitle: string;
  outcomeWhy: string | null;
  dueDate: string | null;
  taskUrl: string;
  emailType: "nudge" | "overdue";
  clientName: string | null;
}): { html: string; text: string; subject: string } {
  const { employeeName, taskTitle, outcomeWhy, dueDate, taskUrl, emailType, clientName } = opts;

  const intro =
    emailType === "overdue"
      ? "This one is now past its due date:"
      : "A reminder — this one is due soon:";

  const dueLine = dueDate
    ? `<p style="font-size:13px;color:#b8860b;font-weight:bold;margin:0">Due ${dueDate}</p>`
    : "";

  const whyLine = outcomeWhy
    ? `<p style="font-size:13px;color:#475569;line-height:1.5;margin:10px 0 0"><strong>Why it matters:</strong> ${outcomeWhy}</p>`
    : "";

  const subject = taskTitle
    ? `${taskTitle}${dueDate ? ` — due ${dueDate}` : ""}`
    : "Action plan update";

  const html = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="background:#ffffff;font-family:Arial,sans-serif;margin:0;padding:0">
  <div style="padding:24px 28px;max-width:600px">
    <h1 style="font-size:18px;font-weight:bold;color:#0f172a;margin:0 0 14px">
      ${employeeName ? `Hi ${employeeName},` : "Hello,"}
    </h1>
    <p style="font-size:14px;color:#334155;line-height:1.5;margin:0 0 14px">${intro}</p>

    <div style="border:1px solid #e7dcc3;border-left:3px solid #b8860b;border-radius:8px;padding:16px 18px;margin:8px 0 4px;background:#fdfaf3">
      <p style="font-size:15px;font-weight:bold;letter-spacing:0.04em;color:#0f172a;margin:0 0 6px">
        ${taskTitle.toUpperCase()}
      </p>
      ${dueLine}
      ${whyLine}
    </div>

    <div style="margin:20px 0">
      <a href="${taskUrl}?intent=in_progress" style="background:#b8860b;color:#ffffff;font-size:13px;font-weight:bold;padding:10px 16px;border-radius:6px;text-decoration:none;margin-right:8px;display:inline-block">I'm on it</a>
      <a href="${taskUrl}?intent=done" style="background:#f1f5f9;color:#0f172a;font-size:13px;font-weight:bold;padding:10px 16px;border-radius:6px;text-decoration:none;margin-right:8px;display:inline-block">Mark as done</a>
      <a href="${taskUrl}?intent=blocked" style="background:#f1f5f9;color:#0f172a;font-size:13px;font-weight:bold;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">I'm blocked</a>
    </div>

    <p style="font-size:12px;color:#94a3b8;margin:4px 0 0">No login needed — the buttons open your task page.</p>
    <p style="font-size:12px;color:#94a3b8;margin:20px 0 0">— MILŌN${clientName ? ` · ${clientName}` : ""}</p>
  </div>
</body>
</html>`;

  const text = [
    employeeName ? `Hi ${employeeName},` : "Hello,",
    "",
    intro,
    "",
    taskTitle.toUpperCase(),
    dueDate ? `Due ${dueDate}` : "",
    outcomeWhy ? `Why it matters: ${outcomeWhy}` : "",
    "",
    `I'm on it: ${taskUrl}?intent=in_progress`,
    `Mark as done: ${taskUrl}?intent=done`,
    `I'm blocked: ${taskUrl}?intent=blocked`,
    "",
    "No login needed — the links open your task page.",
    `— MILŌN${clientName ? ` · ${clientName}` : ""}`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  return { html, text, subject };
}

// ── Resend send ───────────────────────────────────────────────────────────────
async function sendViaResend(opts: {
  apiKey: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}): Promise<void> {
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      headers: { "X-Entity-Ref-ID": opts.idempotencyKey },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend error (${res.status}): ${body}`);
  }
}

// ── Role claim check ──────────────────────────────────────────────────────────
// The Supabase gateway (verify_jwt: true) has already verified the JWT
// signature before reaching this function. It is therefore safe to decode
// the payload and assert the role claim as an authorization check.
function bearerRole(authHeader: string): string | null {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const pad = (s: string) => s + "=".repeat((4 - s.length % 4) % 4);
    const payload = JSON.parse(atob(pad(parts[1].replace(/-/g, "+").replace(/_/g, "/"))));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
// Auth: Supabase gateway enforces valid JWT (verify_jwt: true), then we
// assert the role claim is "service_role" so regular users cannot trigger
// this function even with a valid signed-in JWT.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // After gateway JWT verification, assert service_role claim.
  const role = bearerRole(req.headers.get("authorization") ?? "");
  if (role !== "service_role") {
    return json({ error: "forbidden" }, 403);
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const siteUrl = Deno.env.get("SITE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!resendApiKey) return json({ error: "RESEND_API_KEY not configured" }, 500);
  if (!siteUrl) return json({ error: "SITE_URL not configured" }, 500);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceRoleKey,
  );

  const cutoff = new Date(
    Date.now() - COOLDOWN_DAYS * 86_400_000,
  ).toISOString();

  // Find items that need a nudge:
  // - assigned (sent_at IS NOT NULL), not done, owner has email
  // - health is overdue / at_risk / off_track
  // - no nudge or overdue email sent in the last 7 days
  const { data: candidates, error: queryErr } = await db.rpc(
    "find_nudge_candidates",
    { p_cooldown_cutoff: cutoff },
  );

  if (queryErr) {
    console.error("find_nudge_candidates failed", queryErr);
    return json({ error: queryErr.message }, 500);
  }

  const items = candidates as Array<{
    id: string;
    title: string;
    outcome_why: string | null;
    due_date: string | null;
    plan_id: string;
    client_id: string;
    client_name: string | null;
    employee_id: string;
    owner_name: string;
    owner_email: string;
    period_label: string;
    health: string;
  }>;

  console.log(`Found ${items.length} item(s) eligible for nudge`);

  const results: Array<{ id: string; status: string; error?: string }> = [];

  for (const item of items) {
    try {
      // Suppression check before sending.
      const { data: suppressed } = await db
        .from("suppressed_emails")
        .select("id")
        .eq("email", item.owner_email.toLowerCase())
        .maybeSingle();

      if (suppressed) {
        console.log(`Suppressed — skipping nudge for ${item.id}`);
        results.push({ id: item.id, status: "suppressed" });
        continue;
      }

      // Mint a new token for this item.
      const rawToken = await mintToken(
        db,
        item.id,
        item.employee_id,
        item.due_date,
      );
      const taskUrl = `${siteUrl}/t/${rawToken}`;

      const emailType: "nudge" | "overdue" =
        item.health === "overdue" ? "overdue" : "nudge";

      const dueDateFormatted = item.due_date
        ? new Date(item.due_date + "T00:00:00").toLocaleDateString("en-ZA", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
        : null;

      const { html, text, subject } = buildEmailHtml({
        employeeName: item.owner_name.split(" ")[0],
        taskTitle: item.title,
        outcomeWhy: item.outcome_why,
        dueDate: dueDateFormatted,
        taskUrl,
        emailType,
        clientName: item.client_name,
      });

      const idempotencyKey = `action-nudge-${item.id}-${emailType}-${Date.now()}`;

      await sendViaResend({
        apiKey: resendApiKey,
        to: item.owner_email,
        subject,
        html,
        text,
        idempotencyKey,
      });

      // Log the send.
      await db.from("action_emails").insert({
        action_item_id: item.id,
        client_id: item.client_id,
        recipient_email: item.owner_email,
        email_type: emailType,
        status: "sent",
        sent_at: new Date().toISOString(),
      });

      console.log(`Nudge sent: ${item.id} (${emailType}) → ${item.owner_email}`);
      results.push({ id: item.id, status: "sent" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to nudge ${item.id}:`, msg);

      // Log the failure so we don't retry immediately.
      await db.from("action_emails").insert({
        action_item_id: item.id,
        client_id: item.client_id,
        recipient_email: item.owner_email ?? "",
        email_type: item.health === "overdue" ? "overdue" : "nudge",
        status: "failed",
        sent_at: new Date().toISOString(),
      }).catch(() => {/* don't throw on log failure */});

      results.push({ id: item.id, status: "failed", error: msg });
    }
  }

  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return json({ sent, failed, total: items.length, results });
});
