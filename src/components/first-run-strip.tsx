/**
 * First run: three steps above the jobs board until the firm has approved
 * one draft. The firm is led to an outcome, not to a page.
 */
import { Link } from "@tanstack/react-router";
import { FIRST_RUN_STEPS, firstRunProgress, type FirstRunStep } from "@/lib/milon-jobs";

export function FirstRunStrip({
  step,
  pilotClientId,
  runningLine,
}: {
  step: FirstRunStep;
  /** The first client with figures, for the connect and first-draft links. */
  pilotClientId: string | null;
  /** What the activation runs are doing right now, when known. */
  runningLine: string | null;
}) {
  if (step === "done") return null;
  const progress = firstRunProgress(step);
  return (
    <section
      className="flex flex-col gap-4 rounded-2xl border border-[var(--milon-cobalt)] bg-[color-mix(in_srgb,var(--milon-cobalt)_6%,var(--milon-bg))] p-5"
      data-first-run-strip={step}
      aria-labelledby="first-run-title"
    >
      <header className="flex items-baseline justify-between gap-3">
        <h2 id="first-run-title" className="m-0 text-[16px] font-bold text-[var(--milon-ink)]">
          Start here
        </h2>
        <span className="text-[12px] text-[var(--milon-ink-muted)]">
          Step {Math.min(progress.index + 1, progress.of)} of {progress.of}
        </span>
      </header>
      <ol className="m-0 grid list-none gap-3 p-0 md:grid-cols-3">
        {FIRST_RUN_STEPS.map((item, index) => {
          const state =
            index < progress.index ? "done" : index === progress.index ? "current" : "next";
          return (
            <li
              key={item.id}
              data-step={state}
              aria-current={state === "current" ? "step" : undefined}
              className={
                "flex flex-col gap-1 rounded-xl p-3 " +
                (state === "current"
                  ? "bg-[var(--milon-bg)] shadow-sm ring-1 ring-[var(--milon-cobalt)]"
                  : "opacity-80")
              }
            >
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--milon-ink-muted)]">
                {state === "done" ? "Done" : `Step ${index + 1}`}
              </span>
              <span className="text-[14px] font-semibold leading-snug text-[var(--milon-ink)]">
                {item.title}
              </span>
              <span className="text-[13px] leading-snug text-[var(--milon-ink-muted)]">
                {item.id === "first_draft" && state === "current" && runningLine
                  ? runningLine
                  : item.detail}
              </span>
              {state === "current" ? (
                <StepAction step={item.id} pilotClientId={pilotClientId} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StepAction({
  step,
  pilotClientId,
}: {
  step: Exclude<FirstRunStep, "done">;
  pilotClientId: string | null;
}) {
  const cls =
    "mt-2 inline-flex w-fit items-center rounded-full bg-[var(--milon-cobalt)] px-4 py-1.5 text-[13px] font-semibold text-white no-underline hover:opacity-90";
  if (step === "interview") {
    return (
      <Link to="/practice/setup" className={cls} data-first-run-action="interview">
        Open the Implementation Manager
      </Link>
    );
  }
  if (step === "connect") {
    return (
      <Link to="/clients" hash="wizard-add-client" className={cls} data-first-run-action="connect">
        Add your first client
      </Link>
    );
  }
  if (pilotClientId) {
    return (
      <Link
        to="/clients/$clientId"
        params={{ clientId: pilotClientId }}
        className={cls}
        data-first-run-action="first_draft"
      >
        Open the client file
      </Link>
    );
  }
  return (
    <Link to="/practice/setup" className={cls} data-first-run-action="first_draft">
      See what is running
    </Link>
  );
}
