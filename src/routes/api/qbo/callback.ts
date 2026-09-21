import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { exchangeCodeForTokens, fetchQboCompanyName } from "@/lib/qbo";
import {
  qboOauthStateIsFresh,
  sanitizeQboOauthReason,
  sanitizeQboReturnPath,
} from "@/lib/qbo-state";

function redirectTo(appOrigin: string, path: string, params: Record<string, string>) {
  const url = new URL(path, appOrigin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return Response.redirect(url.toString());
}

export const Route = createFileRoute("/api/qbo/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const appOrigin = url.origin;

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const realmId = url.searchParams.get("realmId");
        const oauthError = url.searchParams.get("error");

        const { data: stateRow } = state
          ? await supabaseAdmin
              .from("qbo_oauth_states")
              .select("client_id, return_path, created_at")
              .eq("state", state)
              .maybeSingle()
          : { data: null };

        const clientId = (stateRow as { client_id?: string } | null)?.client_id ?? "";
        const returnPath = clientId
          ? sanitizeQboReturnPath(
              (stateRow as { return_path?: string | null } | null)?.return_path,
              clientId,
            )
          : "/app";

        if (oauthError) {
          if (state) await supabaseAdmin.from("qbo_oauth_states").delete().eq("state", state);
          return redirectTo(appOrigin, returnPath, {
            qbo: "error",
            reason: sanitizeQboOauthReason(oauthError),
          });
        }

        if (!code || !state || !realmId || !stateRow || !clientId) {
          if (state) await supabaseAdmin.from("qbo_oauth_states").delete().eq("state", state);
          return redirectTo(appOrigin, returnPath, {
            qbo: "error",
            reason: "missing_params",
          });
        }

        if (!qboOauthStateIsFresh((stateRow as { created_at: string }).created_at ?? "")) {
          await supabaseAdmin.from("qbo_oauth_states").delete().eq("state", state);
          return redirectTo(appOrigin, returnPath, {
            qbo: "error",
            reason: "invalid_or_expired_state",
          });
        }

        await supabaseAdmin.from("qbo_oauth_states").delete().eq("state", state);

        try {
          const tokens = await exchangeCodeForTokens(code);
          const companyName = await fetchQboCompanyName(realmId, tokens.access_token);

          await supabaseAdmin.from("qbo_connections").upsert(
            {
              client_id: clientId,
              realm_id: realmId,
              company_name: companyName,
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
              connected_at: new Date().toISOString(),
              sync_status: "idle",
              sync_error: null,
            },
            { onConflict: "client_id" },
          );

          return redirectTo(appOrigin, returnPath, { qbo: "connected" });
        } catch (err) {
          const message = err instanceof Error ? err.message : "token_exchange_failed";
          console.error("[QBO callback] token exchange error:", message);
          return redirectTo(appOrigin, returnPath, {
            qbo: "error",
            reason: "token_exchange_failed",
          });
        }
      },
    },
  },
});
