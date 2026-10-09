/**
 * Pre-card AI allowance. A firm with no card (Stripe phase "none") may
 * generate one pack, draft one client email, and ask the Bot ten times.
 * A trialing or paid subscription is not capped. Figures stay outside this.
 */

export const PRECARD_CAP_CODE = "precard_cap" as const;
export const PRECARD_CAP_MESSAGE = "Add a card to start your 14-day free trial";
export const PRECARD_PACK_LIMIT = 1;
export const PRECARD_EMAIL_LIMIT = 1;
export const PRECARD_BOT_LIMIT = 10;

export type PrecardLimitKind = "pack" | "email" | "bot";

export type PrecardUsage = {
  packGenerations: number;
  emailDrafts: number;
  botMessages: number;
};

export const EMPTY_PRECARD_USAGE: PrecardUsage = {
  packGenerations: 0,
  emailDrafts: 0,
  botMessages: 0,
};

export type PrecardDecision =
  | { allowed: true; applies: false; remaining: null }
  | { allowed: true; applies: true; remaining: number }
  | {
      allowed: false;
      applies: true;
      code: typeof PRECARD_CAP_CODE;
      limit: PrecardLimitKind;
      message: typeof PRECARD_CAP_MESSAGE;
      remaining: 0;
    };

export type PrecardCapError = Error & {
  code: typeof PRECARD_CAP_CODE;
  limit: PrecardLimitKind;
};

export function precardLimitFor(kind: PrecardLimitKind): number {
  if (kind === "pack") return PRECARD_PACK_LIMIT;
  if (kind === "email") return PRECARD_EMAIL_LIMIT;
  return PRECARD_BOT_LIMIT;
}

export function precardCapApplies(input: {
  stripeConfigured: boolean;
  phase: "none" | "trialing" | "active";
}): boolean {
  if (!input.stripeConfigured) return false;
  return input.phase === "none";
}

function usedCount(usage: PrecardUsage, kind: PrecardLimitKind): number {
  const raw =
    kind === "pack" ? usage.packGenerations : kind === "email" ? usage.emailDrafts : usage.botMessages;
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.floor(raw);
}

export function decidePrecardAllowance(input: {
  applies: boolean;
  kind: PrecardLimitKind;
  usage: PrecardUsage;
}): PrecardDecision {
  if (!input.applies) return { allowed: true, applies: false, remaining: null };
  const limit = precardLimitFor(input.kind);
  const used = usedCount(input.usage, input.kind);
  const remaining = Math.max(0, limit - used);
  if (used >= limit) {
    return {
      allowed: false,
      applies: true,
      code: PRECARD_CAP_CODE,
      limit: input.kind,
      message: PRECARD_CAP_MESSAGE,
      remaining: 0,
    };
  }
  return { allowed: true, applies: true, remaining };
}

/**
 * Record the allowance only after the generation, draft, or Bot answer
 * succeeded. A card firm (`applies: false`) and a failed attempt do not move
 * the counter.
 */
export async function finishPrecardAttempt(input: {
  decision: PrecardDecision;
  succeeded: boolean;
  record: () => Promise<void>;
}): Promise<"blocked" | "skipped" | "recorded"> {
  if (!input.decision.allowed) return "blocked";
  if (!input.decision.applies || !input.succeeded) return "skipped";
  await input.record();
  return "recorded";
}

export function precardUsageFromRow(row: Record<string, unknown> | null | undefined): PrecardUsage {
  const num = (value: unknown) => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.floor(n);
  };
  return {
    packGenerations: num(row?.precard_pack_generations),
    emailDrafts: num(row?.precard_email_drafts),
    botMessages: num(row?.precard_bot_messages),
  };
}

export function missingPrecardColumn(message: string): boolean {
  return /precard_pack_generations|precard_email_drafts|precard_bot_messages|precard_cap_applies/i.test(
    message,
  );
}

export function precardBotRemainingLabel(remaining: number): string | null {
  if (!Number.isFinite(remaining) || remaining < 1) return null;
  if (Math.floor(remaining) === 1) return "This is your last free Bot question.";
  return `${Math.floor(remaining)} Bot messages left before trial`;
}

/**
 * Why the cap card is showing. The count is the configured allowance
 * (`PRECARD_BOT_LIMIT` and the pack / email limits), not a literal in the UI.
 */
export function precardCapReason(kind: PrecardLimitKind): string {
  const limit = precardLimitFor(kind);
  if (kind === "bot") return `You've used your ${limit} free Bot questions.`;
  if (kind === "email") {
    return limit === 1
      ? "You've used your free client email."
      : `You've used your ${limit} free client emails.`;
  }
  return limit === 1
    ? "You've used your free advisory pack."
    : `You've used your ${limit} free advisory packs.`;
}

/** Client retry token. Same id must not consume a second allowance. */
export function normalizePrecardTurnId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(token)) return null;
  return token;
}

export function precardCapError(limit: PrecardLimitKind): PrecardCapError {
  const err = new Error(PRECARD_CAP_MESSAGE) as PrecardCapError;
  err.code = PRECARD_CAP_CODE;
  err.limit = limit;
  return err;
}

export function isPrecardCapFailure(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object" && (error as { code?: unknown }).code === PRECARD_CAP_CODE) return true;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "";
  return message.includes(PRECARD_CAP_CODE) || message.includes(PRECARD_CAP_MESSAGE);
}

export function isPrecardLimitKind(value: unknown): value is PrecardLimitKind {
  return value === "pack" || value === "email" || value === "bot";
}
