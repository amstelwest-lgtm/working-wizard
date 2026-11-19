import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
};

function mimeFor(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export async function pairDevice(apiBase: string, pairingCode: string, deviceLabel: string) {
  const response = await fetch(`${apiBase}/api/desktop-sync/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairingCode, deviceLabel }),
  });
  return response.json();
}

export async function refreshTokens(apiBase: string, refreshToken: string) {
  const response = await fetch(`${apiBase}/api/desktop-sync/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  return response.json();
}

export async function uploadFile(input: {
  apiBase: string;
  accessToken: string;
  folderLabel: string;
  filePath: string;
}): Promise<{ ok: boolean; reason?: string; skipped?: boolean }> {
  const bytes = await readFile(input.filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const fileName = input.filePath.split(/[/\\]/).pop() ?? "document";
  const response = await fetch(`${apiBase}/api/desktop-sync/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.accessToken}`,
    },
    body: JSON.stringify({
      folderLabel: input.folderLabel,
      fileName,
      mime: mimeFor(fileName),
      sizeBytes: bytes.byteLength,
      sha256,
      contentBase64: bytes.toString("base64"),
    }),
  });
  const body = (await response.json()) as { ok?: boolean; reason?: string; skipped?: boolean };
  if (!response.ok || body.ok !== true) {
    return { ok: false, reason: body.reason ?? `http_${response.status}` };
  }
  if (body.skipped) {
    return { ok: true, skipped: true, reason: body.reason };
  }
  return { ok: true };
}