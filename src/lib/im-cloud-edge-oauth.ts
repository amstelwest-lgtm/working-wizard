/**
 * Token exchange for Deno edge (no `@/` imports).
 */
export type OAuthTokenPair = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

function env(name: string): string {
  const deno = typeof Deno !== "undefined" ? Deno.env.get(name) : undefined;
  const node = typeof process !== "undefined" ? process.env[name] : undefined;
  return (deno ?? node ?? "").trim();
}

function googleClientCreds(): { id: string; secret: string } {
  const id = env("GOOGLE_DRIVE_CLIENT_ID") || env("GOOGLE_OAUTH_CLIENT_ID");
  const secret = env("GOOGLE_DRIVE_CLIENT_SECRET") || env("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!id || !secret) throw new Error("google_oauth_not_configured");
  return { id, secret };
}

function microsoftClientCreds(): { id: string; secret: string; tenant: string } {
  const id = env("MICROSOFT_GRAPH_CLIENT_ID");
  const secret = env("MICROSOFT_GRAPH_CLIENT_SECRET");
  const tenant = env("MICROSOFT_GRAPH_TENANT_ID") || "common";
  if (!id || !secret) throw new Error("microsoft_oauth_not_configured");
  return { id, secret, tenant };
}

export async function edgeRefreshImCloudTokens(
  provider: "google" | "microsoft",
  refreshToken: string,
): Promise<OAuthTokenPair> {
  if (provider === "google") return edgeRefreshGoogle(refreshToken);
  return edgeRefreshMicrosoft(refreshToken);
}

async function edgeRefreshGoogle(refreshToken: string): Promise<OAuthTokenPair> {
  const { id, secret } = googleClientCreds();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: id,
    client_secret: secret,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`google_token_refresh:${res.status}`);
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const access = json.access_token?.trim() ?? "";
  if (!access) throw new Error("google_token_refresh_incomplete");
  return {
    access_token: access,
    refresh_token: json.refresh_token?.trim() || refreshToken,
    expires_in: typeof json.expires_in === "number" ? json.expires_in : 3600,
  };
}

async function edgeRefreshMicrosoft(refreshToken: string): Promise<OAuthTokenPair> {
  const { id, secret, tenant } = microsoftClientCreds();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: id,
    client_secret: secret,
    grant_type: "refresh_token",
  });
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`microsoft_token_refresh:${res.status}`);
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const access = json.access_token?.trim() ?? "";
  if (!access) throw new Error("microsoft_token_refresh_incomplete");
  return {
    access_token: access,
    refresh_token: json.refresh_token?.trim() || refreshToken,
    expires_in: typeof json.expires_in === "number" ? json.expires_in : 3600,
  };
}