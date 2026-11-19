/**
 * Implementation Manager access ladder rungs 3–4: read-only cloud folders.
 * No blanket drive sync, no write-back scopes.
 */

export const IM_ACCESS_RUNG_GOOGLE = 3;
export const IM_ACCESS_RUNG_MICROSOFT = 4;

export const GOOGLE_DRIVE_READONLY_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
] as const;

/** Prefer drive.file when the Picker returns explicit folder ids (supplemental). */
export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file" as const;

export const MICROSOFT_GRAPH_FILES_READ_SCOPE = "Files.Read" as const;

/** Methods we never call — tests and runtime guards reject these. */
export const FORBIDDEN_CLOUD_WRITE_METHODS = [
  "create",
  "update",
  "patch",
  "delete",
  "upload",
  "copy",
  "move",
  "permissions.create",
  "permissions.update",
  "permissions.delete",
] as const;

export type ForbiddenCloudWriteMethod = (typeof FORBIDDEN_CLOUD_WRITE_METHODS)[number];

export function assertCloudReadOnlyMethod(method: string): void {
  const lower = method.trim().toLowerCase();
  for (const blocked of FORBIDDEN_CLOUD_WRITE_METHODS) {
    if (lower === blocked || lower.endsWith(`.${blocked}`)) {
      throw new Error(`cloud_write_forbidden:${blocked}`);
    }
  }
}

export function googleDriveScopesForPickedFolders(): string[] {
  return [GOOGLE_DRIVE_FILE_SCOPE, ...GOOGLE_DRIVE_READONLY_SCOPES];
}

export function microsoftGraphScopesForPickedFolders(): string[] {
  return [MICROSOFT_GRAPH_FILES_READ_SCOPE, "offline_access"];
}