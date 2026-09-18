/**
 * Next Step card (P0.4) — the first thing on the client home, above health.
 *
 * Fetches `getNextStep` for a client and renders one CTA. The host decides
 * what the CTA does (`onAct`): switch a tab, open the upload / profile
 * dialog, etc. — the card never navigates on its own so both surfaces
 * (owner board `/app`, accountant studio `/clients/:id`) can reuse it.
 *
 * For the `diagnosis` step the card also offers "Mark as reviewed", which
 * is the only advisory event the app records directly (`diagnosis.reviewed`,
 * allowlisted in `advisory_record_event`). Everything else advances through
 * DB triggers when the user does the actual work.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useTrack } from "@/hooks/use-track";
import { appendAdvisoryEvent } from "@/lib/advisory-state.functions";
import { getNextStep } from "@/lib/next-step.functions";
import {
  outstandingChips,
  urgencyLabel,
  type NextStep,
  type NextStepAudience,
  type NextStepTarget,
} from "@/lib/next-step";

type Props = {
  clientId: string | null;
  audience: NextStepAudience;
  /** Host performs the CTA (tab switch, open dialog). Receives the resolved step. */
  onAct: (step: NextStep, target?: NextStepTarget) => void;
  /** Change to refetch (e.g. after an upload or a tab switch). */
  refreshKey?: string | number;
  className?: string;
  /** Surface name for analytics. */
  surface: "owner_app" | "accountant_portal";
};

export function NextStepCard({ clientId, audience, onAct, refreshKey, className, surface }: Props) {
  const fetchNextStep = useServerFn(getNextStep);
  const recordEvent = useServerFn(appendAdvisoryEvent);
  const track = useTrack();
  const [step, setStep] = useState<NextStep | null>(null);
  const [derived, setDerived] = useState(false);
  const [loading, setLoading] = useState(Boolean(clientId));
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!clientId) return;
    const mine = ++seq.current;
    setError(null);
    try {
      const res = await fetchNextStep({ data: { clientId, audience } });
      if (mine !== seq.current) return;
      setStep(res.nextStep);
      setDerived(res.facts.stateSource === "derived");
    } catch (err: unknown) {
      if (mine !== seq.current) return;
      setError(err instanceof Error ? err.message : "Could not work out the next step.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [clientId, audience, fetchNextStep]);

  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    setLoading((prev) => prev || step === null);
    void load();
    // refreshKey is intentionally a dependency: hosts bump it after writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, audience, refreshKey, load]);

  // Coming back to the tab after doing work elsewhere (email link, upload in
  // another window) should show the new step without a manual reload.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const lastTracked = useRef<string | null>(null);
  useEffect(() => {
    if (!step || !clientId) return;
    const sig = `${clientId}:${step.key}:${step.state}`;
    if (lastTracked.current === sig) return;
    lastTracked.current = sig;
    track("next_step_viewed", {
      surface,
      clientId,
      key: step.key,
      state: step.state,
      urgency: step.urgency,
      audience,
    });
  }, [step, clientId, surface, audience, track]);

  const act = (target?: NextStepTarget) => {
    if (!step || !clientId) return;
    track("next_step_cta_clicked", {
      surface,
      clientId,
      key: step.key,
      target: target ?? step.key,
      state: step.state,
      audience,
    });
    onAct(step, target);
  };

  const markDiagnosisReviewed = async () => {
    if (!clientId || marking) return;
    setMarking(true);
    try {
      const res = await recordEvent({
        data: { clientId, event: "diagnosis.reviewed", payload: { surface } },
      });
      if (res.ok) {
        toast.success("Diagnosis marked as reviewed");
        await load();
      } else {
        toast.message("Advisory tracking isn't enabled on this workspace yet.");
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not record that.");
    } finally {
      setMarking(false);
    }
  };

  if (!clientId) return null;

  const rootClass = ["milon-next-step", className].filter(Boolean).join(" ");

  if (loading && !step) {
    return (
      <section className={rootClass} data-urgency="loading" aria-busy="true">
        <div className="milon-next-step__head">
          <span className="milon-next-step__kicker">Next step</span>
        </div>
        <p className="milon-next-step__title milon-next-step__title--skeleton" />
        <p className="milon-next-step__reason milon-next-step__reason--skeleton" />
      </section>
    );
  }

  if (error && !step) {
    return (
      <section className={rootClass} data-urgency="error">
        <div className="milon-next-step__head">
          <span className="milon-next-step__kicker">Next step</span>
        </div>
        <p className="milon-next-step__title">Couldn't work out the next step</p>
        <p className="milon-next-step__reason">{error}</p>
        <div className="milon-next-step__actions">
          <button type="button" className="milon-next-step__secondary" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      </section>
    );
  }

  if (!step) return null;

  const chips = outstandingChips(step.outstanding, audience);

  return (
    <section
      className={rootClass}
      data-urgency={step.urgency}
      data-step={step.key}
      aria-live="polite"
      id="next-step"
    >
      <div className="milon-next-step__head">
        <span className="milon-next-step__kicker">
          Next step <span aria-hidden>·</span> {step.stateLabel}
        </span>
        <span className="milon-next-step__pill">{urgencyLabel(step.urgency)}</span>
      </div>
      <h3 className="milon-next-step__title">{step.title}</h3>
      <p className="milon-next-step__reason">{step.reason}</p>
      <div className="milon-next-step__actions">
        <button
          type="button"
          className="milon-next-step__cta"
          onClick={() => act()}
          data-next-step-cta={step.key}
        >
          {step.cta.label} <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
        {step.key === "diagnosis" ? (
          <button
            type="button"
            className="milon-next-step__secondary"
            disabled={marking}
            onClick={() => void markDiagnosisReviewed()}
          >
            {marking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden />
            )}
            Mark as reviewed
          </button>
        ) : null}
        {loading ? (
          <Loader2 className="milon-next-step__spinner h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : null}
      </div>
      {chips.length > 0 ? (
        <ul className="milon-next-step__chips" aria-label="Outstanding">
          {chips.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                className="milon-next-step__chip"
                data-chip={c.key}
                onClick={() => act(c.target)}
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {derived && audience === "accountant" ? (
        <p className="milon-next-step__foot">
          Advisory tracking isn't switched on for this workspace yet; this step is inferred from
          existing data.
        </p>
      ) : null}
    </section>
  );
}
