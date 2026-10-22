/**
 * Pure rules for finishing a client document link.
 * No database, no mail, and no file bytes.
 */
import { clientDocumentPath } from "@/lib/client-documents";
import { itemLabel, itemSettled, pathBelongsToSend } from "@/lib/client-agent-link";

const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
};

export type CompletionItem = {
  itemKey: string;
  label: string | null;
  status: string;
  quality: string | null;
  storagePath: string | null;
  mime: string | null;
  sizeBytes: number | null;
  explanation: string | null;
};

export type FinalFile = {
  itemKey: string;
  label: string;
  sourcePath: string;
  mime: string;
  size: number;
  displayName: string | null;
};

export type ArchiveFileRow = {
  itemKey: string;
  storagePath: string;
  mime: string | null;
  sizeBytes: number | null;
  displayName: string | null;
};

export type CompletionDecision =
  | { ok: false; reason: "consent" | "incomplete" | "file" }
  | { ok: true; already: true }
  | {
      ok: true;
      already: false;
      files: FinalFile[];
      received: number;
      missing: number;
      notes: string[];
    };

export function extensionForAgentMime(mime: string): string | null {
  return EXT_BY_MIME[mime] ?? null;
}

export function artifactCopyKey(sendId: string, itemKey: string, sourcePath: string): string {
  return `${sendId}\n${itemKey}\n${sourcePath}`;
}

export function clientAgentDoneIdempotencyKey(sendId: string): string {
  return `client-agent-done/${sendId}`;
}

/** Files still missing from the archive. A retry skips a stored source path. */
export function copiesStillNeeded(
  files: readonly FinalFile[],
  sendId: string,
  existing: ReadonlyArray<{ itemKey: string; sourcePath: string }>,
): FinalFile[] {
  const have = new Set(existing.map((row) => artifactCopyKey(sendId, row.itemKey, row.sourcePath)));
  return files.filter((file) => !have.has(artifactCopyKey(sendId, file.itemKey, file.sourcePath)));
}

export function indexedCopyKeys(
  rows: ReadonlyArray<{ meta: unknown }>,
  sendId: string,
): Array<{ itemKey: string; sourcePath: string }> {
  const out: Array<{ itemKey: string; sourcePath: string }> = [];
  for (const row of rows) {
    if (!row.meta || typeof row.meta !== "object") continue;
    const meta = row.meta as Record<string, unknown>;
    if (meta.source !== "client_agent_send" || meta.send_id !== sendId) continue;
    if (typeof meta.item_key !== "string" || typeof meta.source_path !== "string") continue;
    out.push({ itemKey: meta.item_key, sourcePath: meta.source_path });
  }
  return out;
}

export function completionDecision(input: {
  consentAt: string | null;
  completedAt: string | null;
  sendId: string;
  items: readonly CompletionItem[];
  fileRows?: readonly ArchiveFileRow[];
}): CompletionDecision {
  if (input.completedAt) return { ok: true, already: true };
  if (!input.consentAt) return { ok: false, reason: "consent" };
  if (
    input.items.length === 0 ||
    !input.items.every((item) =>
      itemSettled({
        hasFile: Boolean(item.storagePath),
        status: item.status,
        quality: item.quality,
      }),
    )
  ) {
    return { ok: false, reason: "incomplete" };
  }

  const files: FinalFile[] = [];
  const notes: string[] = [];
  const pushFile = (file: Omit<FinalFile, "displayName"> & { displayName?: string | null }) => {
    files.push({ ...file, displayName: file.displayName?.trim() || null });
  };
  const fromItem = (item: CompletionItem): { ok: false; reason: "file" } | { ok: true } => {
    if (!item.storagePath) return { ok: true };
    if (files.some((file) => file.sourcePath === item.storagePath)) return { ok: true };
    if (!pathBelongsToSend(item.storagePath, input.sendId, item.itemKey)) {
      return { ok: false, reason: "file" };
    }
    const mime = item.mime ?? "";
    if (!extensionForAgentMime(mime)) return { ok: false, reason: "file" };
    pushFile({
      itemKey: item.itemKey,
      label: itemLabel(item.itemKey, item.label),
      sourcePath: item.storagePath,
      mime,
      size: item.sizeBytes ?? 0,
    });
    return { ok: true };
  };

  if (input.fileRows && input.fileRows.length > 0) {
    const labels = new Map(
      input.items.map((item) => [item.itemKey, itemLabel(item.itemKey, item.label)]),
    );
    for (const row of input.fileRows) {
      if (!pathBelongsToSend(row.storagePath, input.sendId, row.itemKey)) {
        return { ok: false, reason: "file" };
      }
      const mime = row.mime ?? "";
      if (!extensionForAgentMime(mime)) return { ok: false, reason: "file" };
      pushFile({
        itemKey: row.itemKey,
        label: labels.get(row.itemKey) ?? itemLabel(row.itemKey, null),
        sourcePath: row.storagePath,
        mime,
        size: row.sizeBytes ?? 0,
        displayName: row.displayName,
      });
    }
  }

  for (const item of input.items) {
    const label = itemLabel(item.itemKey, item.label);
    const note = item.explanation?.trim() ?? "";
    if (note) notes.push(`${label}: ${note}`);
    const added = fromItem(item);
    if (!added.ok) return added;
  }
  const withFile = new Set(files.map((file) => file.itemKey));
  const missing = input.items.filter((item) => !withFile.has(item.itemKey)).length;

  return {
    ok: true,
    already: false,
    files,
    received: files.length,
    missing,
    notes,
  };
}

export function buildClientAgentArtifact(input: {
  artifactId: string;
  clientId: string;
  sendId: string;
  itemKey: string;
  label: string;
  mime: string;
  size: number;
  sourcePath: string;
  displayName?: string | null;
}): {
  id: string;
  client_id: string;
  kind: "upload";
  storage_path: string;
  visibility: "shared";
  created_by: null;
  meta: {
    source: "client_agent_send";
    send_id: string;
    item_key: string;
    label: string;
    mime: string;
    size: number;
    source_path: string;
    file_name: string;
    bytes: number;
  };
} {
  const ext = extensionForAgentMime(input.mime);
  if (!ext) throw new Error("mime");
  return {
    id: input.artifactId,
    client_id: input.clientId,
    kind: "upload",
    storage_path: clientDocumentPath(input.clientId, input.artifactId, ext),
    visibility: "shared",
    created_by: null,
    meta: {
      source: "client_agent_send",
      send_id: input.sendId,
      item_key: input.itemKey,
      label: input.label,
      mime: input.mime,
      size: input.size,
      source_path: input.sourcePath,
      file_name: input.displayName?.trim() || input.label,
      bytes: input.size,
    },
  };
}

export function copiedDocumentPaths(
  rows: ReadonlyArray<{ storage_path: unknown; visibility: unknown; meta: unknown }>,
  sendId: string,
  itemKey: string,
): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (row.visibility !== "shared") continue;
    if (typeof row.storage_path !== "string" || row.storage_path.length === 0) continue;
    if (!row.meta || typeof row.meta !== "object") continue;
    const meta = row.meta as Record<string, unknown>;
    if (meta.source !== "client_agent_send") continue;
    if (meta.send_id !== sendId || meta.item_key !== itemKey) continue;
    out.push(row.storage_path);
  }
  return out;
}

export function copiedDocumentPath(
  rows: ReadonlyArray<{ storage_path: unknown; visibility: unknown; meta: unknown }>,
  sendId: string,
  itemKey: string,
): string | null {
  for (const row of rows) {
    if (row.visibility !== "shared") continue;
    if (typeof row.storage_path !== "string" || row.storage_path.length === 0) continue;
    if (!row.meta || typeof row.meta !== "object") continue;
    const meta = row.meta as Record<string, unknown>;
    if (meta.source !== "client_agent_send") continue;
    if (meta.send_id !== sendId || meta.item_key !== itemKey) continue;
    return row.storage_path;
  }
  return null;
}

export function receivedItemStatus(item: {
  storagePath: string | null;
  status: string;
  quality: string | null;
}): "Received" | "I don't have this" | "Waiting" {
  if (item.status === "received" && (item.quality === "incomplete" || item.quality === "poor")) {
    return "I don't have this";
  }
  if (item.storagePath || (item.status === "received" && item.quality === "usable")) return "Received";
  return "Waiting";
}

export function countUnreviewedSends(
  rows: ReadonlyArray<Record<string, unknown>>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const clientId = typeof row.client_id === "string" ? row.client_id : "";
    if (!clientId) continue;
    const completed = typeof row.completed_at === "string" && row.completed_at.length > 0;
    const reviewed = typeof row.reviewed_at === "string" && row.reviewed_at.length > 0;
    if (!completed || reviewed) continue;
    counts.set(clientId, (counts.get(clientId) ?? 0) + 1);
  }
  return counts;
}

export function reviewDecision(input: {
  member: boolean;
  firmAllowed: boolean;
  found: boolean;
  completedAt: string | null;
  reviewedAt: string | null;
}):
  | { ok: true; already: boolean }
  | { ok: false; reason: "forbidden" | "not_allowed" | "not_found" | "not_ready" } {
  if (!input.firmAllowed) return { ok: false, reason: "not_allowed" };
  if (!input.member) return { ok: false, reason: "forbidden" };
  if (!input.found) return { ok: false, reason: "not_found" };
  if (!input.completedAt) return { ok: false, reason: "not_ready" };
  if (input.reviewedAt) return { ok: true, already: true };
  return { ok: true, already: false };
}
