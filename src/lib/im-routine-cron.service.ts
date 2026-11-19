/**
 * Vercel cron entry for IM routine scheduling — caps, kill switch, structured counts.
 */
import {
  emptyImRoutineSchedulerCounts,
  listFirmIdsWithAcceptedRoutines,
  runImRoutineSchedulerCore,
  type ImRoutineSchedulerCounts,
} from "@/lib/im-routine-scheduler.service";
import {
  cronSecretConfigured,
  hasValidCronBearer,
  imRoutineCronFirmDailyCap,
  imRoutineCronEnabled,
  imRoutineCronMaxFirms,
  imRoutineCronMaxInvokes,
} from "@/lib/im-routine-cron-auth";

export type ImRoutineCronResult =
  | { ok: false; error: string; wrote: false }
  | { ok: true; wrote: true; noop?: boolean; periodKey?: string; counts: ImRoutineSchedulerCounts };

export async function runImRoutineCron(request: Request): Promise<ImRoutineCronResult> {
  if (!cronSecretConfigured()) {
    return { ok: false, error: "cron_secret_unconfigured", wrote: false };
  }
  if (!hasValidCronBearer(request)) {
    return { ok: false, error: "unauthorized", wrote: false };
  }
  if (!imRoutineCronEnabled()) {
    return { ok: true, wrote: true, noop: true, counts: emptyImRoutineSchedulerCounts() };
  }

  const maxFirms = imRoutineCronMaxFirms();
  const maxInvokes = imRoutineCronMaxInvokes();
  const firmDailyCap = imRoutineCronFirmDailyCap();
  const firmIds = await listFirmIdsWithAcceptedRoutines(maxFirms);

  const counts = emptyImRoutineSchedulerCounts();
  let invokesLeft = maxInvokes;
  let periodKey: string | undefined;

  for (const firmId of firmIds) {
    if (invokesLeft <= 0) break;
    const result = await runImRoutineSchedulerCore({
      firmId,
      maxInvokes: invokesLeft,
      firmDailyCap,
      counts,
    });
    periodKey = result.periodKey;
    invokesLeft = Math.max(0, maxInvokes - counts.invoked);
  }

  console.info(
    JSON.stringify({
      event: "im_routine_cron",
      firms_scanned: counts.firmsScanned,
      due: counts.due,
      invoked: counts.invoked,
      skipped_idempotent: counts.skipped_idempotent,
      skipped_cap: counts.skipped_cap,
      skipped_stub_signal: counts.skipped_stub_signal,
      skipped_unaccepted: counts.skipped_unaccepted,
    }),
  );

  return { ok: true, wrote: true, periodKey, counts };
}
