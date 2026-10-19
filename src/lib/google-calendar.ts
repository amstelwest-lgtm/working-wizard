/**
 * Google Calendar for the public sample call.
 * Booking uses a refresh token. The one-time consent script exchanges an
 * authorization code for that token. Neither path sends mail.
 */

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_REDIRECT_URI = "http://127.0.0.1:8787";
export const HELLO_CALENDAR_ATTENDEE = "hello@milonfinance.com";

export type GoogleCalendarConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId: string;
};

export function readGoogleCalendarConfig(
  env: Record<string, string | undefined>,
): GoogleCalendarConfig | null {
  const clientId = env.GOOGLE_CALENDAR_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() ?? "";
  const refreshToken = env.GOOGLE_CALENDAR_REFRESH_TOKEN?.trim() ?? "";
  const calendarId = env.GOOGLE_CALENDAR_ID?.trim() ?? "";
  if (!clientId || !clientSecret || !refreshToken || !calendarId) return null;
  return { clientId, clientSecret, refreshToken, calendarId };
}

export function googleConsentUrl(input: { clientId: string; redirectUri: string }): string {
  const query = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
}

export async function exchangeGoogleAuthCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetchImpl: typeof fetch;
}): Promise<{ refreshToken: string | null; accessToken: string | null }> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await input.fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return { refreshToken: null, accessToken: null };
  const json = (await res.json()) as { refresh_token?: string; access_token?: string };
  return {
    refreshToken: json.refresh_token?.trim() || null,
    accessToken: json.access_token?.trim() || null,
  };
}

async function refreshAccessToken(
  config: GoogleCalendarConfig,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string };
  const token = json.access_token?.trim() ?? "";
  return token || null;
}

export type MeetBooking = {
  summary: string;
  description: string;
  start: Date;
  end: Date;
  attendeeEmail: string;
  requestId: string;
};

function meetUrlOf(json: {
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}): string | null {
  const hangout = json.hangoutLink?.trim();
  if (hangout) return hangout;
  const video = json.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video" && entry.uri,
  );
  return video?.uri?.trim() || null;
}

/**
 * Creates the event on the configured calendar and asks for a Meet link.
 * Returns ok: false when the token, the insert, or the Meet link is missing.
 */
export async function bookGoogleMeet(input: {
  config: GoogleCalendarConfig;
  booking: MeetBooking;
  fetchImpl: typeof fetch;
}): Promise<{ ok: true; eventId: string; meetUrl: string } | { ok: false }> {
  try {
    const accessToken = await refreshAccessToken(input.config, input.fetchImpl);
    if (!accessToken) return { ok: false };
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.config.calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`;
    const res = await input.fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        summary: input.booking.summary,
        description: input.booking.description,
        start: { dateTime: input.booking.start.toISOString() },
        end: { dateTime: input.booking.end.toISOString() },
        attendees: [{ email: input.booking.attendeeEmail }, { email: HELLO_CALENDAR_ATTENDEE }],
        conferenceData: {
          createRequest: {
            requestId: input.booking.requestId,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as {
      id?: string;
      hangoutLink?: string;
      conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
    };
    const eventId = json.id?.trim() ?? "";
    const meetUrl = meetUrlOf(json);
    if (!eventId || !meetUrl) return { ok: false };
    return { ok: true, eventId, meetUrl };
  } catch {
    return { ok: false };
  }
}
