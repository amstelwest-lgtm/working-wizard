/**
 * Read-only cloud listing for Deno edge (no `@/` imports).
 */
import { assertCloudReadOnlyMethod } from "./im-cloud-scopes";

export type GoogleDriveListItem = {
  id: string;
  name: string;
  mimeType: string;
};

export async function edgeGoogleDriveListChildren(
  accessToken: string,
  folderId: string,
): Promise<GoogleDriveListItem[]> {
  assertCloudReadOnlyMethod("list");
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent("files(id,name,mimeType)");
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`google_drive_list_failed:${res.status}`);
  const body = (await res.json()) as { files?: GoogleDriveListItem[] };
  return body.files ?? [];
}

export async function edgeMicrosoftGraphListFolderByItemId(
  accessToken: string,
  folderItemId: string,
): Promise<Array<{ id: string; name: string }>> {
  assertCloudReadOnlyMethod("list");
  const url = `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(folderItemId)}/children?$top=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`graph_list_failed:${res.status}`);
  const body = (await res.json()) as { value?: Array<{ id: string; name: string }> };
  return body.value ?? [];
}