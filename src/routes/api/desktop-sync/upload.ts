/**
 * POST /api/desktop-sync/upload — upload-only device ingest into source-docs.
 */
import { createFileRoute } from "@tanstack/react-router";
import { desktopSyncDeviceUploadImpl } from "@/lib/desktop-sync-device.functions";
import { desktopSyncSqlReady } from "@/lib/desktop-sync-ready";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}

export const Route = createFileRoute("/api/desktop-sync/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!desktopSyncSqlReady()) {
          return json({ ok: false, reason: "not_enabled" }, 503);
        }
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body) return json({ ok: false, reason: "body" }, 400);
        const result = await desktopSyncDeviceUploadImpl(
          {
            folderLabel: String(body.folderLabel ?? ""),
            fileName: String(body.fileName ?? ""),
            mime: String(body.mime ?? ""),
            sizeBytes: Number(body.sizeBytes ?? 0),
            sha256: String(body.sha256 ?? ""),
            contentBase64: String(body.contentBase64 ?? ""),
          },
          bearer(request),
        );
        return json(result, result.ok ? 200 : 400);
      },
    },
  },
});