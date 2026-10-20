/**
 * Unsaved Business map and owner-drip answers. The browser keeps the text
 * until it is saved or the person discards it. Reload and a sidebar click
 * restore it the next time that question opens.
 */

export type BrainAnswerSide = "accountant" | "owner";

export type BrainAnswerDraft = {
  text: string;
  choice?: string;
  lineValues?: Record<string, string>;
  weeklyRev?: string;
  weeklyCos?: string;
};

export const DISCARD_BRAIN_ANSWER = "Discard this answer?";

const PREFIX = "milon.brainAnswerDraft.v1:";
const TEXT_MAX = 4000;

type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function brainAnswerStorageKey(clientId: string): string {
  return `${PREFIX}${clientId.trim()}`;
}

function browserStore(): DraftStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function draftKey(side: BrainAnswerSide, questionKey: string): string {
  return `${side}:${questionKey.trim()}`;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function parseDraft(raw: unknown): BrainAnswerDraft | null {
  const row = asRecord(raw);
  if (!row || typeof row.text !== "string") return null;
  const text = row.text.slice(0, TEXT_MAX);
  const draft: BrainAnswerDraft = { text };
  if (typeof row.choice === "string" && row.choice.trim()) draft.choice = row.choice.slice(0, 200);
  if (typeof row.weeklyRev === "string") draft.weeklyRev = row.weeklyRev.slice(0, 40);
  if (typeof row.weeklyCos === "string") draft.weeklyCos = row.weeklyCos.slice(0, 40);
  const lines = asRecord(row.lineValues);
  if (lines) {
    const lineValues: Record<string, string> = {};
    for (const [key, value] of Object.entries(lines)) {
      if (typeof value === "string" && key.trim()) lineValues[key.slice(0, 80)] = value.slice(0, 40);
    }
    if (Object.keys(lineValues).length) draft.lineValues = lineValues;
  }
  return draftHasContent(draft) ? draft : null;
}

export function draftHasContent(draft: BrainAnswerDraft | null | undefined): boolean {
  if (!draft) return false;
  if (draft.text.trim()) return true;
  if (draft.choice?.trim()) return true;
  if (draft.weeklyRev?.trim() || draft.weeklyCos?.trim()) return true;
  return Object.values(draft.lineValues ?? {}).some((value) => value.trim());
}

function readMap(clientId: string, store: DraftStore | null): Record<string, BrainAnswerDraft> {
  if (!store || !clientId.trim()) return {};
  try {
    const raw = store.getItem(brainAnswerStorageKey(clientId));
    if (!raw) return {};
    const parsed = asRecord(JSON.parse(raw));
    if (!parsed) return {};
    const out: Record<string, BrainAnswerDraft> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const draft = parseDraft(value);
      if (draft) out[key] = draft;
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(clientId: string, map: Record<string, BrainAnswerDraft>, store: DraftStore | null) {
  if (!store || !clientId.trim()) return;
  const key = brainAnswerStorageKey(clientId);
  if (Object.keys(map).length === 0) {
    store.removeItem(key);
    return;
  }
  store.setItem(key, JSON.stringify(map));
}

export function listBrainAnswerDrafts(
  clientId: string,
  side: BrainAnswerSide,
  store?: DraftStore | null,
): Record<string, BrainAnswerDraft> {
  const map = readMap(clientId, store === undefined ? browserStore() : store);
  const prefix = `${side}:`;
  const out: Record<string, BrainAnswerDraft> = {};
  for (const [key, draft] of Object.entries(map)) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = draft;
  }
  return out;
}

export function readBrainAnswerDraft(
  clientId: string,
  side: BrainAnswerSide,
  questionKey: string,
  store?: DraftStore | null,
): BrainAnswerDraft | null {
  if (!questionKey.trim()) return null;
  const map = readMap(clientId, store === undefined ? browserStore() : store);
  return map[draftKey(side, questionKey)] ?? null;
}

export function writeBrainAnswerDraft(
  clientId: string,
  side: BrainAnswerSide,
  questionKey: string,
  draft: BrainAnswerDraft,
  store?: DraftStore | null,
): Record<string, BrainAnswerDraft> {
  const used = store === undefined ? browserStore() : store;
  const map = readMap(clientId, used);
  const key = draftKey(side, questionKey);
  const next = parseDraft({ ...draft, text: draft.text ?? "" });
  if (!questionKey.trim() || !next) delete map[key];
  else map[key] = next;
  writeMap(clientId, map, used);
  return listBrainAnswerDrafts(clientId, side, used);
}

export function clearBrainAnswerDraft(
  clientId: string,
  side: BrainAnswerSide,
  questionKey: string,
  store?: DraftStore | null,
): Record<string, BrainAnswerDraft> {
  return writeBrainAnswerDraft(clientId, side, questionKey, { text: "" }, store);
}
