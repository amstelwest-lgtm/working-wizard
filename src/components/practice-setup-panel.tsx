import { createElement, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  ListChecks,
  Map as MapIcon,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Undo2,
} from "lucide-react";
import "./setup-partner-panel.css";
import "@/components/owner-door/owner-door.css";
import { OwnerAvatar } from "@/components/owner-door/owner-avatar";
import { PageHeader } from "@/components/primitives/page-header";
import { ImProposalDecisions } from "@/components/im-proposal-decisions";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { parseMarketSelection } from "@/lib/market/parse";
import {
  firmInterviewTranscript,
  firmSetupPartnerSummary,
  firmInterviewUserError,
  interviewAnswerCount,
  questionAsWritten,
  shouldBuildInterviewMap,
  withMarketCoverage,
  type FirmInterviewMessage,
  type SetupPartnerCountry,
  type SetupPartnerWorkflowMap,
} from "@/lib/setup-partner";
import { groupInterviewSessions, type FirmInterviewDraft } from "@/lib/firm-interview-draft";
import {
  buildSetupPartnerFirmMap,
  confirmSetupPartnerFirmMap,
  fetchFirmInterviewDraft,
  fetchFirmSetupPlan,
  firmInterviewTurn,
} from "@/lib/setup-partner-client";
import { InterviewExchange, PastInterviews } from "@/components/interview-exchange";
import { discardPracticeRedo } from "@/lib/discard-practice-redo.functions";
import {
  approvalDraftTitles,
  buildPracticeImplementationPlan,
  cleanFlowLine,
  dedupePracticeSteps,
  type PracticeImplementationPlan,
} from "@/lib/setup-partner-plan";

/** User-facing name. Internal ids stay setup_partner. */
export const IMPLEMENTATION_MANAGER_LABEL = "Implementation Manager";

export type ImplementationManagerStatus = "Not started" | "Interviewing" | "Redo in progress" | "Saved" | "Map";

const SETUP_STEPS = [
  { id: "interview", label: "Interview" },
  { id: "map", label: "Map" },
  { id: "proposals", label: "Proposals" },
  { id: "live", label: "Live" },
] as const;

export type ImplementationManagerStep = (typeof SETUP_STEPS)[number]["id"];

/**
 * A saved plan plus the interview that produced it is not a redo.
 * A redo is a draft question that is not already in that transcript.
 */
export function draftIsActiveRedo(
  hasPlan: boolean,
  question: string,
  messages: readonly { role: string; content: string }[],
): boolean {
  const asked = question.trim();
  if (!hasPlan || !asked) return false;
  return !messages.some((message) => message.role === "assistant" && message.content === asked);
}

/** The saved transcript already asks this, and nobody has answered it yet. */
export function draftContinuesInterview(
  question: string,
  messages: readonly { role: string; content: string }[],
): boolean {
  const asked = question.trim();
  if (!asked) return false;
  let at = -1;
  messages.forEach((message, index) => {
    if (message.role === "assistant" && message.content === asked) at = index;
  });
  if (at < 0) return false;
  return !messages.slice(at + 1).some((message) => message.role === "user");
}

/** Status words follow the live state. Saved is only the idle saved plan. */
export function implementationManagerStatus(input: {
  booting: boolean;
  phase: "interview" | "map" | "done";
  interviewing: boolean;
  redo: boolean;
}): ImplementationManagerStatus {
  if (input.booting) return "Not started";
  if (input.redo) return "Redo in progress";
  if (input.interviewing || input.phase === "interview") return "Interviewing";
  if (input.phase === "done") return "Saved";
  return "Map";
}

export function implementationManagerStep(input: {
  phase: "interview" | "map" | "done";
  interviewing: boolean;
}): ImplementationManagerStep {
  if (input.interviewing || input.phase === "interview") return "interview";
  if (input.phase === "map") return "proposals";
  return "live";
}

/** This route's Toaster. App chrome also mounts one; this id keeps a single toast. */
export const PRACTICE_SETUP_TOASTER_ID = "practice-setup";

/** The interview call gives up after this and shows Retry. Above the 25s edge timeout. */
export const PRACTICE_SETUP_INTERVIEW_MS = 35_000;

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
  sessionId?: string | null;
}) => Promise<{ question: string; done: boolean; modelTurns: number; sessionId?: string }>;
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
  const [archive, setArchive] = useState<FirmInterviewMessage[]>([]);
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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pastDrafts, setPastDrafts] = useState<FirmInterviewDraft[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
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
      const built = await withDeadline(
        buildMap({
          firmId,
          answers: { transcript: firmInterviewTranscript(history) },
          summary: firmSetupPartnerSummary(),
          modelTurns: turns,
        }),
        PRACTICE_SETUP_INTERVIEW_MS,
      );
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
        askTurn({ firmId, messages: history, modelTurns: turns, sessionId }),
        PRACTICE_SETUP_INTERVIEW_MS,
      );
      setModelTurns(next.modelTurns);
      if (next.sessionId) setSessionId(next.sessionId);
      if (
        shouldBuildInterviewMap({
          answers: interviewAnswerCount(history),
          modelDone: next.done,
          forced: false,
        })
      ) {
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
      setArchive([]);
      setQuestion("");
      setDraft("");
      return;
    }
    let cancel = false;
    setMessages([]);
    setArchive([]);
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
        if (draft && draft.messages.length > 0) {
          setMessages(draft.messages);
          setArchive(draft.messages);
          if (draft.sessionId) setSessionId(draft.sessionId);
          const stamped = draft as FirmInterviewDraft & { recordedAt?: string | null };
          if (draft.savedAt || stamped.recordedAt) setRecordedAt(draft.savedAt ?? stamped.recordedAt ?? null);
          setPastDrafts(draft.past ?? []);
        }
        if (draft?.question) {
          setQuestion(draft.question);
          setModelTurns(draft.modelTurns);
          if (hasPlan && draftIsActiveRedo(true, draft.question, draft.messages)) setRedoOpen(true);
          else if (!hasPlan) setPhase("interview");
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
    setArchive((prev) => (prev.length > 0 ? prev : messages));
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

  const continuing = draftContinuesInterview(question, messages);
  const thinkingNow = booting || loading;
  const showInterview =
    !visibleMap && (thinkingNow || phase === "interview" || redoOpen || continuing);
  const flowLines = visibleMap ? visibleMap.todaysFlow.map(cleanFlowLine).filter(Boolean) : [];
  const checklist = visibleMap ? visibleMap.checklist.map(cleanFlowLine).filter(Boolean) : [];
  const stepLines = [...(preview?.steps ?? []), ...(plan?.steps ?? [])]
    .filter((step) => step.bucket === "client_setup" || step.bucket === "covered")
    .map((step) => step.step);
  const nextLines = [...new Set([...flowLines, ...checklist, ...stepLines])];
  const status = implementationManagerStatus({
    booting: booting && !loading,
    phase,
    interviewing: showInterview,
    redo: redoOpen,
  });
  const step = implementationManagerStep({ phase, interviewing: showInterview });
  const actions = !booting ? (
    <div className="setup-partner__actions" data-im-actions="">
      {showInterview ? (
        <>
          <button
            type="button"
            className={
              !loading && !draft.trim()
                ? "setup-partner__primary is-needs-answer"
                : "setup-partner__primary"
            }
            disabled={loading || !draft.trim() || !question}
            onClick={() => void advance()}
          >
            <ArrowRight size={15} aria-hidden />
            {loading ? "Working…" : "Next"}
          </button>
          {!loading && !draft.trim() ? <span className="im-next-hint">Type an answer</span> : null}
          <button
            type="button"
            className="setup-partner__ghost"
            disabled={loading}
            onClick={() => void mapFrom(messages, modelTurns)}
          >
            <MapIcon size={15} aria-hidden />
            {"That's enough, map it"}
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
          <RefreshCw size={15} aria-hidden />
          {"Retry"}
        </button>
      ) : null}
      {visibleMap && (phase === "map" || redoOpen) ? (
        <button
          type="button"
          className="setup-partner__ghost"
          disabled={saving}
          onClick={() => void confirm()}
        >
          <Check size={15} aria-hidden />
          {saving ? "Saving…" : "Confirm workflow map"}
        </button>
      ) : null}
      {redoOpen ? (
        <button type="button" className="setup-partner__ghost" disabled={discarding} onClick={() => void discardRedoDraft()}>
          <Undo2 size={15} aria-hidden />
          {discarding ? "Discarding…" : "Discard redo, keep saved plan"}
        </button>
      ) : null}
      {phase === "done" && !showInterview ? (
        <button type="button" className="setup-partner__ghost" onClick={redo}>
          <RotateCcw size={15} aria-hidden />
          {"Redo interview"}
        </button>
      ) : null}
      {phase === "done" ? (
        <Link to="/practice" className="setup-partner__ghost">
          <ArrowLeft size={15} aria-hidden />
          {"Back to practice"}
        </Link>
      ) : null}
    </div>
  ) : null;

  return (
    <section
      className="setup-partner im-flow im-page"
      data-practice-setup-panel=""
      data-practice-setup-phase={booting ? "loading" : phase}
      data-im-page=""
      aria-label={IMPLEMENTATION_MANAGER_LABEL}
    >
      <PageHeader
        eyebrow="Practice"
        title="Implementation Manager"
        subtitle="Maps how your practice runs so Milōn can take on the work"
      />
      <PracticeSetupHero status={status} step={step} working={thinkingNow} />

      {showInterview ? (
        <div className="im-card" data-im-interview="">
          <h2 className="im-card__title">
            <MessageSquare size={18} aria-hidden />
            Interview
          </h2>
          <InterviewExchange
            question={question}
            thinking={thinkingNow}
            questionIndex={modelTurns > 0 ? modelTurns : undefined}
          />
          {question ? (
            <textarea
              className="setup-partner__answer"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Walk through it"
              style={{ fontFamily: "var(--font-sans), sans-serif" }}
            />
          ) : null}
          {turnError ? (
            <p className="setup-partner__error" role="alert">
              {turnError}
            </p>
          ) : null}
          {actions}
        </div>
      ) : actions ? (
        <div className="im-card">{actions}</div>
      ) : null}

      {!booting && (phase === "done" || nextLines.length > 0 || visibleMap) ? (
        <div className="im-card setup-partner__next" data-im-next="">
          <h2 className="im-card__title">
            <ListChecks size={18} aria-hidden />
            Recommended next steps
          </h2>
          {nextLines.length > 0 ? (
            <ul className="im-checks">
              {nextLines.map((line) => (
                <li key={line}>
                  <Check size={16} aria-hidden />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="im-muted">The next steps appear once the map is ready.</p>
          )}
          {visibleMap && visibleMap.milonCoverage.length > 0 ? (
            <div data-im-coverage="">
              <h3>Integration plan</h3>
              <ul className="im-checks">
                {visibleMap.milonCoverage.map((row) => (
                  <li key={`${row.agent}-${row.owns}`}>
                    <Check size={16} aria-hidden />
                    <span>
                      {row.agent} takes {row.owns}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {visibleMap && approvalDraftTitles(visibleMap).length > 0 ? (
            <div data-im-approval-drafts="">
              <h3>Drafts that need approval</h3>
              <ul className="im-checks">
                {approvalDraftTitles(visibleMap).map((title) => (
                  <li key={title}>
                    <Check size={16} aria-hidden />
                    <span>{title}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {firmId ? (
            <div className="setup-partner__actions">
              <button type="button" className="setup-partner__ghost" onClick={() => setReviewOpen(true)}>
                <ClipboardList size={15} aria-hidden />
                {"Review proposals"}
              </button>
            </div>
          ) : null}
          {reviewOpen && firmId ? (
            <ImProposalDecisions firmId={firmId} quiet startOpen />
          ) : null}
        </div>
      ) : null}

      {!booting ? (
        <PastInterviews
          sessions={groupInterviewSessions([
            ...pastDrafts,
            {
              messages: redoOpen && archive.length > 0 ? archive : messages,
              question,
              modelTurns,
              sessionId,
              savedAt: recordedAt,
            },
          ])}
          question={redoOpen ? "" : question}
          thinking={redoOpen ? false : thinkingNow}
          sessionId={sessionId}
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

function PracticeSetupHero({
  status,
  step,
  working,
}: {
  status: ImplementationManagerStatus;
  step: ImplementationManagerStep;
  working: boolean;
}) {
  const current = SETUP_STEPS.findIndex((item) => item.id === step);
  return (
    <article className="im-card im-hero" data-im-card="solo" data-im-hero="">
      <div className="setup-partner__head im-hero__id">
        <OwnerAvatar
          agent="setup_partner"
          variant="character"
          motion={working ? "working" : "idle"}
          size="md"
          label={IMPLEMENTATION_MANAGER_LABEL}
        />
        <div className="setup-partner__head-text">
          <div className="im-hero__name">
            <h2 className="setup-partner__title">{IMPLEMENTATION_MANAGER_LABEL}</h2>
            <span className="im-status" data-im-status="">{status}</span>
          </div>
          <p className="im-hero__role">Maps the close, the review, and the sign-off.</p>
        </div>
      </div>
      <ol className="im-stepper" aria-label="Setup progress">
        {SETUP_STEPS.map((item, index) => {
          const state = index < current ? "done" : index === current ? "current" : "upcoming";
          return (
            <li key={item.id} data-step={state} aria-current={state === "current" ? "step" : undefined}>
              <span>{item.label}</span>
            </li>
          );
        })}
      </ol>
    </article>
  );
}
