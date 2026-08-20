/**
 * Public unsubscribe endpoint for Milōn Lighthouse cold outreach.
 *
 * Two callers, one token:
 *   - Mail clients POST here with `List-Unsubscribe=One-Click` (RFC 8058)
 *     because the header points at this URL.
 *   - Humans who click the footer link land on GET, which hands them to the
 *     confirmation page so an opt-out is never triggered by a link scanner.
 */

import { createFileRoute } from "@tanstack/react-router";
import { applyLighthouseOptOut, lookupLighthouseOptOut } from "@/lib/lighthouse-optout.server";

function tokenFromUrl(request: Request): string {
  const url = new URL(request.url);
  return (url.searchParams.get("t") || url.searchParams.get("token") || "").trim();
}

export const Route = createFileRoute("/lh/unsubscribe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = tokenFromUrl(request);
        if (!token) {
          return Response.json({ error: "Token is required" }, { status: 400 });
        }

        const url = new URL(request.url);
        if (url.searchParams.get("check") === "1") {
          const found = await lookupLighthouseOptOut(token);
          return Response.json(
            found.found
              ? { valid: !found.alreadyOptedOut, alreadyOptedOut: found.alreadyOptedOut }
              : { valid: false, reason: "invalid" },
          );
        }

        return new Response(null, {
          status: 302,
          headers: { Location: `/unsubscribe?lh=${encodeURIComponent(token)}` },
        });
      },

      POST: async ({ request }) => {
        let token = tokenFromUrl(request);
        let source: "one_click" | "link" = "link";

        const contentType = request.headers.get("content-type") ?? "";
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams(await request.text());
          if (params.get("List-Unsubscribe")) source = "one_click";
          token = token || (params.get("t") ?? params.get("token") ?? "").trim();
        } else {
          try {
            const body = (await request.json()) as { token?: string };
            if (body?.token) token = body.token.trim();
          } catch {
            /* token stays from the query string */
          }
        }

        if (!token) {
          return Response.json({ error: "Token is required" }, { status: 400 });
        }

        const result = await applyLighthouseOptOut(token, source);
        if (!result.ok) {
          return Response.json({ success: false, reason: "invalid" }, { status: 404 });
        }
        return Response.json({
          success: true,
          alreadyOptedOut: result.alreadyOptedOut,
        });
      },
    },
  },
});
