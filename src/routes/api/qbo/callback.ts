import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { exchangeCodeForTokens } from "@/lib/qbo";

export const Route = createFileRoute("/api/qbo/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const appOrigin = url.origin; // redirect back to same domain

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const realmId = url.searchParams.get("realmId");
        const oauthError = url.searchParams.get("error");

        // User denied access
        if (oauthError) {
          return Response.redirect(
            `${appOrigin}/app?qbo=error&reason=${encodeURIComponent(oauthError)}`,
          );
        }

        if (!code || !state || !realmId) {
          return Response.redirect(
            `${appOrigin}/app?qbo=error&reason=missing_params`,
          );
        }

        // Validate state (CSRF) — must exist and be < 10 minutes old
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { data: stateRow } = await supabaseAdmin
          .from("qbo_oauth_states")
          .select("client_id, created_at")
          .eq("state", state)
          .gte("created_at", tenMinutesAgo)
          .maybeSingle();

        if (!stateRow) {
          return Response.redirect(
            `${appOrigin}/app?qbo=error&reason=invalid_or_expired_state`,
          );
        }

        const { client_id: clientId } = stateRow as { client_id: string; created_at: string };

        // Consume state immediately to prevent replay
        await supabaseAdmin
          .from("qbo_oauth_states")
          .delete()
          .eq("state", state);

        try {
          const tokens = await exchangeCodeForTokens(code);

          // Try to get the company name from QBO company info endpoint
          let companyName: string | null = null;
          try {
            const base =
              process.env.QBO_ENVIRONMENT === "production"
                ? "https://quickbooks.api.intuit.com"
                : "https://sandbox-quickbooks.api.intuit.com";
            const infoRes = await fetch(
              `${base}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=70`,
              {
                headers: {
                  Authorization: `Bearer ${tokens.access_token}`,
                  Accept: "application/json",
                },
              },
            );
            if (infoRes.ok) {
              const info = (await infoRes.json()) as {
                CompanyInfo?: { CompanyName?: string };
              };
              companyName = info.CompanyInfo?.CompanyName ?? null;
            }
          } catch {
            // non-fatal — fall back to null
          }

          // Upsert connection (one QBO company per Milōn client)
          await supabaseAdmin.from("qbo_connections").upsert(
            {
              client_id: clientId,
              realm_id: realmId,
              company_name: companyName,
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              token_expiry: new Date(
                Date.now() + tokens.expires_in * 1000,
              ).toISOString(),
              connected_at: new Date().toISOString(),
              sync_status: "idle",
              sync_error: null,
            },
            { onConflict: "client_id" },
          );

          return Response.redirect(`${appOrigin}/app?qbo=connected`);
        } catch (err) {
          console.error("[QBO callback] token exchange error:", err);
          return Response.redirect(
            `${appOrigin}/app?qbo=error&reason=token_exchange_failed`,
          );
        }
      },
    },
  },
});
