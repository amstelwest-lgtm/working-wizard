/**
 * POST /api/desktop-sync/refresh — rotate device access + refresh tokens.
 */
import { createFileRoute } from "@tanstack/react-router";
import { refreshDesktopSyncDeviceImpl } from "@/lib/desktop-sync-device.functions";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/desktop-sync/refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        const refreshToken = typeof body?.refreshToken === "string" ? body.refreshToken : "";
        const result = await refreshDesktopSyncDeviceImpl({ refreshToken });
        return json(result, result.ok ? 200 : 401);
      },
    },
  },
});