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

type QueryError = { code?: string; message?: string } | null;
type QueryResult<T> = { data: T; error: QueryError };

/** Chain the callback actually uses. Tests pass a fake; production passes supabaseAdmin. */
export type QboCallbackAdmin = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): unknown;
        in(column: string, values: string[]): Promise<QueryResult<Array<Record<string, unknown>> | null>>;
        maybeSingle(): Promise<QueryResult<Record<string, unknown> | null>>;
        then<TResult1 = QueryResult<Array<Record<string, unknown>> | null>, TResult2 = never>(
          onfulfilled?:
            | ((value: QueryResult<Array<Record<string, unknown>> | null>) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ): Promise<TResult1 | TResult2>;
      };
      in(column: string, values: string[]): Promise<QueryResult<Array<Record<string, unknown>> | null>>;
    };
    delete(): {
      eq(column: string, value: string): Promise<QueryResult<null>>;
    };
    upsert(
      row: Record<string, unknown>,
      options: { onConflict: string },
    ): Promise<QueryResult<unknown>>;
  };
};

export async function handleQboCallbackGet(
  request: Request,
  deps: {
    admin: QboCallbackAdmin;
    exchangeCodeForTokens: (
      code: string,
    ) => Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
    fetchQboCompanyName: (realmId: string, accessToken: string) => Promise<string | null>;
  },
): Promise<Response> {
  const { admin } = deps;
  const url = new URL(request.url);
  const appOrigin = url.origin;

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const realmId = readQboRealmId(url.searchParams);
  const oauthError = url.searchParams.get("error");

  const stateLookup = state
    ? await admin
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
    if (state) await admin.from("qbo_oauth_states").delete().eq("state", state);
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
      await admin.from("qbo_oauth_states").delete().eq("state", state);
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
    await admin.from("qbo_oauth_states").delete().eq("state", state);
    return redirectTo(appOrigin, returnPath, {
      qbo: "error",
      reason: "invalid_or_expired_state",
    });
  }

  const { data: subject, error: subjectErr } = await admin
    .from("clients")
    .select("firm_id")
    .eq("id", clientId)
    .maybeSingle();
  if (subjectErr) {
    console.error("[QBO callback] client lookup failed", { code: subjectErr.code });
    await admin.from("qbo_oauth_states").delete().eq("state", state);
    return redirectTo(appOrigin, returnPath, { qbo: "error", reason: "realm_lookup_failed" });
  }

  const { data: realmRows, error: realmErr } = await admin
    .from("qbo_connections")
    .select("client_id")
    .eq("realm_id", realmId);
  if (realmErr) {
    console.error("[QBO callback] realm lookup failed", { code: realmErr.code });
    await admin.from("qbo_oauth_states").delete().eq("state", state);
    return redirectTo(appOrigin, returnPath, { qbo: "error", reason: "realm_lookup_failed" });
  }

  const otherClientIds = (realmRows ?? [])
    .map((row) => String(row.client_id ?? ""))
    .filter((id) => Boolean(id) && id !== clientId);
  if (otherClientIds.length > 0) {
    const { data: others, error: othersErr } = await admin
      .from("clients")
      .select("id, name, firm_id")
      .in("id", otherClientIds);
    if (othersErr) {
      console.error("[QBO callback] realm owner lookup failed", { code: othersErr.code });
      await admin.from("qbo_oauth_states").delete().eq("state", state);
      return redirectTo(appOrigin, returnPath, { qbo: "error", reason: "realm_lookup_failed" });
    }
    const clash = qboDuplicateRealmClientName({
      clientId,
      firmId: typeof subject?.firm_id === "string" ? subject.firm_id : null,
      owners: (others ?? []).map((row) => ({
        clientId: String(row.id ?? ""),
        clientName: typeof row.name === "string" ? row.name : "",
        firmId: typeof row.firm_id === "string" ? row.firm_id : null,
      })),
    });
    if (clash) {
      await admin.from("qbo_oauth_states").delete().eq("state", state);
      return redirectTo(appOrigin, returnPath, {
        qbo: "error",
        reason: qboDuplicateRealmReason(clash),
      });
    }
  }

  await admin.from("qbo_oauth_states").delete().eq("state", state);

  try {
    const tokens = await deps.exchangeCodeForTokens(code);
    const companyName = await deps.fetchQboCompanyName(realmId, tokens.access_token);

    await admin.from("qbo_connections").upsert(
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
}

export const Route = createFileRoute("/api/qbo/callback")({
  server: {
    handlers: {
      GET: ({ request }) =>
        handleQboCallbackGet(request, {
          admin: supabaseAdmin as unknown as QboCallbackAdmin,
          exchangeCodeForTokens,
          fetchQboCompanyName,
        }),
    },
  },
});
