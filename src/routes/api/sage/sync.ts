/**
 * POST /api/sage/sync — Sage Accounting (SA) populate.
 * Bearer token, same as the app. Body: { clientId }.
 * No OAuth callback lives here.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { executeSageSync } from "@/lib/sage-sync.server";

const bodySchema = z.object({ clientId: z.string().uuid() });

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function authorize(request: Request, clientId: string): Promise<{ userId: string }> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw json({ ok: false, error: "Unauthorized" }, 401);
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) throw json({ ok: false, error: "Unauthorized" }, 401);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw json({ ok: false, error: "Supabase is not configured" }, 500);

  const supabase = createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error } = await supabase.auth.getClaims(token);
  if (error || !authData?.claims?.sub) throw json({ ok: false, error: "Unauthorized" }, 401);

  const acting = request.headers.get("x-acting-as-client-id");
  if (acting && acting !== clientId) {
    throw json({ ok: false, error: "Forbidden" }, 403);
  }
  if (acting) {
    const { data: auditRows } = await supabase
      .from("impersonation_audit")
      .select("id")
      .eq("firm_user_id", authData.claims.sub)
      .eq("client_id", acting)
      .is("ended_at", null)
      .limit(1);
    if (!auditRows?.length) throw json({ ok: false, error: "Forbidden" }, 403);
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) throw json({ ok: false, error: "Client not found" }, 404);
  return { userId: authData.claims.sub };
}

export const Route = createFileRoute("/api/sage/sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let clientId = "";
        try {
          const parsed = bodySchema.safeParse(await request.json().catch(() => null));
          if (!parsed.success) return json({ ok: false, error: "clientId is required" }, 400);
          clientId = parsed.data.clientId;
          const { userId } = await authorize(request, clientId);
          const result = await executeSageSync({ clientId, userId });
          if (!result.populated) return json({ ok: false, error: result.message, ...result }, 409);
          return json({ ok: true, ...result }, 200);
        } catch (err) {
          if (err instanceof Response) return err;
          const message = err instanceof Error ? err.message : "Sync failed";
          const status = /not connected|Client not found/i.test(message)
            ? 404
            : /SAGE_SA_API_KEY is not set/i.test(message)
              ? 503
              : /left unchanged|rejected the login/i.test(message)
                ? 409
                : 502;
          return json({ ok: false, error: message }, status);
        }
      },
    },
  },
});
