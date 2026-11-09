import { useCallback, useEffect, useMemo, useState } from "react";
import "./setup-partner-panel.css";
import {
  SETUP_PARTNER_DISPLAY_NAME,
  SETUP_PARTNER_FIXED_QUESTIONS,
  SETUP_PARTNER_FOLLOWUP_TEMPLATES,
  setupPartnerFollowups,
  setupPartnerMapPromptBlock,
  type SetupPartnerSummary,
  type SetupPartnerWorkflowMap,
} from "@/lib/setup-partner";
import {
  buildSetupPartnerMap,
  confirmSetupPartnerMap,
  fetchSetupPartnerSummary,
  phraseSetupPartnerFollowup,
} from "@/lib/setup-partner-client";

type Phase = "summary" | "interview" | "map" | "done";

type Props = {
  clientId: string | null;
};

export function SetupPartnerPanel({ clientId }: Props) {
  const [phase, setPhase] = useState<Phase>("summary");
  const [summary, setSummary] = useState<SetupPartnerSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [followupIndex, setFollowupIndex] = useState(0);
  const [inFollowups, setInFollowups] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draftAnswer, setDraftAnswer] = useState("");
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [modelTurns, setModelTurns] = useState(0);
  const [map, setMap] = useState<SetupPartnerWorkflowMap | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const followups = useMemo(() => (summary ? setupPartnerFollowups(summary) : []), [summary]);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchSetupPartnerSummary(clientId);
      setSummary(next);
      setPhase("summary");
      setQuestionIndex(0);
      setFollowupIndex(0);
      setInFollowups(false);
      setAnswers({});
      setMap(null);
      setConfirmed(false);
      setModelTurns(0);
      setCurrentQuestion(SETUP_PARTNER_FIXED_QUESTIONS[0]?.prompt ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load summary");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveAnswer = (id: string, text: string) => {
    setAnswers((prev) => ({ ...prev, [id]: text.trim() }));
  };

  const startInterview = () => {
    setPhase("interview");
    setQuestionIndex(0);
    setInFollowups(false);
    setDraftAnswer("");
    setCurrentQuestion(SETUP_PARTNER_FIXED_QUESTIONS[0]?.prompt ?? "");
  };

  const advanceInterview = async () => {
    if (!clientId || !summary) return;
    const fixed = SETUP_PARTNER_FIXED_QUESTIONS[questionIndex];
    if (fixed) {
      saveAnswer(fixed.id, draftAnswer);
      const nextIndex = questionIndex + 1;
      if (nextIndex < SETUP_PARTNER_FIXED_QUESTIONS.length) {
        setQuestionIndex(nextIndex);
        setDraftAnswer(answers[SETUP_PARTNER_FIXED_QUESTIONS[nextIndex]?.id ?? ""] ?? "");
        setCurrentQuestion(SETUP_PARTNER_FIXED_QUESTIONS[nextIndex]?.prompt ?? "");
        return;
      }
    }
    if (!inFollowups && followups.length > 0) {
      setInFollowups(true);
      setFollowupIndex(0);
      const template = followups[0] ?? "";
      setLoading(true);
      setError(null);
      try {
        const phrased = await phraseSetupPartnerFollowup(clientId, template, modelTurns);
        setModelTurns(phrased.modelTurns);
        setCurrentQuestion(phrased.question);
        setDraftAnswer("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Follow-up failed");
        setCurrentQuestion(template);
      } finally {
        setLoading(false);
      }
      return;
    }
    if (inFollowups) {
      const template = followups[followupIndex];
      const id = SETUP_PARTNER_FOLLOWUP_TEMPLATES[followupIndex]?.id ?? `followup_${followupIndex}`;
      saveAnswer(id, draftAnswer);
      const nextFu = followupIndex + 1;
      if (nextFu < followups.length) {
        setFollowupIndex(nextFu);
        setLoading(true);
        try {
          const phrased = await phraseSetupPartnerFollowup(clientId, followups[nextFu] ?? "", modelTurns);
          setModelTurns(phrased.modelTurns);
          setCurrentQuestion(phrased.question);
          setDraftAnswer("");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Follow-up failed");
          setCurrentQuestion(followups[nextFu] ?? "");
        } finally {
          setLoading(false);
        }
        return;
      }
    }
    await buildMap();
  };

  const buildMap = async () => {
    if (!clientId || !summary) return;
    setLoading(true);
    setError(null);
    try {
      const built = await buildSetupPartnerMap(clientId, answers, summary, modelTurns);
      setModelTurns(built.modelTurns);
      setMap(built.map);
      setPhase("map");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build workflow map");
    } finally {
      setLoading(false);
    }
  };

  const confirmMap = async () => {
    if (!clientId || !map) return;
    setLoading(true);
    setError(null);
    try {
      await confirmSetupPartnerMap(clientId, map);
      setConfirmed(true);
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setLoading(false);
    }
  };

  if (!clientId) {
    return (
      <section className="setup-partner" data-setup-partner="empty" aria-label={SETUP_PARTNER_DISPLAY_NAME}>
        <p className="setup-partner__lede">Select a client to run Setup Partner.</p>
      </section>
    );
  }

  const phases: { id: Phase; label: string }[] = [
    { id: "summary", label: "Data summary" },
    { id: "interview", label: "Interview" },
    { id: "map", label: "Workflow map" },
    { id: "done", label: "Confirmed" },
  ];

  return (
    <section className="setup-partner" data-setup-partner="" aria-label={SETUP_PARTNER_DISPLAY_NAME}>
      <p className="setup-partner__eyebrow">Onboarding</p>
      <h2 className="setup-partner__title">{SETUP_PARTNER_DISPLAY_NAME}</h2>
      <p className="setup-partner__lede">
        Learn how finance runs today, map Milōn agents to each step, and save confirmed workflow rules. No ledger
        writes.
      </p>
      <ul className="setup-partner__nav" aria-label="Setup steps">
        {phases.map((row) => (
          <li key={row.id}>
            <button type="button" data-active={phase === row.id} disabled>
              {row.label}
            </button>
          </li>
        ))}
      </ul>

      {phase === "summary" && summary ? (
        <div className="setup-partner__summary">
          <p className="setup-partner__question">{summary.headline}</p>
          <ul>
            {summary.bullets.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="setup-partner__actions">
            <button type="button" className="setup-partner__primary" disabled={loading} onClick={startInterview}>
              Start interview
            </button>
            <button type="button" className="setup-partner__ghost" disabled={loading} onClick={() => void load()}>
              Refresh summary
            </button>
          </div>
        </div>
      ) : null}

      {phase === "interview" ? (
        <div>
          <p className="setup-partner__question">{currentQuestion}</p>
          <textarea
            className="setup-partner__answer"
            value={draftAnswer}
            onChange={(e) => setDraftAnswer(e.target.value)}
            placeholder="Short answer"
          />
          <div className="setup-partner__actions">
            <button
              type="button"
              className="setup-partner__primary"
              disabled={loading || !draftAnswer.trim()}
              onClick={() => void advanceInterview()}
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
          <h3>Gaps</h3>
          <ul>
            {map.gaps.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <h3>Setup checklist</h3>
          <ul>
            {map.checklist.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="setup-partner__actions">
            <button type="button" className="setup-partner__primary" disabled={loading} onClick={() => void confirmMap()}>
              Confirm workflow map
            </button>
          </div>
        </div>
      ) : null}

      {phase === "done" ? (
        <p className="setup-partner__done">
          {confirmed
            ? "Workflow saved as private brain rules for this client. Re-confirm any time to replace prior onboarding rows."
            : "Done."}
        </p>
      ) : null}

      {error ? (
        <p className="setup-partner__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
