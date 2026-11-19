/**
 * POST /api/desktop-sync/pair — device pairing with one-time code. No session cookie.
 */
import { createFileRoute } from "@tanstack/react-router";
import { pairDesktopSyncDeviceImpl } from "@/lib/desktop-sync-device.functions";
import { desktopSyncSqlReady } from "@/lib/desktop-sync-ready";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/desktop-sync/pair")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!desktopSyncSqlReady()) {
          return json({ ok: false, reason: "not_enabled" }, 503);
        }
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        const pairingCode = typeof body?.pairingCode === "string" ? body.pairingCode : "";
        const deviceLabel = typeof body?.deviceLabel === "string" ? body.deviceLabel : undefined;
        const origin = new URL(request.url).origin;
        const result = await pairDesktopSyncDeviceImpl({ pairingCode, deviceLabel }, origin);
        return json(result, result.ok ? 200 : 400);
      },
    },
  },
});