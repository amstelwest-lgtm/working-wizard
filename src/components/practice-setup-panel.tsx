import { createElement, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import "./setup-partner-panel.css";
import "@/components/owner-door/owner-door.css";
import { ImRoutineProposals } from "@/components/im-routine-proposals";
import { HomeBotCard } from "@/components/owner-door/home-bot-card";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { parseMarketSelection } from "@/lib/market/parse";
import {
  firmInterviewTranscript,
  firmSetupPartnerSummary,
  firmInterviewUserError,
  questionAsWritten,
  setupPartnerMapPromptBlock,
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
import { ImTakeoverProposals } from "@/components/im-takeover-proposals";
import { ImplementationManagerChip } from "@/components/practice-setup-card";
import { InterviewExchange } from "@/components/interview-exchange";
import { discardPracticeRedo } from "@/lib/discard-practice-redo.functions";
import {
  buildPracticeImplementationPlan,
  cleanFlowLine,
  dedupePracticeSteps,
  practiceBucketLabel,
  type PracticeImplementationPlan,
} from "@/lib/setup-partner-plan";
import { ImProposalDecisions } from "@/components/im-proposal-decisions";

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
  const discardSavedRedo = useServerFn(discardPracticeRedo);
  const country = parseMarketSelection(firmMarket)?.country ?? null;
  const marketCountry: SetupPartnerCountry | null =
    country === "US" || country === "ZA" ? country : null;
  const visibleMap = map ? withMarketCoverage(map, marketCountry) : null;
  const preview = visibleMap ? buildPracticeImplementationPlan(visibleMap) : null;
  const filledMap = visibleMap
    ? {
        ...visibleMap,
        checklist: visibleMap.checklist.length
          ? visibleMap.checklist
          : (preview?.steps.filter((step) => step.bucket === "client_setup").map((step) => step.step) ??
            []),
        gaps: visibleMap.gaps.length
          ? visibleMap.gaps
          : (preview?.steps.filter((step) => step.bucket === "product_gap").map((step) => step.step) ??
            []),
      }
    : null;

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
        <PracticeSetupHero status="Not started" metric="Takes ~10 min" />
        <p className="setup-partner__lede" data-practice-setup-phase="no-firm">
          {PRACTICE_SETUP_NO_FIRM}
        </p>
        <div className="setup-partner__actions">
          <Link to="/practice/setup" className="setup-partner__primary">
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

  return (
    <section
      className="setup-partner"
      data-practice-setup-panel=""
      data-practice-setup-phase={booting ? "loading" : phase}
        aria-label={IMPLEMENTATION_MANAGER_LABEL}
      >
        <PracticeSetupHero
          status={heroStatus(phase, booting)}
          metric={heroMetric(phase, preview?.steps.length ?? plan?.steps.length ?? 0)}
        />

      {booting ? <p className="setup-partner__lede">Loading your practice.</p> : null}

      {!booting && redoOpen ? (
        <div data-practice-redo="open">
          <h3>Redo in progress</h3>
          <div className="setup-partner__actions">
            <button type="button" disabled={discarding} onClick={() => void discardRedoDraft()}>
              {discarding ? "Discarding…" : "Discard redo, keep saved plan"}
            </button>
          </div>
        </div>
      ) : null}

      {!booting && !visibleMap && (phase === "interview" || redoOpen) ? (
        <div>
          <InterviewExchange question={question} thinking={loading} messages={messages} />
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
          <div className="setup-partner__actions">
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
          </div>
        </div>
      ) : null}

      {!booting && visibleMap && (phase === "map" || redoOpen) ? (
        <div className="setup-partner__map">
          <pre className="sr-only">{setupPartnerMapPromptBlock(filledMap ?? visibleMap)}</pre>
          <h3>Today&apos;s flow</h3>
          <ul>
            {visibleMap.todaysFlow.map(cleanFlowLine).filter(Boolean).map((line) => (
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
          {filledMap && filledMap.gaps.length > 0 ? (
            <>
              <h3>Gaps</h3>
              <ul>
                {filledMap.gaps.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : null}
          {filledMap && filledMap.checklist.length > 0 ? (
            <>
              <h3>Setup checklist</h3>
              <ul>
                {filledMap.checklist.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : null}
          {preview && preview.steps.length > 0 ? (
            <>
              <h3>Buckets</h3>
              <ul>
                {preview.steps.map((step) => (
                  <li key={`${step.dedupe_key}-${step.step}`}>
                    {step.step} — {practiceBucketLabel(step.bucket)}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
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
          {firmId ? <ImRoutineProposals firmId={firmId} plan={plan} /> : null}
          {plan && plan.steps.length > 0 ? (
            <ul>
              {plan.steps.map((step) => (
                <li key={`${step.dedupe_key}-${step.step}`}>
                  {step.step} — {practiceBucketLabel(step.bucket)}
                </li>
              ))}
            </ul>
          ) : null}
          {firmId ? <ImTakeoverProposals firmId={firmId} plan={plan} /> : null}
          <div className="setup-partner__actions">
            <button type="button" className="setup-partner__ghost" onClick={redo}>
              Redo interview
            </button>
            <Link to="/practice">Back to practice</Link>
          </div>
          {firmId ? <ImProposalDecisions firmId={firmId} /> : null}
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

function heroStatus(phase: Phase, booting: boolean): string {
  if (phase === "done") return "Saved";
  if (phase === "map") return "Map ready";
  if (booting) return "Not started";
  return "In progress";
}

function heroMetric(phase: Phase, steps: number): string {
  if ((phase === "map" || phase === "done") && steps > 0) {
    return `${steps} step${steps === 1 ? "" : "s"} mapped`;
  }
  return "Takes ~10 min";
}

function PracticeSetupHero({ status, metric }: { status: string; metric: string }) {
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
              <span className={status === "Saved" ? "owner-status" : "owner-status is-attention"}>{status}</span>
            }
            lines={
              <span className="owner-lines" data-status-update="">
                <span className="owner-voice">
                  Map how the firm closes, reviews, signs off, and reports.{" "}
                  <strong className="owner-money">{metric}</strong>
                </span>
              </span>
            }
          />
        </div>
      </div>
    </div>
  );
}
