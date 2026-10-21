/**
 * Hard deadline for the firm billing check.
 * The handler answers by FIRM_BILLING_PLAN_FALLBACK_MS even when the stored
 * plan read or Stripe never returns. A stored entitled plan opens the file.
 * Anything else that is not a finished no-plan result stays unknown.
 *
 * @vercel/functions waitUntil reads a request-context symbol and does
 * nothing when this server function's fetch handler did not install it
 * (api/server.js forwards the request with no waitUntil). The customer-id
 * write is awaited inside the time still left on this deadline. It is not
 * handed to waitUntil.
 */

import {
  classifyBillingCheckFailure,
  entitlementWhenBillingCheckFails,
  FIRM_BILLING_PLAN_FALLBACK_MS,
  type BillingCheckFailureKind,
  type StoredFirmPlan,
} from "@/lib/billing-check-failure";
import type { FirmBillingEntitlement } from "@/lib/stripe-entitlement";

/** Short read of firms.billing_plan_known, raced with Stripe. */
export const FIRM_BILLING_PLAN_READ_BUDGET_MS = 1_000;

/**
 * Browser abort for getFirmBillingEntitlement. A dead socket becomes a
 * retryable timeout instead of an open-ended fetch.
 */
export const FIRM_BILLING_CLIENT_ABORT_MS = 9_000;

export type FirmBillingDeadlineCode =
  | "plan-read-null"
  | "plan-read-error"
  | "plan-read-timeout"
  | "stripe-timeout"
  | "stripe-error"
  | "deadline-hit"
  | "entitled-fallback"
  | "metadata-write-ok"
  | "metadata-write-fail";

const failWith = entitlementWhenBillingCheckFails;

export function firmBillingClientAbortSignal(
  ms = FIRM_BILLING_CLIENT_ABORT_MS,
): AbortSignal {
  return AbortSignal.timeout(ms);
}

export function logFirmBillingDeadline(
  code: FirmBillingDeadlineCode,
  extra?: Record<string, unknown>,
): void {
  const line = { code, ...extra };
  if (code === "metadata-write-ok") console.info("[billing-deadline]", line);
  else console.warn("[billing-deadline]", line);
}

export function isFirmBillingAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function failureKind(err: unknown): BillingCheckFailureKind {
  return classifyBillingCheckFailure(err);
}

function stripeCode(kind: BillingCheckFailureKind): "stripe-timeout" | "stripe-error" {
  return kind === "timeout" ? "stripe-timeout" : "stripe-error";
}

function isDefinite(value: FirmBillingEntitlement): boolean {
  return !value.checkFailed && value.reason !== "stripe_error";
}

const never = new Promise<never>(() => {});

export type FirmBillingSettleInput = {
  deadlineMs?: number;
  readFirmIds: () => Promise<{
    firmId: string | null;
    early?: FirmBillingEntitlement | Promise<FirmBillingEntitlement>;
  }>;
  readPlan: (
    firmId: string | null,
    budgetMs: number,
    signal: AbortSignal,
  ) => Promise<StoredFirmPlan | null>;
  readLive: (ctx: {
    firmId: string | null;
    signal: AbortSignal;
    deadlineAt: number;
  }) => Promise<FirmBillingEntitlement>;
  prior: (firmId: string | null) => FirmBillingEntitlement | null;
  whenLiveFails?: typeof entitlementWhenBillingCheckFails;
  finishMetadata?: (deadlineAt: number) => Promise<void>;
};

/**
 * Answers by the deadline. The plan read and the Stripe read start together
 * after the firm id is known. The handler stops waiting at the deadline.
 * subscriptions.list keeps the bind-fix budget and is not capped again here.
 */
export function settleFirmBillingCheck(input: FirmBillingSettleInput): Promise<FirmBillingEntitlement> {
  let resolveOuter: (value: FirmBillingEntitlement) => void = () => {};
  const outer = new Promise<FirmBillingEntitlement>((resolve) => {
    resolveOuter = resolve;
  });
  void (async () => {
    await Promise.resolve();
    try {
      resolveOuter(await runFirmBillingDeadline(input));
    } catch (err) {
      const kind = failureKind(err);
      logFirmBillingDeadline(stripeCode(kind));
      resolveOuter(
        (input.whenLiveFails ?? failWith)({
          storedPlan: null,
          prior: null,
          kind,
        }),
      );
    }
  })();
  return outer;
}

async function runFirmBillingDeadline(input: FirmBillingSettleInput): Promise<FirmBillingEntitlement> {
  const deadlineMs = input.deadlineMs ?? FIRM_BILLING_PLAN_FALLBACK_MS;
  const started = Date.now();
  const deadlineAt = started + deadlineMs;
  const abort = new AbortController();
  const planAbort = new AbortController();
  const state: {
    firmId: string | null;
    storedPlan: StoredFirmPlan | null | undefined;
    planStarted: boolean;
    decided: FirmBillingEntitlement | null;
  } = { firmId: null, storedPlan: undefined, planStarted: false, decided: null };
  const apply = input.whenLiveFails ?? failWith;

  let backstopTimer: ReturnType<typeof setTimeout> | undefined;
  const backstop = new Promise<FirmBillingEntitlement>((resolve) => {
    backstopTimer = setTimeout(() => {
      abort.abort();
      planAbort.abort();
      if (state.decided) {
        resolve(state.decided);
        return;
      }
      const stored = state.storedPlan === undefined ? null : state.storedPlan;
      if (state.planStarted && state.storedPlan === undefined) {
        logFirmBillingDeadline("plan-read-timeout");
      }
      if (stored === "entitled") {
        logFirmBillingDeadline("entitled-fallback");
      } else {
        logFirmBillingDeadline("deadline-hit");
      }
      void input.finishMetadata?.(deadlineAt);
      resolve(
        apply({
          storedPlan: stored,
          prior: input.prior(state.firmId),
          kind: "timeout",
        }),
      );
    }, deadlineMs);
  });

  try {
    return await Promise.race([liveAndPlan(), backstop]);
  } finally {
    if (backstopTimer) clearTimeout(backstopTimer);
    abort.abort();
    planAbort.abort();
  }

  async function liveAndPlan(): Promise<FirmBillingEntitlement> {
    let ids: { firmId: string | null; early?: FirmBillingEntitlement | Promise<FirmBillingEntitlement> };
    try {
      ids = await input.readFirmIds();
    } catch (err) {
      if (abort.signal.aborted) return new Promise(() => {});
      const kind = failureKind(err);
      logFirmBillingDeadline(stripeCode(kind), { stage: "firm-ids" });
      return apply({ storedPlan: null, prior: input.prior(null), kind });
    }
    state.firmId = ids.firmId;
    if (ids.early) {
      const early = await ids.early;
      if (abort.signal.aborted) return new Promise(() => {});
      state.decided = early;
      await input.finishMetadata?.(deadlineAt);
      return early;
    }

    state.planStarted = true;
    const planBudget = Math.max(
      1,
      Math.min(FIRM_BILLING_PLAN_READ_BUDGET_MS, deadlineAt - Date.now()),
    );
    const planPromise = input.readPlan(ids.firmId, planBudget, planAbort.signal).then(
      (plan) => ({ ok: true as const, plan }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    const livePromise = input
      .readLive({
        firmId: ids.firmId,
        signal: abort.signal,
        deadlineAt,
      })
      .then(
        (value) => ({ ok: true as const, value }),
        (err: unknown) => ({ ok: false as const, err }),
      );

    let planDone = false;
    let liveDone = false;
    let liveOutcome:
      | { ok: true; value: FirmBillingEntitlement }
      | { ok: false; err: unknown }
      | null = null;

    while (!planDone || !liveDone) {
      if (abort.signal.aborted) return new Promise(() => {});
      const event = await Promise.race([
        planDone ? never : planPromise.then((plan) => ({ type: "plan" as const, plan })),
        liveDone ? never : livePromise.then((live) => ({ type: "live" as const, live })),
      ]);
      if (abort.signal.aborted) return new Promise(() => {});
      if (event.type === "plan") {
        planDone = true;
        if (event.plan.ok) {
          state.storedPlan = event.plan.plan;
          if (event.plan.plan == null) logFirmBillingDeadline("plan-read-null");
        } else {
          state.storedPlan = null;
          const kind = failureKind(event.plan.err);
          logFirmBillingDeadline(kind === "timeout" ? "plan-read-timeout" : "plan-read-error");
        }
        continue;
      }
      liveDone = true;
      liveOutcome = event.live;
      if (event.live.ok && isDefinite(event.live.value)) {
        planAbort.abort();
        state.decided = event.live.value;
        await input.finishMetadata?.(deadlineAt);
        return event.live.value;
      }
      if (planDone) break;
    }

    if (abort.signal.aborted) return new Promise(() => {});
    const stored = state.storedPlan ?? null;
    let kind: BillingCheckFailureKind = "timeout";
    if (liveOutcome && !liveOutcome.ok && !isFirmBillingAbort(liveOutcome.err)) {
      kind = failureKind(liveOutcome.err);
      logFirmBillingDeadline(stripeCode(kind));
    } else if (liveOutcome?.ok && liveOutcome.value.checkFailed) {
      kind = liveOutcome.value.checkFailed;
      logFirmBillingDeadline(stripeCode(kind));
    }
    if (stored === "entitled") logFirmBillingDeadline("entitled-fallback");
    const result = apply({
      storedPlan: stored,
      prior: input.prior(state.firmId),
      kind,
    });
    state.decided = result;
    await input.finishMetadata?.(deadlineAt);
    return result;
  }
}
