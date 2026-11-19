/**
 * Resend inbound → client source documents (review queue). Not Lighthouse CRM.
 * POST /api/resend/client-source-inbound
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";
import { applyClientSourceInbound } from "@/lib/im-inbound-source.server";
import { extractEmail } from "@/lib/lighthouse-delivery.server";

type ResendReceived = {
  type?: string;
  data?: {
    from?: string;
    to?: string[] | string;
    subject?: string;
    email_id?: string;
    attachments?: Array<{ id?: string; filename?: string; content_type?: string; size?: number }>;
  };
};

function verifySvix(
  secret: string,
  payload: string,
  headers: { id: string; timestamp: string; signature: string },
): boolean {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
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

export const Route = createFileRoute("/api/resend/client-source-inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = (process.env.RESEND_CLIENT_INBOUND_WEBHOOK_SECRET ?? process.env.RESEND_WEBHOOK_SECRET ?? "").trim();
        if (!secret) {
          return Response.json({ error: "Webhook not configured" }, { status: 503 });
        }
        const payload = await request.text();
        const ok = verifySvix(secret, payload, {
          id: request.headers.get("svix-id") ?? "",
          timestamp: request.headers.get("svix-timestamp") ?? "",
          signature: request.headers.get("svix-signature") ?? "",
        });
        if (!ok) return Response.json({ error: "Invalid signature" }, { status: 401 });

        let event: ResendReceived;
        try {
          event = JSON.parse(payload) as ResendReceived;
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        if (event.type !== "email.received") {
          return Response.json({ ok: true, ignored: event.type });
        }

        const attachments =
          event.data?.attachments?.map((a) => ({
            filename: a.filename ?? "attachment",
            mimeType: a.content_type ?? "application/octet-stream",
            sizeBytes: typeof a.size === "number" ? a.size : 0,
          })) ?? [];

        const result = await applyClientSourceInbound({
          from: event.data?.from ?? null,
          to: firstRecipient(event.data?.to),
          attachments,
          firstAttachmentBytes: null,
        });

        return Response.json(result);
      },
    },
  },
});