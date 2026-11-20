import { createElement, useEffect, useMemo, useState } from "react";
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
  discardSetupPartnerRedo,
  fetchFirmInterviewDraft,
  fetchFirmSetupPlan,
  firmInterviewTurn,
} from "@/lib/setup-partner-client";
import { InterviewExchange, PastInterviews } from "@/components/interview-exchange";
import { ImCloudAccessPanel } from "@/components/im-cloud-access-panel";
import { desktopSyncClientReady } from "@/lib/desktop-sync-ready";
import { buildIntegrationPlanTable, type IntegrationPlanRow } from "@/lib/im-integration-plan";
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
  { id: "plan", label: "Your integration plan" },
  { id: "access", label: "Checklist and access" },
  { id: "running", label: "What's running now" },
] as const;

export type ImplementationManagerStep = (typeof SETUP_STEPS)[number]["id"];

/**
 * A redo is persisted data. sessionKind "redo" on the draft is enough.
 * Otherwise an active draft beside a saved plan is a redo while its question
 * is still unanswered, including when that question is already in the transcript.
 * An answered draft beside a saved plan is the idle saved interview.
 */
export function draftIsActiveRedo(
  hasPlan: boolean,
  question: string,
  messages: readonly { role: string; content: string }[],
  sessionKind?: string | null,
): boolean {
  if (sessionKind === "redo") return true;
  if (!hasPlan || !question.trim()) return false;
  const asked = question.trim();
  const inTranscript = messages.some((message) => message.role === "assistant" && message.content === asked);
  if (!inTranscript) return true;
  return draftContinuesInterview(question, messages);
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
  integrationStarted?: boolean;
  /** Activation agent_runs for this firm. The running step stays off until this is at least 1. */
  firmRunCount?: number;
}): ImplementationManagerStep {
  if (input.interviewing || input.phase === "interview") return "interview";
  if ((input.firmRunCount ?? 0) > 0) return "running";
  if (input.integrationStarted) return "access";
  return "plan";
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
  sessionKind?: "redo" | null;
}) => Promise<{ question: string; done: boolean; modelTurns: number; sessionId?: string }>;
type DiscardRedo = (firmId: string) => Promise<void>;

type RunningLine = { id: string; bot: string; status: string; summary: string };

type StartIntegration = (input: {
  firmId: string;
  country?: "US" | "ZA";
}) => Promise<{
  ok: true;
  wrote: number;
  enqueued: number;
  runCount: number;
  pilotIds: string[];
  lines?: RunningLine[];
}>;

type LoadPlanTable = (input: {
  firmId: string;
  country?: "US" | "ZA";
  rows: IntegrationPlanRow[];
}) => Promise<{ rows: IntegrationPlanRow[] }>;

type LoadRunning = (firmId: string) => Promise<{ runCount: number; lines: RunningLine[] }>;

export function PracticeSetupPanel({
  startIntegration,
  loadPlanTable,
  loadRunning,
}: {
  startIntegration?: StartIntegration;
  loadPlanTable?: LoadPlanTable;
  loadRunning?: LoadRunning;
} = {}) {
  const { firmId, firmMarket, refreshFirms, firmsLoaded, firmsLoadFailed } = useAccountantProfile();
  return (
    <PracticeSetupInterview
      key={firmId ?? "no-firm"}
      firmId={firmId}
      firmMarket={firmMarket}
      firmsReady={firmsLoaded || firmsLoadFailed}
      onRefreshFirms={() => void refreshFirms()}
      startIntegration={startIntegration}
      loadPlanTable={loadPlanTable}
      loadRunning={loadRunning}
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
  startIntegration,
  loadPlanTable,
  loadRunning,
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
  startIntegration?: StartIntegration;
  loadPlanTable?: LoadPlanTable;
  loadRunning?: LoadRunning;
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
  const [sessionKind, setSessionKind] = useState<"redo" | null>(null);
  const [pastDrafts, setPastDrafts] = useState<FirmInterviewDraft[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [integrationStarted, setIntegrationStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [firmRunCount, setFirmRunCount] = useState(0);
  const [pilotIds, setPilotIds] = useState<string[]>([]);
  const [runningLines, setRunningLines] = useState<RunningLine[]>([]);
  const [opusRows, setOpusRows] = useState<IntegrationPlanRow[] | null>(null);
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

  const requestTurn = async (
    history: FirmInterviewMessage[],
    turns: number,
    kind: "redo" | null = sessionKind === "redo" ? "redo" : null,
  ) => {
    if (!firmId) return;
    setLoading(true);
    setTurnError(null);
    try {
      const next = await withDeadline(
        askTurn({ firmId, messages: history, modelTurns: turns, sessionId, sessionKind: kind }),
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
        if (draft) setPastDrafts(draft.past ?? []);
        if (draft && draft.messages.length > 0) {
          setMessages(draft.messages);
          setArchive(draft.messages);
          if (draft.sessionId) setSessionId(draft.sessionId);
          if (draft.sessionKind === "redo") setSessionKind("redo");
          const stamped = draft as FirmInterviewDraft & { recordedAt?: string | null };
          if (draft.savedAt || stamped.recordedAt) setRecordedAt(draft.savedAt ?? stamped.recordedAt ?? null);
        }
        if (draft?.question) {
          setQuestion(draft.question);
          setModelTurns(draft.modelTurns);
          if (hasPlan && draftIsActiveRedo(true, draft.question, draft.messages, draft.sessionKind)) {
            setRedoOpen(true);
            setSessionKind("redo");
          } else if (!hasPlan) setPhase("interview");
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

  useEffect(() => {
    if (!firmId || !loadRunning) return;
    let cancel = false;
    void loadRunning(firmId)
      .then((res) => {
        if (cancel) return;
        setFirmRunCount(res.runCount);
        setRunningLines(res.lines);
        if (res.runCount > 0) setIntegrationStarted(true);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [firmId, loadRunning]);

  const planSteps = useMemo(
    () => [...(preview?.steps ?? []), ...(plan?.steps ?? [])],
    [preview, plan],
  );
  const planKey = planSteps.map((row) => `${row.bucket}:${row.step}`).join("\n");
  const coverageKey = (visibleMap?.milonCoverage ?? []).map((row) => `${row.agent}:${row.owns}`).join("\n");
  const localRows = useMemo(
    () =>
      buildIntegrationPlanTable({
        steps: planSteps,
        coverage: visibleMap?.milonCoverage ?? [],
        country: marketCountry,
        started: integrationStarted || firmRunCount > 0,
        running: runningLines.some((line) => line.status === "Running"),
      }),
    // planKey and coverageKey are the stable contents of planSteps and visibleMap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planKey, coverageKey, marketCountry, integrationStarted, firmRunCount, runningLines],
  );
  const tableRows = useMemo(() => {
    if (!opusRows || opusRows.length !== localRows.length) return localRows;
    return localRows.map((row, index) => ({ ...opusRows[index]!, status: row.status }));
  }, [localRows, opusRows]);

  useEffect(() => {
    if (!firmId || !loadPlanTable || localRows.length === 0) return;
    let cancel = false;
    const country = marketCountry === "US" ? "US" : marketCountry === "ZA" ? "ZA" : undefined;
    void loadPlanTable({ firmId, country, rows: localRows })
      .then((res) => {
        if (!cancel && res.rows.length > 0) setOpusRows(res.rows);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
    // Reload Opus when the workflows change, not when a row's status flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmId, loadPlanTable, planKey, coverageKey, marketCountry]);

  const redo = () => {
    setArchive((prev) => (prev.length > 0 ? prev : messages));
    setMessages([]);
    setQuestion("");
    setDraft("");
    setMap(null);
    setError(null);
    setTurnError(null);
    setModelTurns(0);
    if (plan && plan.steps.length > 0) {
      setRedoOpen(true);
      setSessionKind("redo");
    } else setPhase("interview");
    void requestTurn([], 0, plan && plan.steps.length > 0 ? "redo" : null);
  };

  const discardRedoDraft = async () => {
    if (!firmId || discarding) return;
    setDiscarding(true);
    setError(null);
    try {
      if (discardRedo) await discardRedo(firmId);
      else await discardSetupPartnerRedo(firmId);
      if (messages.some((message) => message.role === "user")) {
        setPastDrafts((prev) => [
          ...prev,
          { messages, question, modelTurns, sessionId, savedAt: recordedAt, sessionKind: "redo" },
        ]);
      }
      setRedoOpen(false);
      setSessionKind(null);
      setMessages([]);
      setQuestion("");
      setDraft("");
      setMap(null);
      setTurnError(null);
      setModelTurns(0);
      if (plan && plan.steps.length > 0) setPhase("done");
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
  const step = implementationManagerStep({
    phase,
    interviewing: showInterview,
    integrationStarted,
    firmRunCount,
  });

  const onStart = async () => {
    if (!firmId || starting) return;
    if (!startIntegration) {
      setError("Start integration is not available.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      if (visibleMap && phase !== "done") {
        const saved = await confirmMap(firmId, visibleMap);
        setPlan(saved.plan ? { steps: dedupePracticeSteps(saved.plan.steps) } : null);
        setRedoOpen(false);
        setPhase("done");
      }
      const country = marketCountry === "US" ? "US" : "ZA";
      const result = await startIntegration({ firmId, country });
      setIntegrationStarted(true);
      setPilotIds(result.pilotIds);
      setFirmRunCount(result.runCount);
      if (result.lines) setRunningLines(result.lines);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start integration.");
    } finally {
      setStarting(false);
    }
  };
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

      {!booting && (phase === "done" || nextLines.length > 0 || visibleMap || tableRows.length > 0) ? (
        <div className="im-card setup-partner__next" data-im-next="">
          {tableRows.length > 0 ? (
            <div data-im-plan="" {...(visibleMap ? { "data-im-coverage": "" } : {})}>
              <h2 className="im-card__title" id="im-plan-heading">
                Your integration plan
              </h2>
              <div className="im-plan-scroll">
                <table className="im-plan-table" data-im-plan-table="" aria-labelledby="im-plan-heading">
                  <thead>
                    <tr>
                      <th scope="col">Workflow</th>
                      <th scope="col">How it's done today</th>
                      <th scope="col">What Milōn will do</th>
                      <th scope="col">Which bot</th>
                      <th scope="col">What you need to grant or approve</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row) => (
                      <tr key={`${row.workflow}-${row.bot}-${row.milon}`}>
                        <td>{row.workflow}</td>
                        <td>{row.today}</td>
                        <td>{row.milon}</td>
                        <td>{row.bot}</td>
                        <td>{row.grant}</td>
                        <td>{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="setup-partner__actions">
                <button
                  type="button"
                  className="setup-partner__primary im-plan-start"
                  data-im-start=""
                  disabled={starting}
                  onClick={() => void onStart()}
                >
                  {starting ? "Starting…" : "Start integration"}
                </button>
              </div>
            </div>
          ) : visibleMap && visibleMap.milonCoverage.length > 0 ? (
            <div data-im-coverage="">
              <h3>Your integration plan</h3>
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
            <details
              className="im-folded"
              data-im-folded="review"
              onToggle={(event) => setReviewOpen(event.currentTarget.open)}
            >
              <summary>Review proposals</summary>
              {reviewOpen ? <ImProposalDecisions firmId={firmId} quiet startOpen /> : null}
            </details>
          ) : null}
        </div>
      ) : null}

      {!booting && integrationStarted ? (
        <section className="im-card" data-im-access="" aria-label="Checklist and access">
          <h2 className="im-card__title">Checklist and access</h2>
          <p className="im-muted">
            Grant read-only Drive, OneDrive, or inbox access. Milōn drafts only. Nothing is posted to a ledger.
          </p>
          <ul className="im-checks">
            <li>
              <Check size={16} aria-hidden />
              <span>Google Drive folder, read only</span>
            </li>
            <li>
              <Check size={16} aria-hidden />
              <span>OneDrive folder, read only</span>
            </li>
            <li>
              <Check size={16} aria-hidden />
              <span>Forwarding inbox for documents</span>
            </li>
          </ul>
          {pilotIds.map((clientId) => (
            <ImCloudAccessPanel key={clientId} clientId={clientId} />
          ))}
          <div data-im-desktop-sync="">
            <h3>Desktop folder sync</h3>
            {desktopSyncClientReady() ? (
              <Link to="/settings/desktop-sync" className="setup-partner__ghost">
                Open desktop folder sync
              </Link>
            ) : (
              <p className="im-muted">
                Desktop folder sync will appear here after it is enabled for this environment. Nothing is watching
                your computer yet.
              </p>
            )}
          </div>
        </section>
      ) : null}

      {!booting && firmRunCount > 0 ? (
        <section className="im-card" data-im-running="" aria-label="What's running now">
          <h2 className="im-card__title">What&apos;s running now</h2>
          <ul className="im-checks">
            {(runningLines.length > 0
              ? runningLines
              : [{ id: "queued", bot: "Milōn", status: "Draft queued", summary: "Draft for your review. Nothing has been sent." }]
            ).map((line) => (
              <li key={line.id}>
                <Check size={16} aria-hidden />
                <span>
                  {line.bot} — {line.status}. {line.summary}
                </span>
              </li>
            ))}
          </ul>
        </section>
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
