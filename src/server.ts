import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { flushServerErrors, reportServerError } from "./lib/monitoring.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  const error = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(error);
  await reportServerError(error, { source: "ssr", extra: { status: response.status } });
  await flushServerErrors();
  return brandedErrorResponse();
}

const GEO_VARY_PATHS = new Set([
  "/",
  "/faq",
  "/for-accountants",
  "/for-owners",
  "/about",
  "/privacy",
  "/terms",
  "/ai",
  "/billing/start",
]);

/** Pricing HTML differs by country. Don't let a shared cache mix ZA and US. */
function withGeoVary(request: Request, response: Response): Response {
  const path = new URL(request.url).pathname.replace(/\/$/, "") || "/";
  if (!GEO_VARY_PATHS.has(path)) return response;
  const headers = new Headers(response.headers);
  const name = "x-vercel-ip-country";
  const existing = headers.get("vary");
  const parts = (existing ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.includes(name)) {
    headers.set("Vary", existing ? `${existing}, ${name}` : name);
  }
  if (!headers.has("cache-control")) {
    headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withGeoVary(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      await reportServerError(error, {
        source: "request",
        extra: { method: request.method, path: new URL(request.url).pathname },
      });
      await flushServerErrors();
      return brandedErrorResponse();
    }
  },
};
