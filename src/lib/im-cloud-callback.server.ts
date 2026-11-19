/**
 * Google Drive / OneDrive OAuth callback handler (GET).
 */
import type { ImAccessProvider } from "@/lib/im-access-settings";
import {
  imCloudCallbackQueryKey,
  imCloudOauthCallbackIssue,
  imCloudOauthStateIsFresh,
  sanitizeImCloudReturnPath,
} from "@/lib/im-cloud-oauth-state";
import { persistImCloudTokensFromCode } from "@/lib/im-cloud-connection.server";
import { imCloudOauthSqlReady } from "@/lib/im-cloud-token";

function redirectTo(appOrigin: string, path: string, params: Record<string, string>) {
  const url = new URL(path, appOrigin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return Response.redirect(url.toString());
}

type QueryError = { code?: string; message?: string } | null;
type QueryResult<T> = { data: T; error: QueryError };

export type ImCloudCallbackAdmin = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<QueryResult<Record<string, unknown> | null>>;
      };
    };
    delete(): {
      eq(column: string, value: string): Promise<QueryResult<null>>;
    };
  };
};

export async function handleImCloudCallbackGet(
  request: Request,
  expectedProvider: ImAccessProvider,
  deps: {
    admin: ImCloudCallbackAdmin;
    persistTokens: typeof persistImCloudTokensFromCode;
  },
): Promise<Response> {
  const url = new URL(request.url);
  const appOrigin = url.origin;
  const queryKey = imCloudCallbackQueryKey(expectedProvider);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const sqlReady = imCloudOauthSqlReady();

  const stateLookup = state
    ? await deps.admin
        .from("im_cloud_oauth_states")
        .select("client_id, return_path, created_at, provider")
        .eq("state", state)
        .maybeSingle()
    : { data: null, error: null };

  if (stateLookup.error) {
    console.error("[IM cloud callback] state lookup failed", { code: stateLookup.error.code });
    return redirectTo(appOrigin, "/app", {
      [queryKey]: "error",
      reason: "state_lookup_failed",
    });
  }

  const stateRow = stateLookup.data;
  const clientId = (stateRow as { client_id?: string } | null)?.client_id ?? "";
  const returnPath = clientId
    ? sanitizeImCloudReturnPath(
        (stateRow as { return_path?: string | null } | null)?.return_path,
        clientId,
      )
    : "/app";

  const stateProvider = (stateRow as { provider?: string } | null)?.provider ?? "";
  const providerMatches = stateProvider === expectedProvider;

  if (oauthError) {
    if (state) await deps.admin.from("im_cloud_oauth_states").delete().eq("state", state);
    return redirectTo(appOrigin, returnPath, {
      [queryKey]: "error",
      reason: oauthError.slice(0, 40) || "denied",
    });
  }

  const stateFresh =
    Boolean(stateRow) &&
    providerMatches &&
    imCloudOauthStateIsFresh((stateRow as { created_at: string }).created_at ?? "");

  const issue = imCloudOauthCallbackIssue({
    code,
    state,
    stateFound: Boolean(stateRow && clientId && providerMatches),
    stateFresh,
    sqlReady,
  });

  if (issue) {
    if (state && issue !== "oauth_disabled") {
      await deps.admin.from("im_cloud_oauth_states").delete().eq("state", state);
    }
    console.error("[IM cloud callback] rejected", {
      provider: expectedProvider,
      reason: issue,
      hasCode: Boolean(code),
      hasState: Boolean(state),
    });
    return redirectTo(appOrigin, returnPath, {
      [queryKey]: "error",
      reason: issue,
    });
  }

  if (!code || !state || !stateRow || !clientId) {
    return redirectTo(appOrigin, returnPath, {
      [queryKey]: "error",
      reason: "missing_params",
    });
  }

  await deps.admin.from("im_cloud_oauth_states").delete().eq("state", state);

  try {
    await deps.persistTokens({
      clientId,
      provider: expectedProvider,
      code,
    });
    return redirectTo(appOrigin, returnPath, {
      [queryKey]: "connected",
    });
  } catch (err) {
    console.error("[IM cloud callback] token exchange failed", {
      provider: expectedProvider,
      code: err instanceof Error ? err.message.slice(0, 80) : "unknown",
    });
    return redirectTo(appOrigin, returnPath, {
      [queryKey]: "error",
      reason: "token_exchange_failed",
    });
  }
}