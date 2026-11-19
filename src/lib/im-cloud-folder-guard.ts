/**
 * Enforce least-privilege: only files under accountant-picked folder roots ingest.
 */

export type PickedFolder = {
  provider: "google" | "microsoft";
  folderId: string;
  label?: string;
};

export type CloudFileRef = {
  provider: "google" | "microsoft";
  fileId: string;
  /** Immediate parent folder id from the provider listing API. */
  parentFolderId: string | null;
  /** Optional ancestor chain nearest-first (parent, grandparent, …). */
  ancestorFolderIds?: readonly string[];
};

export function normaliseFolderId(id: string): string {
  return id.trim();
}

export function isUnderPickedFolder(
  file: CloudFileRef,
  picks: readonly PickedFolder[],
): boolean {
  const providerPicks = picks.filter((p) => p.provider === file.provider);
  if (providerPicks.length === 0) return false;

  const roots = new Set(providerPicks.map((p) => normaliseFolderId(p.folderId)));
  const parent = file.parentFolderId ? normaliseFolderId(file.parentFolderId) : "";
  if (parent && roots.has(parent)) return true;

  for (const anc of file.ancestorFolderIds ?? []) {
    if (roots.has(normaliseFolderId(anc))) return true;
  }

  // A file may be the folder root itself when the provider uses the folder id as item id.
  if (roots.has(normaliseFolderId(file.fileId))) return true;

  return false;
}

export function assertFileWithinPickedFolders(
  file: CloudFileRef,
  picks: readonly PickedFolder[],
): void {
  if (!isUnderPickedFolder(file, picks)) {
    throw new Error("cloud_scope_outside_picked_folder");
  }
}