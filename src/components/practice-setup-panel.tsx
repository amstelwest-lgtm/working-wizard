import { createElement, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import "./setup-partner-panel.css";
import { OwnerAvatar } from "@/components/owner-door/owner-avatar";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { parseMarketSelection } from "@/lib/market/parse";
import {
  SETUP_PARTNER_FIXED_QUESTIONS,
  firmSetupPartnerSummary,
  setupPartnerMapPromptBlock,
  withMarketCoverage,
  type SetupPartnerWorkflowMap,
} from "@/lib/setup-partner";
import {
  buildSetupPartnerFirmMap,
  confirmSetupPartnerFirmMap,
  fetchFirmSetupPlan,
} from "@/lib/setup-partner-client";
import {
  dedupePracticeSteps,
  practiceBucketLabel,
  type PracticeImplementationPlan,
} from "@/lib/setup-partner-plan";

/** User-facing name. Internal ids stay setup_partner. */
export const IMPLEMENTATION_MANAGER_LABEL = "Implementation Manager";

/** This route's Toaster. App chrome also mounts one; this id keeps a single toast. */
export const PRACTICE_SETUP_TOASTER_ID = "practice-setup";

type Phase = "interview" | "map" | "done";

type BuildMap = typeof buildSetupPartnerFirmMap;
type ConfirmMap = typeof confirmSetupPartnerFirmMap;
type LoadSaved = (firmId: string) => Promise<PracticeImplementationPlan | null>;

export function PracticeSetupPanel() {
  const { firmId, firmMarket } = useAccountantProfile();
  return <PracticeSetupInterview firmId={firmId} firmMarket={firmMarket} />;
}

export function PracticeSetupInterview({
  firmId,
  firmMarket,
  buildMap = buildSetupPartnerFirmMap,
  confirmMap = confirmSetupPartnerFirmMap,
  loadSaved = fetchFirmSetupPlan,
}: {
  firmId: string | null;
  firmMarket: unknown;
  buildMap?: BuildMap;
  confirmMap?: ConfirmMap;
  loadSaved?: LoadSaved;
}) {
  const [phase, setPhase] = useState<Phase>("interview");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [booting, setBooting] = useState(Boolean(firmId));
  const [error, setError] = useState<string | null>(null);
  const [modelTurns, setModelTurns] = useState(0);
  const [map, setMap] = useState<SetupPartnerWorkflowMap | null>(null);
  const [plan, setPlan] = useState<PracticeImplementationPlan | null>(null);
  const country = parseMarketSelection(firmMarket)?.country ?? null;
  const visibleMap = map ? withMarketCoverage(map, country) : null;

  useEffect(() => {
    if (!firmId) return;
    let cancel = false;
    setBooting(true);
    void loadSaved(firmId)
      .then((saved) => {
        if (cancel || !saved || saved.steps.length === 0) return;
        setPlan({ steps: dedupePracticeSteps(saved.steps) });
        setPhase("done");
      })
      .catch(() => {
        // A missed read still opens the interview.
      })
      .finally(() => {
        if (!cancel) setBooting(false);
      });
    return () => {
      cancel = true;
    };
  }, [firmId, loadSaved]);

  const redo = () => {
    setPhase("interview");
    setIndex(0);
    setAnswers({});
    setDraft("");
    setMap(null);
    setPlan(null);
    setError(null);
    setModelTurns(0);
  };

  if (!firmId) {
    return (
      <section
        className="setup-partner"
        data-practice-setup-panel="waiting"
        aria-label={IMPLEMENTATION_MANAGER_LABEL}
      >
        <PracticeSetupHead />
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
      const built = await buildMap({
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
    if (!visibleMap || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await confirmMap(firmId, visibleMap);
      setPlan(saved.plan ? { steps: dedupePracticeSteps(saved.plan.steps) } : null);
      setPhase("done");
      toast.success(setupToast("Saved for the practice.", "status"), {
        toasterId: PRACTICE_SETUP_TOASTER_ID,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Confirm failed";
      setError(message);
      toast.error(setupToast(message, "alert"), { toasterId: PRACTICE_SETUP_TOASTER_ID });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="setup-partner"
      data-practice-setup-panel=""
      data-practice-setup-phase={booting ? "loading" : phase}
      aria-label={IMPLEMENTATION_MANAGER_LABEL}
    >
      <PracticeSetupHead />
      <p className="setup-partner__lede">
        Map how the firm closes, reviews, signs off, and reports. No desktop access.
      </p>

      {booting ? <p className="setup-partner__lede">Loading your practice.</p> : null}

      {!booting && phase === "interview" && question ? (
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

      {!booting && phase === "map" && visibleMap ? (
        <div className="setup-partner__map">
          <pre className="sr-only">{setupPartnerMapPromptBlock(visibleMap)}</pre>
          <h3>Today&apos;s flow</h3>
          <ul>
            {visibleMap.todaysFlow.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <h3>Milōn coverage</h3>
          <ul>
            {visibleMap.milonCoverage.map((row) => (
              <li key={`${row.agent}-${row.owns}`}>
                {row.agent}: {row.owns}
              </li>
            ))}
          </ul>
          <div className="setup-partner__actions">
            <button
              type="button"
              className="setup-partner__primary"
              disabled={saving}
              onClick={() => void confirm()}
            >
              {saving ? "Saving…" : "Confirm workflow map"}
            </button>
          </div>
        </div>
      ) : null}

      {!booting && phase === "done" ? (
        <div>
          <p className="setup-partner__done">Saved for the practice.</p>
          {plan && plan.steps.length > 0 ? (
            <ul>
              {plan.steps.map((step) => (
                <li key={`${step.dedupe_key}-${step.step}`}>
                  {step.step} — {practiceBucketLabel(step.bucket)}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="setup-partner__actions">
            <button type="button" className="setup-partner__ghost" onClick={redo}>
              Redo interview
            </button>
            <Link to="/practice">Back to practice</Link>
          </div>
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

function setupToast(message: string, role: "status" | "alert") {
  return createElement("span", { role }, message);
}

function PracticeSetupHead() {
  return (
    <div className="setup-partner__head">
      <OwnerAvatar
        agent="setup_partner"
        variant="character"
        size="sm"
        motion="idle"
        label={IMPLEMENTATION_MANAGER_LABEL}
      />
      <div className="setup-partner__head-text">
        <p className="setup-partner__eyebrow">Practice</p>
        <h2 className="setup-partner__title">{IMPLEMENTATION_MANAGER_LABEL}</h2>
      </div>
    </div>
  );
}
