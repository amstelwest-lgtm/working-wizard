/**
 * Resend → Milōn Lighthouse delivery webhooks.
 *
 * Endpoint: POST /api/resend/webhook
 *
 * Safety:    email.bounced, email.complained, email.failed
 * Signal:    email.delivered, email.clicked, email.received
 *
 * Setup in Resend → Webhooks:
 *   URL: https://www.milon.co.za/api/resend/webhook
 *   Events: those six
 * Then put the signing secret in Vercel as RESEND_WEBHOOK_SECRET.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  applyLighthouseClicked,
  applyLighthouseDelivered,
  applyLighthouseDeliveryEvent,
  applyLighthouseInbound,
  extractEmail,
} from "@/lib/lighthouse-delivery.server";

type ResendEvent = {
  type?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    from?: string;
    subject?: string;
    bounce?: { message?: string };
    click?: { link?: string; timestamp?: string };
  };
};

function verifySvix(
  secret: string,
  payload: string,
  headers: { id: string; timestamp: string; signature: string },
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;

  // Reject stale timestamps (±5 minutes).
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${headers.id}.${headers.timestamp}.${payload}`;
  const expected = createHmac("sha256", key).update(signedContent).digest("base64");

  const candidates = headers.signature.split(" ").map((part) => {
    const [, sig] = part.split(",");
    return sig ?? "";
  });

  const expectedBuf = Buffer.from(expected);
  return candidates.some((sig) => {
    try {
      const got = Buffer.from(sig);
      return got.length === expectedBuf.length && timingSafeEqual(got, expectedBuf);
    } catch {
      return false;
    }
  });
}

function firstRecipient(to: string[] | string | undefined): string | null {
  if (!to) return null;
  if (typeof to === "string") return extractEmail(to);
  return extractEmail(to[0]);
}

export const Route = createFileRoute("/api/resend/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = (process.env.RESEND_WEBHOOK_SECRET ?? "").trim();
        if (!secret) {
          console.error("RESEND_WEBHOOK_SECRET is not configured");
          return Response.json({ error: "Webhook not configured" }, { status: 503 });
        }

        const payload = await request.text();
        const ok = verifySvix(secret, payload, {
          id: request.headers.get("svix-id") ?? "",
          timestamp: request.headers.get("svix-timestamp") ?? "",
          signature: request.headers.get("svix-signature") ?? "",
        });
        if (!ok) {
          return Response.json({ error: "Invalid signature" }, { status: 401 });
        }

        let event: ResendEvent;
        try {
          event = JSON.parse(payload) as ResendEvent;
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const type = String(event.type ?? "");
        const email = firstRecipient(event.data?.to);
        const messageId = event.data?.email_id ?? null;

        if (type === "email.delivered") {
          const result = await applyLighthouseDelivered({ email, messageId });
          return Response.json({ ok: result.ok, leadsTouched: result.leadsTouched, reason: "delivered" });
        }

        if (type === "email.clicked") {
          const result = await applyLighthouseClicked({
            email,
            messageId,
            url: event.data?.click?.link ?? null,
          });
          return Response.json({
            ok: result.ok,
            leadsTouched: result.leadsTouched,
            reason: "clicked",
            kind: result.kind,
          });
        }

        if (type === "email.received") {
          const result = await applyLighthouseInbound({
            from: event.data?.from ?? null,
            to: firstRecipient(event.data?.to),
            subject: event.data?.subject ?? null,
            emailId: messageId,
          });
          return Response.json({ ok: result.ok, leadsTouched: result.leadsTouched, reason: "received" });
        }

        const reason =
          type === "email.bounced"
            ? ("bounce" as const)
            : type === "email.complained"
              ? ("complaint" as const)
              : type === "email.failed"
                ? ("failed" as const)
                : null;

        if (!reason) {
          return Response.json({ ok: true, ignored: type });
        }

        const result = await applyLighthouseDeliveryEvent({
          email,
          messageId,
          reason,
        });

        return Response.json({
          ok: result.ok,
          leadsTouched: result.leadsTouched,
          reason,
        });
      },
    },
  },
});
