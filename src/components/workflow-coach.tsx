/**
 * Sticky reading-path coach for the accountant client shell.
 * Light surface, dark text — readable in light mode and on the dark portal.
 */
import {
  COACH_STEPS,
  coachView,
  type CoachDestination,
  type CoachDone,
  type CoachPage,
} from "@/lib/workflow-coach";

type Props = {
  /** Null on Overview / Client Brain — the spine stays visible, no step is current. */
  page: CoachPage | null;
  intent?: string | null;
  why?: string | null;
  done?: CoachDone;
  onOpen: (dest: CoachDestination) => void;
};

export function WorkflowCoachStrip(props: Props) {
  const view = coachView(props);
  return (
    <nav className="workflow-coach" aria-label="Reading path" data-workflow-coach="">
      <span className="workflow-coach__kicker">Reading path</span>
      <ol className="workflow-coach__steps">
        {COACH_STEPS.map((step) => {
          const current = view.currentId === step.id;
          const done = Boolean(props.done?.[step.id]);
          return (
            <li key={step.id}>
              <button
                type="button"
                className="workflow-coach__step"
                data-coach-step={step.id}
                data-current={current ? "true" : undefined}
                data-done={done ? "true" : undefined}
                aria-current={current ? "step" : undefined}
                onClick={() =>
                  props.onOpen({ tab: step.tab, ...("focus" in step ? { focus: step.focus } : {}) })
                }
              >
                {done && !current ? <span aria-hidden="true">✓ </span> : null}
                {step.label}
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="workflow-coach__go"
        data-coach-continue=""
        onClick={() => props.onOpen(view.destination)}
      >
        {view.cta}
      </button>
    </nav>
  );
}

export function WorkflowArrival(props: Props) {
  const view = coachView(props);
  return (
    <div className="workflow-arrival" data-coach-arrival="" data-coach-page={props.page}>
      <p className="workflow-arrival__line">
        <span data-coach-because="">You&apos;re here because {view.because}.</span>{" "}
        <span data-coach-next="">Next: {view.nextCue}.</span>
      </p>
      <button
        type="button"
        className="workflow-coach__go"
        data-coach-continue=""
        onClick={() => props.onOpen(view.destination)}
      >
        {view.cta}
      </button>
    </div>
  );
}
