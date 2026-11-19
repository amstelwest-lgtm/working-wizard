/**
 * Read-only Microsoft Graph / OneDrive helpers.
 */
import {
  assertCloudReadOnlyMethod,
  microsoftGraphScopesForPickedFolders,
} from "@/lib/im-cloud-scopes";

export type GraphDriveItem = {
  id: string;
  name: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  parentReference?: { id?: string; driveId?: string };
};

export function microsoftGraphCredentialsConfigured(): boolean {
  const id = (process.env.MICROSOFT_GRAPH_CLIENT_ID ?? "").trim();
  const secret = (process.env.MICROSOFT_GRAPH_CLIENT_SECRET ?? "").trim();
  return Boolean(id && secret);
}

export function buildMicrosoftGraphAuthUrl(input: {
  state: string;
  redirectUri: string;
}): string {
  const clientId = (process.env.MICROSOFT_GRAPH_CLIENT_ID ?? "").trim();
  const tenant = (process.env.MICROSOFT_GRAPH_TENANT_ID ?? "common").trim();
  const scopes = microsoftGraphScopesForPickedFolders();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    response_mode: "query",
    state: input.state,
    scope: scopes.join(" "),
  });
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function graphListFolderChildren(
  accessToken: string,
  driveId: string,
  folderItemId: string,
): Promise<GraphDriveItem[]> {
  assertCloudReadOnlyMethod("list");
  const url = `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderItemId)}/children?$top=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`graph_list_failed:${res.status}`);
  const body = (await res.json()) as { value?: GraphDriveItem[] };
  return body.value ?? [];
}

export async function graphDownloadItem(
  accessToken: string,
  driveId: string,
  itemId: string,
): Promise<{ bytes: Uint8Array; mimeType: string; name: string }> {
  assertCloudReadOnlyMethod("download");
  const metaRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!metaRes.ok) throw new Error(`graph_meta_failed:${metaRes.status}`);
  const meta = (await metaRes.json()) as GraphDriveItem & { name?: string };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/content`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`graph_download_failed:${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    bytes,
    mimeType: meta.file?.mimeType ?? "application/octet-stream",
    name: meta.name ?? "document",
  };
}