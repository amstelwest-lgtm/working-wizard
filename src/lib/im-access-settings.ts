/**
 * Non-secret IM access ladder settings stored on clients.deliverable_inputs.imAccess.
 * OAuth tokens live in a future service-role table (SQL pending approval).
 */

import type { PickedFolder } from "@/lib/im-cloud-folder-guard";

export type ImAccessProvider = "google" | "microsoft";

export type ImAccessSettings = {
  version: 1;
  picks: PickedFolder[];
  /** When set, cloud poll and OAuth refresh stop until reconnected. */
  revokedAt: string | null;
  forwarding: {
    allowedSenders: string[];
  };
};

export const IM_ACCESS_SETTINGS_KEY = "imAccess";

const EMPTY: ImAccessSettings = {
  version: 1,
  picks: [],
  revokedAt: null,
  forwarding: { allowedSenders: [] },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function parsePick(row: unknown): PickedFolder | null {
  if (!isRecord(row)) return null;
  const provider = row.provider;
  const folderId = row.folderId;
  if (provider !== "google" && provider !== "microsoft") return null;
  if (typeof folderId !== "string" || !folderId.trim()) return null;
  const label = typeof row.label === "string" ? row.label.trim() : undefined;
  return { provider, folderId: folderId.trim(), label: label || undefined };
}

export function parseImAccessSettings(raw: unknown): ImAccessSettings {
  if (!isRecord(raw)) return { ...EMPTY, picks: [] };
  const picks: PickedFolder[] = [];
  if (Array.isArray(raw.picks)) {
    for (const row of raw.picks) {
      const pick = parsePick(row);
      if (pick) picks.push(pick);
    }
  }
  const revokedAt = typeof raw.revokedAt === "string" ? raw.revokedAt : null;
  const forwardingRaw = raw.forwarding;
  const allowedSenders: string[] = [];
  if (isRecord(forwardingRaw) && Array.isArray(forwardingRaw.allowedSenders)) {
    for (const e of forwardingRaw.allowedSenders) {
      if (typeof e === "string" && e.includes("@")) {
        allowedSenders.push(e.trim().toLowerCase());
      }
    }
  }
  const version = raw.version === 1 ? 1 : 1;
  return { version, picks, revokedAt, forwarding: { allowedSenders } };
}

export function mergeImAccessIntoDeliverableInputs(
  existing: unknown,
  patch: Partial<ImAccessSettings>,
): Record<string, unknown> {
  const base = isRecord(existing) ? { ...existing } : {};
  const current = parseImAccessSettings(base[IM_ACCESS_SETTINGS_KEY]);
  const next: ImAccessSettings = {
    version: 1,
    picks: patch.picks ?? current.picks,
    revokedAt: patch.revokedAt !== undefined ? patch.revokedAt : current.revokedAt,
    forwarding: patch.forwarding ?? current.forwarding,
  };
  return { ...base, [IM_ACCESS_SETTINGS_KEY]: next };
}

export function cloudIngestPaused(settings: ImAccessSettings): boolean {
  return Boolean(settings.revokedAt);
}