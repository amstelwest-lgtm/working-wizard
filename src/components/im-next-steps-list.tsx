import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildImNextSteps,
  imStepStorageKey,
  markStepDone,
  nextUndoneStep,
  parseDoneIds,
  type ImNextStepRow,
} from "@/lib/im-next-steps";

function readDone(key: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return parseDoneIds(localStorage.getItem(key));
  } catch {
    return [];
  }
}

function writeDone(key: string, done: readonly string[]) {
  try {
    localStorage.setItem(key, JSON.stringify({ done }));
  } catch {
    /* private mode */
  }
}

export function ImNextStepsList({
  firmId,
  rows,
  integrationStarted,
  sendAgentAllowed,
  starting,
  onStart,
}: {
  firmId: string;
  rows: readonly ImNextStepRow[];
  integrationStarted: boolean;
  sendAgentAllowed: boolean;
  starting: boolean;
  onStart: () => void;
}) {
  const steps = useMemo(
    () => buildImNextSteps({ rows, integrationStarted, sendAgentAllowed }),
    [rows, integrationStarted, sendAgentAllowed],
  );
  const planKey = steps.map((step) => step.id).join(",");
  const storageKey = imStepStorageKey(firmId, planKey);
  const [done, setDone] = useState<string[]>(() => readDone(storageKey));
  const nextRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    setDone(readDone(storageKey));
  }, [storageKey]);

  const next = nextUndoneStep(steps, done);

  useEffect(() => {
    nextRef.current?.scrollIntoView({ block: "nearest" });
  }, [next?.id, storageKey]);

  if (steps.length === 0) return null;

  const finish = (id: string) => {
    setDone((current) => {
      const nextDone = markStepDone(current, id);
      writeDone(storageKey, nextDone);
      return nextDone;
    });
  };

  return (
    <section
      className="im-card im-next-steps"
      data-im-workflow-steps=""
      aria-label="Your next steps to bring Milōn into your workflow"
    >
      <h2 className="im-card__title">Your next steps to bring Milōn into your workflow</h2>
      <ol>
        {steps.map((step) => {
          const state = done.includes(step.id) ? "done" : step.id === next?.id ? "next" : "later";
          return (
            <li
              key={step.id}
              ref={state === "next" ? nextRef : undefined}
              data-im-step={step.id}
              data-im-step-state={state}
            >
              <p className="im-next-steps__state">{state === "done" ? "Done" : state === "next" ? "Next" : "Later"}</p>
              <p className="im-next-steps__title">{step.title}</p>
              {step.kind === "start" ? (
                <button
                  type="button"
                  className="setup-partner__primary"
                  disabled={starting}
                  onClick={onStart}
                >
                  {starting ? "Starting…" : step.button}
                </button>
              ) : (
                <a className="setup-partner__primary" href={step.href ?? "/clients"} onClick={() => finish(step.id)}>
                  {step.button}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
