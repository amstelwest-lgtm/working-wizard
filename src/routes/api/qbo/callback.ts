import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { exchangeCodeForTokens, fetchQboCompanyName, intuitTidFromError } from "@/lib/qbo";
import {
  qboDuplicateRealmClientName,
  qboDuplicateRealmReason,
  qboOauthCallbackIssue,
  qboOauthStateIsFresh,
  readQboRealmId,
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
        const realmId = readQboRealmId(url.searchParams);
        const oauthError = url.searchParams.get("error");

        const stateLookup = state
          ? await supabaseAdmin
              .from("qbo_oauth_states")
              .select("client_id, return_path, created_at")
              .eq("state", state)
              .maybeSingle()
          : { data: null, error: null };

        if (stateLookup.error) {
          console.error("[QBO callback] state lookup failed", { code: stateLookup.error.code });
          return redirectTo(appOrigin, "/app", {
            qbo: "error",
            reason: "state_lookup_failed",
          });
        }

        const stateRow = stateLookup.data;
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

        const issue = qboOauthCallbackIssue({
          code,
          state,
          realmId,
          stateFound: Boolean(stateRow && clientId),
        });
        if (issue) {
          // Keep the state when the company id is the only gap so a retry of
          // the same Intuit redirect can still finish. Every other miss is dead.
          if (state && issue !== "missing_realm") {
            await supabaseAdmin.from("qbo_oauth_states").delete().eq("state", state);
          }
          console.error("[QBO callback] rejected", {
            reason: issue,
            hasCode: Boolean(code),
            hasState: Boolean(state),
            hasRealmId: Boolean(realmId),
            stateFound: Boolean(stateRow),
          });
          return redirectTo(appOrigin, returnPath, {
            qbo: "error",
            reason: issue,
          });
        }

        if (!code || !state || !realmId || !stateRow || !clientId) {
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

        const { data: subject, error: subjectErr } = await supabaseAdmin
          .from("clients")
          .select("firm_id")
          .eq("id", clientId)
          .maybeSingle();
        if (subjectErr) {
          console.error("[QBO callback] client lookup failed", { code: subjectErr.code });
          await supabaseAdmin.from("qbo_oauth_states").delete().eq("state", state);
          return redirectTo(appOrigin, returnPath, { qbo: "error", reason: "realm_lookup_failed" });
        }

        const { data: realmRows, error: realmErr } = await supabaseAdmin
          .from("qbo_connections")
          .select("client_id")
          .eq("realm_id", realmId);
        if (realmErr) {
          console.error("[QBO callback] realm lookup failed", { code: realmErr.code });
          await supabaseAdmin.from("qbo_oauth_states").delete().eq("state", state);
          return redirectTo(appOrigin, returnPath, { qbo: "error", reason: "realm_lookup_failed" });
        }

        const otherClientIds = (realmRows ?? [])
          .map((row) => row.client_id)
          .filter((id): id is string => Boolean(id) && id !== clientId);
        if (otherClientIds.length > 0) {
          const { data: others, error: othersErr } = await supabaseAdmin
            .from("clients")
            .select("id, name, firm_id")
            .in("id", otherClientIds);
          if (othersErr) {
            console.error("[QBO callback] realm owner lookup failed", { code: othersErr.code });
            await supabaseAdmin.from("qbo_oauth_states").delete().eq("state", state);
            return redirectTo(appOrigin, returnPath, { qbo: "error", reason: "realm_lookup_failed" });
          }
          const clash = qboDuplicateRealmClientName({
            clientId,
            firmId: subject?.firm_id ?? null,
            owners: (others ?? []).map((row) => ({
              clientId: row.id,
              clientName: row.name ?? "",
              firmId: row.firm_id,
            })),
          });
          if (clash) {
            await supabaseAdmin.from("qbo_oauth_states").delete().eq("state", state);
            return redirectTo(appOrigin, returnPath, {
              qbo: "error",
              reason: qboDuplicateRealmReason(clash),
            });
          }
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
          console.error("[QBO callback] token exchange error:", {
            message,
            intuit_tid: intuitTidFromError(err),
          });
          return redirectTo(appOrigin, returnPath, {
            qbo: "error",
            reason: "token_exchange_failed",
          });
        }
      },
    },
  },
});
