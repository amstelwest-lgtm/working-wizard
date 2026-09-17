/**
 * Local draft for per-deliverable input checklists and assumption values.
 * Keyed by client so accountant and owner share the same browser workspace.
 * Engine-bound fields (cash collection delay, budget WC days) still persist
 * on the existing clients.cashflow / clients.budget blobs.
 */

import {
  DELIVERABLE_INPUT_IDS,
  type DeliverableInputId,
  type DeliverableInputState,
} from "@/lib/deliverable-input-config";

export const DELIVERABLE_INPUT_STORAGE_PREFIX = "milon.deliverableInputConfig:";

export type StoredDeliverableInputs = Partial<Record<DeliverableInputId, DeliverableInputState>>;

export function deliverableInputStorageKey(clientId: string): string {
  return `${DELIVERABLE_INPUT_STORAGE_PREFIX}${clientId.trim()}`;
}

function canUseStore(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

export function parseDeliverableInputState(raw: unknown): DeliverableInputState | null {
  const o = asRecord(raw);
  if (!o) return null;
  const checked: Record<string, boolean> = {};
  const src = asRecord(o.checkedSources);
  if (src) {
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === "boolean") checked[k] = v;
    }
  }
  const values: Record<string, string | number | boolean> = {};
  const av = asRecord(o.assumptionValues);
  if (av) {
    for (const [k, v] of Object.entries(av)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        values[k] = v;
      }
    }
  }
  const applied =
    typeof o.appliedFingerprint === "string" && o.appliedFingerprint
      ? o.appliedFingerprint
      : undefined;
  return { checkedSources: checked, assumptionValues: values, appliedFingerprint: applied };
}

export function parseStoredDeliverableInputs(raw: unknown): StoredDeliverableInputs {
  const o = asRecord(raw);
  if (!o) return {};
  const out: StoredDeliverableInputs = {};
  for (const id of DELIVERABLE_INPUT_IDS) {
    const parsed = parseDeliverableInputState(o[id]);
    if (parsed) out[id] = parsed;
  }
  return out;
}

export function readStoredDeliverableInputs(clientId: string): StoredDeliverableInputs {
  if (!canUseStore() || !clientId.trim()) return {};
  try {
    const raw = localStorage.getItem(deliverableInputStorageKey(clientId));
    if (!raw) return {};
    return parseStoredDeliverableInputs(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function writeStoredDeliverableInputs(clientId: string, map: StoredDeliverableInputs): void {
  if (!canUseStore() || !clientId.trim()) return;
  try {
    localStorage.setItem(deliverableInputStorageKey(clientId), JSON.stringify(map));
  } catch {
    // Quota / private mode — the in-memory panel state still works for the session.
  }
}

export function patchStoredDeliverableInput(
  clientId: string,
  id: DeliverableInputId,
  state: DeliverableInputState,
): StoredDeliverableInputs {
  const next = { ...readStoredDeliverableInputs(clientId), [id]: state };
  writeStoredDeliverableInputs(clientId, next);
  return next;
}
