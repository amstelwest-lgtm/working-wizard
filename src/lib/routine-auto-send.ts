/**
 * Opt-in auto-send for one client routine.
 * The counter and the flag live on the routine map meta. Nothing here sends mail.
 * Tax routines and ledger-post routines never carry the flag.
 */

export const ROUTINE_AUTO_SEND_UNLOCK = 3;

export type RoutineAutoSendState = {
  clean: number;
  on: boolean;
  byName: string | null;
  byUserId: string | null;
  at: string | null;
};

const EMPTY: RoutineAutoSendState = {
  clean: 0,
  on: false,
  byName: null,
  byUserId: null,
  at: null,
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function whole(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(99, Math.floor(n));
}

export function readRoutineAutoSend(meta: unknown): RoutineAutoSendState {
  const row = record(meta);
  const stored = record(row?.autoSend);
  if (!stored) return { ...EMPTY };
  const byName = typeof stored.byName === "string" ? stored.byName.trim() : "";
  const byUserId = typeof stored.byUserId === "string" ? stored.byUserId.trim() : "";
  const at = typeof stored.at === "string" ? stored.at.trim() : "";
  return {
    clean: whole(stored.clean),
    on: stored.on === true,
    byName: byName || null,
    byUserId: byUserId || null,
    at: at || null,
  };
}

function stepsOf(meta: unknown): Record<string, unknown>[] {
  const row = record(meta);
  if (!row || !Array.isArray(row.steps)) return [];
  return row.steps.filter((step): step is Record<string, unknown> => Boolean(record(step)));
}

/** Tax deadline routines and any routine with a ledger-post gate. */
export function routineAutoSendBlocked(meta: unknown): boolean {
  const row = record(meta);
  if (!row) return true;
  if (row.routine === "tax_deadline_watch" || row.action === "tax_deadline_watch") return true;
  for (const step of stepsOf(meta)) {
    const gate = record(step.approvalGate);
    if (gate?.kind === "human_ledger_post") return true;
    const owner = typeof step.botOwner === "string" ? step.botOwner : "";
    if (/tax/i.test(owner)) return true;
  }
  return false;
}

export function routineAutoSendEligible(meta: unknown): boolean {
  const row = record(meta);
  if (!row) return false;
  if (row.doc_type !== "im_routine_map") return false;
  if (typeof row.routine !== "string" || !row.routine) return false;
  return !routineAutoSendBlocked(meta);
}

/** A clean approval adds one. An edit or a bounce clears the streak and the flag. */
export function nextRoutineAutoSend(
  state: RoutineAutoSendState,
  event: "clean" | "edit" | "bounce",
): RoutineAutoSendState {
  if (event === "clean") {
    return { ...state, clean: Math.min(99, state.clean + 1) };
  }
  return { ...state, clean: 0, on: false };
}

export function withRoutineAutoSend(
  meta: Record<string, unknown>,
  state: RoutineAutoSendState,
): Record<string, unknown> {
  if (routineAutoSendBlocked(meta)) {
    const next = { ...meta };
    delete next.autoSend;
    return next;
  }
  return {
    ...meta,
    autoSend: {
      clean: state.clean,
      on: state.on === true && state.clean >= ROUTINE_AUTO_SEND_UNLOCK,
      ...(state.byName ? { byName: state.byName } : {}),
      ...(state.byUserId ? { byUserId: state.byUserId } : {}),
      ...(state.at ? { at: state.at } : {}),
    },
  };
}

/**
 * The flag is on, the streak is still unlocked, and this draft was written
 * after the accountant turned the flag on.
 */
export function routineAutoSendDue(meta: unknown, findingCreatedAt: string | null | undefined): boolean {
  if (!routineAutoSendEligible(meta)) return false;
  const state = readRoutineAutoSend(meta);
  if (!state.on || state.clean < ROUTINE_AUTO_SEND_UNLOCK || !state.at || !state.byUserId || !state.byName) {
    return false;
  }
  if (state.byName.includes("@")) return false;
  const created = (findingCreatedAt ?? "").trim();
  if (!created || created < state.at) return false;
  return true;
}

/** `im_activation:{firm}:{client}:{routine}:{step}` → the routine name. */
export function routineFromMoveKey(sourceMoveKey: string | null | undefined): string | null {
  const parts = (sourceMoveKey ?? "").split(":");
  if (parts.length !== 5 || parts[0] !== "im_activation") return null;
  return parts[3] || null;
}
