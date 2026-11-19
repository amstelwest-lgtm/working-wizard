/**
 * OAuth code exchange and refresh for IM cloud providers. Never log tokens.
 */
import type { ImAccessProvider } from "@/lib/im-access-settings";

export type OAuthTokenPair = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

function googleClientCreds(): { id: string; secret: string; redirectUri: string } {
  const id = (process.env.GOOGLE_DRIVE_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim();
  const secret = (process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim();
  const origin = (process.env.PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
  if (!id || !secret || !origin) throw new Error("google_oauth_not_configured");
  return { id, secret, redirectUri: `${origin}/api/google-drive/callback` };
}

function microsoftClientCreds(): { id: string; secret: string; redirectUri: string; tenant: string } {
  const id = (process.env.MICROSOFT_GRAPH_CLIENT_ID ?? "").trim();
  const secret = (process.env.MICROSOFT_GRAPH_CLIENT_SECRET ?? "").trim();
  const tenant = (process.env.MICROSOFT_GRAPH_TENANT_ID ?? "common").trim();
  const origin = (process.env.PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
  if (!id || !secret || !origin) throw new Error("microsoft_oauth_not_configured");
  return { id, secret, redirectUri: `${origin}/api/microsoft-drive/callback`, tenant };
}

export async function exchangeImCloudCode(
  provider: ImAccessProvider,
  code: string,
): Promise<OAuthTokenPair> {
  if (provider === "google") return exchangeGoogleDriveCode(code);
  return exchangeMicrosoftGraphCode(code);
}

async function exchangeGoogleDriveCode(code: string): Promise<OAuthTokenPair> {
  const { id, secret, redirectUri } = googleClientCreds();
  const body = new URLSearchParams({
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`google_token_exchange:${res.status}`);
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const access = json.access_token?.trim() ?? "";
  const refresh = json.refresh_token?.trim() ?? "";
  const expires = typeof json.expires_in === "number" ? json.expires_in : 3600;
  if (!access) throw new Error("google_token_exchange_incomplete");
  return { access_token: access, refresh_token: refresh || access, expires_in: expires };
}

async function exchangeMicrosoftGraphCode(code: string): Promise<OAuthTokenPair> {
  const { id, secret, redirectUri, tenant } = microsoftClientCreds();
  const body = new URLSearchParams({
    code,
    client_id: id,
    client_secret: secret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`microsoft_token_exchange:${res.status}`);
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const access = json.access_token?.trim() ?? "";
  const refresh = json.refresh_token?.trim() ?? "";
  const expires = typeof json.expires_in === "number" ? json.expires_in : 3600;
  if (!access) throw new Error("microsoft_token_exchange_incomplete");
  return { access_token: access, refresh_token: refresh || access, expires_in: expires };
}

export async function refreshImCloudTokens(
  provider: ImAccessProvider,
  refreshToken: string,
): Promise<OAuthTokenPair> {
  if (provider === "google") return refreshGoogleDriveToken(refreshToken);
  return refreshMicrosoftGraphToken(refreshToken);
}

async function refreshGoogleDriveToken(refreshToken: string): Promise<OAuthTokenPair> {
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
  const refresh = json.refresh_token?.trim() || refreshToken;
  const expires = typeof json.expires_in === "number" ? json.expires_in : 3600;
  if (!access) throw new Error("google_token_refresh_incomplete");
  return { access_token: access, refresh_token: refresh, expires_in: expires };
}

async function refreshMicrosoftGraphToken(refreshToken: string): Promise<OAuthTokenPair> {
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
  const refresh = json.refresh_token?.trim() || refreshToken;
  const expires = typeof json.expires_in === "number" ? json.expires_in : 3600;
  if (!access) throw new Error("microsoft_token_refresh_incomplete");
  return { access_token: access, refresh_token: refresh, expires_in: expires };
}

export function imCloudAppOrigin(fallback: string): string {
  const origin = (process.env.PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
  return origin || fallback;
}