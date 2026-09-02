/**
 * Monday digest for the founder instrument.
 * GET without a secret writes nothing and returns no founder numbers
 * (email-scanner + privacy). GET/POST with CRON_SECRET or MILON_DIGEST_SECRET sends.
 */
import { createFileRoute } from "@tanstack/react-router";
import { deliverDigest } from "@/lib/metrics.functions";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

function digestSecret(): string {
  return (process.env.CRON_SECRET || process.env.MILON_DIGEST_SECRET || "").trim();
}

function hasValidSecret(request: Request): boolean {
  const expected = digestSecret();
  if (!expected) return false;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const header = (request.headers.get("x-digest-secret") || "").trim();
  return bearer === expected || header === expected;
}

async function sendNow() {
  try {
    const result = await deliverDigest("cron");
    return json({
      ok: result.sent.ok,
      subject: result.subject,
      recipients: result.recipients,
      sent: result.sent,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "send_failed" }, 500);
  }
}

export const DIGEST_GET_WITHOUT_SECRET_WRITES_NOTHING = true;

export const Route = createFileRoute("/api/metrics-digest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!hasValidSecret(request)) {
          return json({ wrote: false, error: "method_preview_forbidden" }, 200);
        }
        return sendNow();
      },
      POST: async ({ request }) => {
        if (!hasValidSecret(request)) {
          return json({ error: "unauthorized", wrote: false }, 401);
        }
        return sendNow();
      },
    },
  },
});
