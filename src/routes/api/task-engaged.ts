/**
 * POST /api/task-engaged — human (or JS-running) beacon for /t/:token.
 * GET writes nothing. Does not touch action_tokens.last_used_at.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdminOrNull } from "@/integrations/supabase/client.server";
import {
  ENGAGEMENT_BOT_LATENCY_MS,
  userAgentLooksLikeBot,
} from "@/lib/analytics-events";
import { emitAnalyticsEvent, sha256Hex } from "@/lib/analytics-spine.server";

type Body = {
  token?: string;
  event?: string;
  reason?: string;
  ms_on_page?: number;
  visible?: boolean;
};

const json = (body: unknown, status = 204) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });

async function parseBody(request: Request): Promise<Body> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Body;
  } catch {
    return {};
  }
}

export const Route = createFileRoute("/api/task-engaged")({
  server: {
    handlers: {
      GET: async () => json({ error: "method_not_allowed" }, 405),
      POST: async ({ request }) => {
        try {
          const body = await parseBody(request);
          const token = typeof body.token === "string" ? body.token.trim() : "";
          const eventKey =
            body.event === "task.link.rendered" ? "task.link.rendered" : "task.link.engaged";
          if (!token || token.length < 20) return json(null, 204);

          const admin = getSupabaseAdminOrNull() as {
            from: (t: string) => {
              select: (cols: string) => {
                eq: (
                  c: string,
                  v: string,
                ) => {
                  maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
                  order?: (c: string, o: { ascending: boolean }) => {
                    limit: (n: number) => {
                      maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
                    };
                  };
                };
              };
            };
          } | null;
          if (!admin) return json(null, 204);

          const tokenHash = await sha256Hex(token);
          const { data: tok } = await admin
            .from("action_tokens")
            .select("id, action_item_id, employee_id, expires_at, revoked_at")
            .eq("token_hash", tokenHash)
            .maybeSingle();
          if (!tok || tok.revoked_at) return json(null, 204);
          if (tok.expires_at && new Date(String(tok.expires_at)) < new Date()) return json(null, 204);

          const itemId = String(tok.action_item_id);
          const { data: item } = await admin
            .from("action_items")
            .select("id, client_id")
            .eq("id", itemId)
            .maybeSingle();
          if (!item) return json(null, 204);

          const ua = request.headers.get("user-agent");
          let isBot = userAgentLooksLikeBot(ua);
          if (eventKey === "task.link.engaged" && !isBot) {
            const { data: lastMail } = await (admin.from("action_emails") as any)
              .select("sent_at")
              .eq("action_item_id", itemId)
              .order("sent_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            const sentAt = lastMail?.sent_at ? Date.parse(String(lastMail.sent_at)) : NaN;
            if (Number.isFinite(sentAt) && Date.now() - sentAt < ENGAGEMENT_BOT_LATENCY_MS) {
              isBot = true;
            }
          }

          const actorHash = await sha256Hex(`milon-analytics:${token}`);
          await emitAnalyticsEvent({
            eventKey,
            actorKind: "sme_employee",
            actorHash,
            entityId: String(item.client_id),
            objectId: itemId,
            objectType: "task",
            source: "client",
            isBot,
            idempotencyKey: `${eventKey}:${String(tok.id)}`,
            properties: {
              reason: typeof body.reason === "string" ? body.reason.slice(0, 40) : undefined,
              ms_on_page:
                typeof body.ms_on_page === "number" && Number.isFinite(body.ms_on_page)
                  ? Math.round(body.ms_on_page)
                  : undefined,
              visible: body.visible === true,
            },
          });
        } catch {
          /* analytics must never break the task page */
        }
        return json(null, 204);
      },
    },
  },
});
