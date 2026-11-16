import { createElement, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import "./setup-partner-panel.css";
import "@/components/owner-door/owner-door.css";
import { HomeBotCard } from "@/components/owner-door/home-bot-card";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { parseMarketSelection } from "@/lib/market/parse";
import {
  firmInterviewTranscript,
  firmSetupPartnerSummary,
  firmInterviewUserError,
  questionAsWritten,
  withMarketCoverage,
  type FirmInterviewMessage,
  type SetupPartnerCountry,
  type SetupPartnerWorkflowMap,
} from "@/lib/setup-partner";
import type { FirmInterviewDraft } from "@/lib/firm-interview-draft";
import {
  buildSetupPartnerFirmMap,
  confirmSetupPartnerFirmMap,
  fetchFirmInterviewDraft,
  fetchFirmSetupPlan,
  firmInterviewTurn,
} from "@/lib/setup-partner-client";
import { ImplementationManagerChip } from "@/components/practice-setup-card";
import { InterviewExchange, PastInterviews } from "@/components/interview-exchange";
import { discardPracticeRedo } from "@/lib/discard-practice-redo.functions";
import {
  buildPracticeImplementationPlan,
  cleanFlowLine,
  dedupePracticeSteps,
  type PracticeImplementationPlan,
} from "@/lib/setup-partner-plan";

/** User-facing name. Internal ids stay setup_partner. */
export const IMPLEMENTATION_MANAGER_LABEL = "Implementation Manager";

/** This route's Toaster. App chrome also mounts one; this id keeps a single toast. */
export const PRACTICE_SETUP_TOASTER_ID = "practice-setup";

/** The interview call gives up after this and shows Retry. */
export const PRACTICE_SETUP_INTERVIEW_MS = 10_000;

/** Shown when the signed-in account has no firm. Never the loading sentence. */
export const PRACTICE_SETUP_NO_FIRM =
  "This account doesn't have a practice yet. Open setup once a practice is on the account.";

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("interview-timeout")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

type Phase = "interview" | "map" | "done";

type BuildMap = typeof buildSetupPartnerFirmMap;
type ConfirmMap = typeof confirmSetupPartnerFirmMap;
type LoadSaved = (firmId: string) => Promise<PracticeImplementationPlan | null>;
type LoadDraft = (firmId: string) => Promise<FirmInterviewDraft | null>;
type AskTurn = (input: {
  firmId: string;
  messages: FirmInterviewMessage[];
  modelTurns: number;
}) => Promise<{ question: string; done: boolean; modelTurns: number }>;
type DiscardRedo = (firmId: string) => Promise<void>;

export function PracticeSetupPanel() {
  const { firmId, firmMarket, refreshFirms, firmsLoaded, firmsLoadFailed } = useAccountantProfile();
  return (
    <PracticeSetupInterview
      key={firmId ?? "no-firm"}
      firmId={firmId}
      firmMarket={firmMarket}
      firmsReady={firmsLoaded || firmsLoadFailed}
      onRefreshFirms={() => void refreshFirms()}
    />
  );
}

export function PracticeSetupInterview({
  firmId,
  firmMarket,
  firmsReady = false,
  onRefreshFirms,
  buildMap = buildSetupPartnerFirmMap,
  confirmMap = confirmSetupPartnerFirmMap,
  loadSaved = fetchFirmSetupPlan,
  loadDraft = fetchFirmInterviewDraft,
  askTurn = firmInterviewTurn,
  discardRedo,
}: {
  firmId: string | null;
  firmMarket: unknown;
  /** True once the firm read has settled, including a confirmed empty list. */
  firmsReady?: boolean;
  onRefreshFirms?: () => void;
  buildMap?: BuildMap;
  confirmMap?: ConfirmMap;
  loadSaved?: LoadSaved;
  loadDraft?: LoadDraft;
  askTurn?: AskTurn;
  discardRedo?: DiscardRedo;
}) {
  const [phase, setPhase] = useState<Phase>("interview");
  const [messages, setMessages] = useState<FirmInterviewMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [booting, setBooting] = useState(Boolean(firmId));
  const [error, setError] = useState<string | null>(null);
  const [turnError, setTurnError] = useState<string | null>(null);
  const [modelTurns, setModelTurns] = useState(0);
  const [map, setMap] = useState<SetupPartnerWorkflowMap | null>(null);
  const [plan, setPlan] = useState<PracticeImplementationPlan | null>(null);
  const [redoOpen, setRedoOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [noFirmWaited, setNoFirmWaited] = useState(false);
  const [recordedAt, setRecordedAt] = useState<string | null>(null);
  const discardSavedRedo = useServerFn(discardPracticeRedo);
  const country = parseMarketSelection(firmMarket)?.country ?? null;
  const marketCountry: SetupPartnerCountry | null =
    country === "US" || country === "ZA" ? country : null;
  const visibleMap = map ? withMarketCoverage(map, marketCountry) : null;
  const preview = visibleMap ? buildPracticeImplementationPlan(visibleMap) : null;

  const mapFrom = async (history: FirmInterviewMessage[], turns: number) => {
    if (!firmId) return;
    setLoading(true);
    setError(null);
    setTurnError(null);
    try {
      const built = await buildMap({
        firmId,
        answers: { transcript: firmInterviewTranscript(history) },
        summary: firmSetupPartnerSummary(),
        modelTurns: turns,
      });
      setModelTurns(built.modelTurns);
      const nextMap = built.map;
      setMap({
        ...nextMap,
        todaysFlow: nextMap.todaysFlow.filter((line) => !line.includes("{") && !line.includes("`")),
        checklist: nextMap.checklist.filter((line) => !line.includes("{") && !line.includes("`")),
      });
      if (!redoOpen) setPhase("map");
    } catch (err) {
      setError(
        firmInterviewUserError(
          err instanceof Error ? err.message : "Could not build the practice map",
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const requestTurn = async (history: FirmInterviewMessage[], turns: number) => {
    if (!firmId) return;
    setLoading(true);
    setTurnError(null);
    try {
      const next = await withDeadline(
        askTurn({ firmId, messages: history, modelTurns: turns }),
        PRACTICE_SETUP_INTERVIEW_MS,
      );
      setModelTurns(next.modelTurns);
      if (next.done) {
        await mapFrom(history, next.modelTurns);
        return;
      }
      const asked = questionAsWritten(next.question);
      if (!asked) {
        setTurnError("No question came back. Retry.");
        return;
      }
      setMessages([...history, { role: "assistant", content: asked }]);
      setQuestion(asked);
    } catch (err) {
      const message = err instanceof Error ? err.message : "The interview failed. Retry.";
      setTurnError(
        message === "interview-timeout"
          ? "The interview didn't answer in time."
          : firmInterviewUserError(message),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (firmId || firmsReady) return;
    const timer = window.setTimeout(() => setNoFirmWaited(true), PRACTICE_SETUP_INTERVIEW_MS);
    return () => window.clearTimeout(timer);
  }, [firmId, firmsReady]);

  useEffect(() => {
    if (!firmId) {
      setMessages([]);
      setQuestion("");
      setDraft("");
      return;
    }
    let cancel = false;
    setMessages([]);
    setQuestion("");
    setDraft("");
    setBooting(true);
    const bootTimer = window.setTimeout(() => {
      if (cancel) return;
      cancel = true;
      setTurnError("The interview didn't answer in time.");
      setBooting(false);
    }, PRACTICE_SETUP_INTERVIEW_MS);
    void Promise.all([loadSaved(firmId), loadDraft(firmId)])
      .then(([saved, draft]) => {
        if (cancel) return;
        const hasPlan = Boolean(saved && saved.steps.length > 0);
        if (hasPlan && saved) {
          setPlan({ steps: dedupePracticeSteps(saved.steps) });
          setPhase("done");
        }
        if (draft?.question) {
          setMessages(draft.messages);
          setQuestion(draft.question);
          setModelTurns(draft.modelTurns);
          const stamped = draft as FirmInterviewDraft & { recordedAt?: string | null };
          if (stamped.recordedAt) setRecordedAt(stamped.recordedAt);
          if (hasPlan) setRedoOpen(true);
          else setPhase("interview");
          return;
        }
        if (hasPlan) return;
        return requestTurn([], 0);
      })
      .catch(() => {
        if (!cancel) setTurnError("The interview failed. Retry.");
      })
      .finally(() => {
        window.clearTimeout(bootTimer);
        if (!cancel) setBooting(false);
      });
    return () => {
      cancel = true;
      window.clearTimeout(bootTimer);
    };
    // The first question loads with the firm. Later turns are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmId, loadSaved, loadDraft]);

  const redo = () => {
    setMessages([]);
    setQuestion("");
    setDraft("");
    setMap(null);
    setError(null);
    setTurnError(null);
    setModelTurns(0);
    if (plan && plan.steps.length > 0) setRedoOpen(true);
    else setPhase("interview");
    void requestTurn([], 0);
  };

  const discardRedoDraft = async () => {
    if (!firmId || discarding) return;
    setDiscarding(true);
    setError(null);
    try {
      if (discardRedo) await discardRedo(firmId);
      else await discardSavedRedo({ data: { firmId } });
      setRedoOpen(false);
      setMessages([]);
      setQuestion("");
      setDraft("");
      setMap(null);
      setTurnError(null);
      setModelTurns(0);
      setRecordedAt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not discard the redo");
    } finally {
      setDiscarding(false);
    }
  };

  if (!firmId && !firmsReady && !noFirmWaited) {
    return (
      <section
        className="setup-partner"
        data-practice-setup-panel="firm-pending"
        aria-busy="true"
        aria-label={IMPLEMENTATION_MANAGER_LABEL}
        style={{ minHeight: 160 }}
      />
    );
  }

  if (!firmId) {
    return (
      <section
        className="setup-partner"
        data-practice-setup-panel="no-firm"
        aria-label={IMPLEMENTATION_MANAGER_LABEL}
      >
        <PracticeSetupHero status="Not started" />
        <p className="setup-partner__lede" data-practice-setup-phase="no-firm">
          {PRACTICE_SETUP_NO_FIRM}
        </p>
        <div className="setup-partner__actions">
          <Link to="/auth/callback" className="setup-partner__primary">
            Open setup
          </Link>
          <button type="button" className="setup-partner__ghost" data-practice-setup-retry="" onClick={() => onRefreshFirms?.()}>
            Retry
          </button>
        </div>
      </section>
    );
  }

  const advance = async () => {
    const text = draft.trim();
    if (!text || !question) return;
    const history: FirmInterviewMessage[] = [...messages, { role: "user", content: text }];
    setMessages(history);
    setDraft("");
    await requestTurn(history, modelTurns);
  };

  const confirm = async () => {
    if (!visibleMap || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await confirmMap(firmId, visibleMap);
      setPlan(saved.plan ? { steps: dedupePracticeSteps(saved.plan.steps) } : null);
      setRedoOpen(false);
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

  const showInterview = !booting && !visibleMap && (phase === "interview" || redoOpen);
  const flowLines = visibleMap ? visibleMap.todaysFlow.map(cleanFlowLine).filter(Boolean) : [];
  const checklist = visibleMap ? visibleMap.checklist.map(cleanFlowLine).filter(Boolean) : [];
  const stepLines = [...(preview?.steps ?? []), ...(plan?.steps ?? [])]
    .filter((step) => step.bucket === "client_setup" || step.bucket === "covered")
    .map((step) => step.step);
  const nextLines = [...new Set([...flowLines, ...checklist, ...stepLines])];

  return (
    <section
      className="setup-partner im-flow"
      data-practice-setup-panel=""
      data-practice-setup-phase={booting ? "loading" : phase}
      data-im-page=""
      aria-label={IMPLEMENTATION_MANAGER_LABEL}
    >
      <PracticeSetupHero status={heroStatus(phase, booting)} />

      {booting ? <p className="setup-partner__lede">Loading your practice.</p> : null}

      {showInterview ? (
        <div data-im-interview="">
          <InterviewExchange question={question} thinking={loading} />
          <textarea
            className="setup-partner__answer"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Walk through it"
          />
          {turnError ? (
            <p className="setup-partner__error" role="alert">
              {turnError}
            </p>
          ) : null}
        </div>
      ) : null}

      {!booting ? (
        <div className="setup-partner__actions" data-im-actions="">
          {showInterview ? (
            <>
              <button
                type="button"
                className="setup-partner__primary"
                disabled={loading || !draft.trim() || !question}
                onClick={() => void advance()}
              >
                {loading ? "Working…" : "Next"}
              </button>
              <button
                type="button"
                className="setup-partner__ghost"
                disabled={loading}
                onClick={() => void mapFrom(messages, modelTurns)}
              >
                That's enough, map it
              </button>
            </>
          ) : null}
          {turnError ? (
            <button
              type="button"
              className="setup-partner__ghost"
              data-practice-setup-retry=""
              onClick={() => void requestTurn(messages, modelTurns)}
            >
              Retry
            </button>
          ) : null}
          {visibleMap && (phase === "map" || redoOpen) ? (
            <button
              type="button"
              className="setup-partner__primary"
              disabled={saving}
              onClick={() => void confirm()}
            >
              {saving ? "Saving…" : "Confirm workflow map"}
            </button>
          ) : null}
          {redoOpen ? (
            <button type="button" className="setup-partner__ghost" disabled={discarding} onClick={() => void discardRedoDraft()}>
              {discarding ? "Discarding…" : "Discard redo, keep saved plan"}
            </button>
          ) : null}
          {phase === "done" && !showInterview ? (
            <button type="button" className="setup-partner__ghost" onClick={redo}>
              Redo interview
            </button>
          ) : null}
          {phase === "done" ? (
            <Link to="/practice" className="setup-partner__ghost">
              Back to practice
            </Link>
          ) : null}
        </div>
      ) : null}

      {!booting && (phase === "done" || nextLines.length > 0 || visibleMap) ? (
        <div className="setup-partner__next" data-im-next="">
          {phase === "done" ? <p className="setup-partner__done">Saved for the practice.</p> : null}
          {nextLines.length > 0 ? (
            <>
              <h2>Recommended next steps</h2>
              <ul>
                {nextLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : null}
          {visibleMap && visibleMap.milonCoverage.length > 0 ? (
            <div data-im-coverage="">
              <h3>Milōn coverage</h3>
              <ul>
                {visibleMap.milonCoverage.map((row) => (
                  <li key={`${row.agent}-${row.owns}`}>
                    {row.agent}: {row.owns}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {!booting ? (
        <PastInterviews
          messages={messages}
          question={question}
          thinking={loading}
          recordedAt={recordedAt}
        />
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

function heroStatus(phase: Phase, booting: boolean): "Not started" | "In progress" | "Done" {
  if (booting) return "Not started";
  if (phase === "done") return "Done";
  return "In progress";
}

function PracticeSetupHero({ status }: { status: "Not started" | "In progress" | "Done" }) {
  return (
    <div className="owner-door" data-im-card="solo">
      <div className="owner-pane" data-owner-home="true">
        <div className="owner-agents">
          <HomeBotCard
            agent="setup_partner"
            name={IMPLEMENTATION_MANAGER_LABEL}
            label={IMPLEMENTATION_MANAGER_LABEL}
            chip={<ImplementationManagerChip />}
            status={
              <span className={status === "Done" ? "owner-status" : "owner-status is-attention"}>{status}</span>
            }
            lines={
              <span className="owner-lines" data-status-update="">
                <span className="owner-voice">Map how the firm closes, reviews, signs off, and reports.</span>
                <span className="owner-voice">Takes ~10 min</span>
              </span>
            }
          />
        </div>
      </div>
    </div>
  );
}
