/**
 * Read-only Google Drive helpers. No create, upload, or permission changes.
 */
import {
  assertCloudReadOnlyMethod,
  googleDriveScopesForPickedFolders,
} from "@/lib/im-cloud-scopes";

export type GoogleDriveListItem = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
};

export function googleDriveCredentialsConfigured(): boolean {
  const id = (
    process.env.GOOGLE_DRIVE_CLIENT_ID ??
    process.env.GOOGLE_OAUTH_CLIENT_ID ??
    ""
  ).trim();
  const secret = (
    process.env.GOOGLE_DRIVE_CLIENT_SECRET ??
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ??
    ""
  ).trim();
  return Boolean(id && secret);
}

export function buildGoogleDriveAuthUrl(input: { state: string; redirectUri: string }): string {
  const clientId = (
    process.env.GOOGLE_DRIVE_CLIENT_ID ??
    process.env.GOOGLE_OAUTH_CLIENT_ID ??
    ""
  ).trim();
  const scopes = googleDriveScopesForPickedFolders();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    state: input.state,
    scope: scopes.join(" "),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function googleDriveListChildren(
  accessToken: string,
  folderId: string,
): Promise<GoogleDriveListItem[]> {
  assertCloudReadOnlyMethod("list");
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent("files(id,name,mimeType,parents)");
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`google_drive_list_failed:${res.status}`);
  }
  const body = (await res.json()) as { files?: GoogleDriveListItem[] };
  return body.files ?? [];
}

export async function googleDriveDownload(
  accessToken: string,
  fileId: string,
): Promise<{ bytes: Uint8Array; mimeType: string; name: string }> {
  assertCloudReadOnlyMethod("download");
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,mimeType&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!metaRes.ok) throw new Error(`google_drive_meta_failed:${metaRes.status}`);
  const meta = (await metaRes.json()) as { name?: string; mimeType?: string };

  const exportMime =
    meta.mimeType === "application/vnd.google-apps.document"
      ? "application/pdf"
      : meta.mimeType === "application/vnd.google-apps.spreadsheet"
        ? "application/pdf"
        : null;

  const downloadUrl = exportMime
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;

  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`google_drive_download_failed:${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return {
    bytes: buf,
    mimeType: exportMime ?? meta.mimeType ?? "application/octet-stream",
    name: meta.name ?? "document",
  };
}
