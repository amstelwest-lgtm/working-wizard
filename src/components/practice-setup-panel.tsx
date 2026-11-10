import { useState } from "react";
import { Link } from "@tanstack/react-router";
import "./setup-partner-panel.css";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import {
  SETUP_PARTNER_FIXED_QUESTIONS,
  firmSetupPartnerSummary,
  setupPartnerMapPromptBlock,
  type SetupPartnerWorkflowMap,
} from "@/lib/setup-partner";
import { buildSetupPartnerFirmMap, confirmSetupPartnerFirmMap } from "@/lib/setup-partner-client";
import type { PracticeImplementationPlan } from "@/lib/setup-partner-plan";

/** User-facing name. Internal ids stay setup_partner. */
export const IMPLEMENTATION_MANAGER_LABEL = "Implementation Manager";

type Phase = "interview" | "map" | "done";

export function PracticeSetupPanel() {
  const { firmId } = useAccountantProfile();
  const [phase, setPhase] = useState<Phase>("interview");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelTurns, setModelTurns] = useState(0);
  const [map, setMap] = useState<SetupPartnerWorkflowMap | null>(null);
  const [plan, setPlan] = useState<PracticeImplementationPlan | null>(null);

  if (!firmId) {
    return (
      <section
        className="setup-partner"
        data-practice-setup-panel="waiting"
        aria-label={IMPLEMENTATION_MANAGER_LABEL}
      >
        <h2 className="setup-partner__title">{IMPLEMENTATION_MANAGER_LABEL}</h2>
        <p className="setup-partner__lede">Loading your practice.</p>
      </section>
    );
  }

  const question = SETUP_PARTNER_FIXED_QUESTIONS[index];

  const advance = async () => {
    if (!question) return;
    const nextAnswers = { ...answers, [question.id]: draft.trim() };
    setAnswers(nextAnswers);
    const nextIndex = index + 1;
    if (nextIndex < SETUP_PARTNER_FIXED_QUESTIONS.length) {
      const nextId = SETUP_PARTNER_FIXED_QUESTIONS[nextIndex]?.id ?? "";
      setIndex(nextIndex);
      setDraft(nextAnswers[nextId] ?? "");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const built = await buildSetupPartnerFirmMap({
        firmId,
        answers: nextAnswers,
        summary: firmSetupPartnerSummary(),
        modelTurns,
      });
      setModelTurns(built.modelTurns);
      setMap(built.map);
      setPhase("map");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the practice map");
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!map) return;
    setLoading(true);
    setError(null);
    try {
      const saved = await confirmSetupPartnerFirmMap(firmId, map);
      setPlan(saved.plan);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className="setup-partner"
      data-practice-setup-panel=""
      aria-label={IMPLEMENTATION_MANAGER_LABEL}
    >
      <p className="setup-partner__eyebrow">Practice</p>
      <h2 className="setup-partner__title">{IMPLEMENTATION_MANAGER_LABEL}</h2>
      <p className="setup-partner__lede">
        Map how the firm closes, reviews, signs off, and reports. No desktop access.
      </p>

      {phase === "interview" && question ? (
        <div>
          <p className="setup-partner__question">{question.prompt}</p>
          <textarea
            className="setup-partner__answer"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Short answer"
          />
          <div className="setup-partner__actions">
            <button
              type="button"
              className="setup-partner__primary"
              disabled={loading || !draft.trim()}
              onClick={() => void advance()}
            >
              {loading ? "Working…" : "Next"}
            </button>
          </div>
        </div>
      ) : null}

      {phase === "map" && map ? (
        <div className="setup-partner__map">
          <pre className="sr-only">{setupPartnerMapPromptBlock(map)}</pre>
          <h3>Today&apos;s flow</h3>
          <ul>
            {map.todaysFlow.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <h3>Milōn coverage</h3>
          <ul>
            {map.milonCoverage.map((row) => (
              <li key={`${row.agent}-${row.owns}`}>
                {row.agent}: {row.owns}
              </li>
            ))}
          </ul>
          <div className="setup-partner__actions">
            <button
              type="button"
              className="setup-partner__primary"
              disabled={loading}
              onClick={() => void confirm()}
            >
              Confirm workflow map
            </button>
          </div>
        </div>
      ) : null}

      {phase === "done" ? (
        <div>
          <p className="setup-partner__done">Saved for the practice.</p>
          {plan && plan.steps.length > 0 ? (
            <ul>
              {plan.steps.map((step) => (
                <li key={`${step.dedupe_key}-${step.step}`}>
                  {step.step} — {step.bucket}
                </li>
              ))}
            </ul>
          ) : null}
          <Link to="/practice">Back to practice</Link>
        </div>
      ) : null}

      {error ? (
        <p className="setup-partner__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
