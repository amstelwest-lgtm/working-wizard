import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  exchangeXeroCodeForTokens,
  fetchXeroConnections,
  pickXeroTenant,
} from "@/lib/xero";
import { sanitizeXeroReturnPath, xeroOauthStateIsFresh } from "@/lib/xero-state";

function redirectTo(appOrigin: string, path: string, params: Record<string, string>) {
  const url = new URL(path, appOrigin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return Response.redirect(url.toString());
}

export const Route = createFileRoute("/api/xero/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const appOrigin = url.origin;

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const oauthError = url.searchParams.get("error");

        if (oauthError) {
          return redirectTo(appOrigin, "/app", {
            xero: "error",
            reason: oauthError,
          });
        }

        if (!code || !state) {
          return redirectTo(appOrigin, "/app", {
            xero: "error",
            reason: "missing_params",
          });
        }

        const { data: stateRow } = await supabaseAdmin
          .from("xero_oauth_states")
          .select("client_id, return_path, created_at")
          .eq("state", state)
          .maybeSingle();

        if (
          !stateRow ||
          !xeroOauthStateIsFresh((stateRow as { created_at: string }).created_at)
        ) {
          return redirectTo(appOrigin, "/app", {
            xero: "error",
            reason: "invalid_or_expired_state",
          });
        }

        const clientId = (stateRow as { client_id: string }).client_id;
        const returnPath = sanitizeXeroReturnPath(
          (stateRow as { return_path?: string | null }).return_path,
          clientId,
        );

        await supabaseAdmin.from("xero_oauth_states").delete().eq("state", state);

        try {
          const tokens = await exchangeXeroCodeForTokens(code);
          const connections = await fetchXeroConnections(tokens.access_token);
          const tenant = pickXeroTenant(connections);
          if (!tenant) {
            return redirectTo(appOrigin, returnPath, {
              xero: "error",
              reason: "no_organisation",
            });
          }

          await supabaseAdmin.from("xero_connections").upsert(
            {
              client_id: clientId,
              tenant_id: tenant.tenantId,
              connection_id: tenant.id || null,
              tenant_name: tenant.tenantName || null,
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
              connected_at: new Date().toISOString(),
              sync_status: "idle",
              sync_error: null,
              data_depth: "statement",
            },
            { onConflict: "client_id" },
          );

          return redirectTo(appOrigin, returnPath, { xero: "connected" });
        } catch (err) {
          const message = err instanceof Error ? err.message : "token_exchange_failed";
          // Do not include token material — xero.ts already redacts fetch bodies.
          console.error("[Xero callback] token exchange error:", message);
          return redirectTo(appOrigin, returnPath, {
            xero: "error",
            reason: "token_exchange_failed",
          });
        }
      },
    },
  },
});
