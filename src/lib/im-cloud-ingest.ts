/**
 * Bridge cloud / email bytes into the existing source-documents path (review queue).
 * Does not post to any ledger.
 */
import { assertFileWithinPickedFolders, type CloudFileRef, type PickedFolder } from "@/lib/im-cloud-folder-guard";
import { cloudIngestPaused, type ImAccessSettings } from "@/lib/im-access-settings";
import type { UploadChannel } from "@/lib/source-documents-browser";

export type CloudIngestOutcome =
  | { ok: true; reviewQueue: true; channel: UploadChannel }
  | { ok: false; reason: string };

export function sourceChannelForCloud(provider: "google" | "microsoft" | "email"): UploadChannel {
  if (provider === "email") return "email" as UploadChannel;
  return "upload";
}

export function canIngestFromCloud(settings: ImAccessSettings): boolean {
  return !cloudIngestPaused(settings);
}

export function validateCloudFileForIngest(
  file: CloudFileRef,
  settings: ImAccessSettings,
): CloudIngestOutcome {
  if (!canIngestFromCloud(settings)) return { ok: false, reason: "cloud_revoked" };
  const picks: PickedFolder[] = settings.picks.filter((p) => p.provider === file.provider);
  if (picks.length === 0) return { ok: false, reason: "no_picked_folders" };
  try {
    assertFileWithinPickedFolders(file, picks);
  } catch {
    return { ok: false, reason: "outside_picked_folder" };
  }
  return { ok: true, reviewQueue: true, channel: sourceChannelForCloud(file.provider) };
}

/** Classification stays uncertain until a human decides in the review queue. */
export function classificationStaysInReview(): true {
  return true;
}