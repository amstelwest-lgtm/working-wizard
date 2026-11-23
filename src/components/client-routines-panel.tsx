import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  loadClientImRoutineScheduleContext,
  saveClientRoutineSettings,
  setClientRoutineAutoSend,
} from "@/lib/im-routine-runner.functions";
import type { ImRoutineEventContext, RoutineSchedule } from "@/lib/im-routine-schedule";
import {
  accountantRoutineSteps,
  ownerRoutineMonthLines,
  parseRoutineMapMeta,
  routineActionTitle,
  routineHoursSavedLine,
  routineTitle,
  type ParsedRoutineMapMeta,
  type RoutineActionKind,
  type RoutineActionRow,
  type RoutineRunRow,
} from "@/lib/client-routines";
import { imRoutineMapArtifactFilter, IM_ACTIVATION_SOURCE } from "@/lib/im-activation-persist";
import { formatLastRun } from "@/lib/milon-team";
import {
  ROUTINE_AUTO_SEND_UNLOCK,
  routineAutoSendBlocked,
  type RoutineAutoSendState,
} from "@/lib/routine-auto-send";

export function ClientRoutinesPanel({
  clientId,
  firmId,
  ownerSeat,
  routinePeriodKey,
}: {
  clientId: string;
  firmId: string | null;
  ownerSeat: boolean;
  /** Same JHB month key the schedule engine uses (owner parity with accountant tab). */
  routinePeriodKey?: string;
}) {
  const [artifacts, setArtifacts] = useState<{ id: string; meta: unknown }[]>([]);
  const [actions, setActions] = useState<RoutineActionRow[]>([]);
  const [runs, setRuns] = useState<RoutineRunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scheduleContext, setScheduleContext] = useState<ImRoutineEventContext | null>(null);
  const loadScheduleContext = useServerFn(loadClientImRoutineScheduleContext);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
      const [artifactRes, actionRes, runRes] = await Promise.all([
        supabase
          .from("client_artifacts")
          .select("id, meta")
          .eq("client_id", clientId)
          .or(imRoutineMapArtifactFilter())
          .limit(12),
        supabase
          .from("action_items")
          .select("id, title, status, source_move_key, sent_at, driver_key")
          .eq("client_id", clientId)
          .eq("driver_key", IM_ACTIVATION_SOURCE)
          .limit(80),
        supabase
          .from("agent_runs")
          .select("id, agent, status, action_item_id, started_at, finished_at, queued_at")
          .eq("client_id", clientId)
          .order("queued_at", { ascending: false })
          .limit(40),
      ]);
      if (cancelled) return;
      if (artifactRes.error || actionRes.error || runRes.error) {
        setError(artifactRes.error?.message ?? actionRes.error?.message ?? runRes.error?.message ?? "Could not load.");
        return;
      }
      setArtifacts((artifactRes.data ?? []) as { id: string; meta: unknown }[]);
      setActions((actionRes.data ?? []) as RoutineActionRow[]);
      setRuns((runRes.data ?? []) as RoutineRunRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    if (ownerSeat) return;
    let cancelled = false;
    void (async () => {
      try {
        const ctx = await loadScheduleContext({ data: { clientId } });
        if (!cancelled && ctx.ok) setScheduleContext(ctx.scheduleContext);
      } catch {
        if (!cancelled) setScheduleContext(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, loadScheduleContext, ownerSeat]);

  const maps = useMemo(
    () =>
      artifacts
        .map((row) => ({ id: row.id, meta: parseRoutineMapMeta(row.meta) }))
        .filter((row): row is { id: string; meta: ParsedRoutineMapMeta } => Boolean(row.meta)),
    [artifacts],
  );

  const ownerLines = useMemo(() => ownerRoutineMonthLines(actions, runs), [actions, runs]);

  if (ownerSeat) {
    return (
      <section
        className="im-card"
        data-owner-routines=""
        data-im-routine-period={routinePeriodKey ?? undefined}
        style={{ borderColor: "#DBEAFE", background: "#fff" }}
      >
        <h2 style={{ color: "#102A43" }}>This month</h2>
        {ownerLines.length === 0 ? (
          <p style={{ color: "#102A43" }}>Milōn has no pilot routines queued for you this month yet.</p>
        ) : (
          <ul>
            {ownerLines.map((line) => (
              <li key={line.id} style={{ color: "#102A43" }}>
                {line.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  if (!firmId) {
    return <p style={{ color: "#102A43" }}>Firm context is missing for routine maps.</p>;
  }

  if (error) {
    return (
      <p className="setup-partner__error" role="alert" style={{ color: "#102A43" }}>
        {error}
      </p>
    );
  }

  if (maps.length === 0) {
    return (
      <section className="im-card" style={{ borderColor: "#DBEAFE", background: "#fff" }}>
        <p style={{ color: "#102A43" }}>No activation routine maps yet. Accept routines in Implementation Manager setup.</p>
      </section>
    );
  }

  return (
    <section data-client-routines="" style={{ display: "grid", gap: 16 }}>
      {maps.map(({ id, meta }) => {
        const steps = accountantRoutineSteps({
          firmId,
          clientId,
          meta,
          actions,
          runs,
          scheduleContext: scheduleContext ?? undefined,
        });
        const completed = runs.filter(
          (run) => run.status === "succeeded" || run.status === "partial" || run.status === "skipped",
        ).length;
        const hoursLine = routineHoursSavedLine(meta, completed);
        return (
          <article key={meta.idempotency_key} className="im-card" style={{ borderColor: "#DBEAFE", background: "#fff" }}>
            <h2 style={{ color: "#102A43" }}>{routineTitle(meta.routine)}</h2>
            {hoursLine ? <p style={{ color: "#102A43" }}>{hoursLine}</p> : null}
            <ol>
              {steps.map((step) => (
                <li key={step.id} style={{ color: "#102A43", marginBottom: 8 }}>
                  <strong>{step.title}</strong>
                  <div>
                    Owner: {step.ownerLabel} · Status: {step.status.replace(/_/g, " ")}
                  </div>
                  <div>{step.approvalLabel}</div>
                  <div>
                    Last run: {step.lastRunAt ? formatLastRun(step.lastRunAt) ?? "—" : "—"} · Next:{" "}
                    {step.nextRunLabel ?? "—"}
                  </div>
                </li>
              ))}
            </ol>
            <RoutineSettingsEditor
              artifactId={id}
              clientId={clientId}
              firmId={firmId}
              meta={meta}
              onSaved={(schedule, action) => {
                setArtifacts((rows) =>
                  rows.map((row) =>
                    row.id === id && row.meta && typeof row.meta === "object"
                      ? { ...row, meta: { ...(row.meta as Record<string, unknown>), schedule, action } }
                      : row,
                  ),
                );
              }}
              onAutoSend={(autoSend) => {
                setArtifacts((rows) =>
                  rows.map((row) =>
                    row.id === id && row.meta && typeof row.meta === "object"
                      ? { ...row, meta: { ...(row.meta as Record<string, unknown>), autoSend } }
                      : row,
                  ),
                );
              }}
            />
          </article>
        );
      })}
    </section>
  );
}

const SCHEDULE_OPTIONS: { kind: RoutineSchedule["kind"]; label: string }[] = [
  { kind: "last_business_day", label: "Last business day of the month" },
  { kind: "n_bd_before_month_end", label: "N business days before month end" },
  { kind: "nth_bd_after_month_end", label: "Nth business day after month end" },
  { kind: "every_monday", label: "Every Monday" },
  { kind: "books_close", label: "When the books close" },
];

const ACTION_OPTIONS: { value: RoutineActionKind | "build_report"; label: string }[] = [
  { value: "document_chase", label: routineActionTitle("document_chase") },
  { value: "monthly_pack", label: routineActionTitle("monthly_pack") },
  { value: "cash_debtor_early_warning", label: routineActionTitle("cash_debtor_early_warning") },
  { value: "budget_actual_drift", label: routineActionTitle("budget_actual_drift") },
  { value: "tax_deadline_watch", label: routineActionTitle("tax_deadline_watch") },
  { value: "client_update_draft", label: "Draft client update email" },
  { value: "build_report", label: "Build a report" },
];

const REPORT_OPTIONS: { value: RoutineActionKind; label: string }[] = [
  { value: "report_pack", label: "Pack" },
  { value: "report_cash", label: "Cash" },
  { value: "report_waterfall", label: "Waterfall" },
  { value: "report_budget", label: "Budget" },
];

function needsBusinessDayCount(kind: RoutineSchedule["kind"]): boolean {
  return kind === "n_bd_before_month_end" || kind === "nth_bd_after_month_end";
}

function RoutineSettingsEditor({
  artifactId,
  clientId,
  firmId,
  meta,
  onSaved,
  onAutoSend,
}: {
  artifactId: string;
  clientId: string;
  firmId: string;
  meta: ParsedRoutineMapMeta;
  onSaved: (schedule: RoutineSchedule, action: RoutineActionKind) => void;
  onAutoSend: (autoSend: RoutineAutoSendState) => void;
}) {
  const saveSettings = useServerFn(saveClientRoutineSettings);
  const setAutoSend = useServerFn(setClientRoutineAutoSend);
  const savedAction = meta.action;
  const [scheduleKind, setScheduleKind] = useState<RoutineSchedule["kind"]>(meta.schedule?.kind ?? "last_business_day");
  const [dayCount, setDayCount] = useState(
    meta.schedule && "n" in meta.schedule ? String(meta.schedule.n) : "3",
  );
  const [action, setAction] = useState<RoutineActionKind | "build_report">(
    savedAction?.startsWith("report_") ? "build_report" : (savedAction ?? meta.routine),
  );
  const [report, setReport] = useState<RoutineActionKind>(
    savedAction?.startsWith("report_") ? savedAction : "report_pack",
  );
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const savedScheduleKind = meta.schedule?.kind ?? null;
  const savedDayCount = meta.schedule && "n" in meta.schedule ? String(meta.schedule.n) : "";
  const savedActionChoice = meta.action?.startsWith("report_") ? "build_report" : (meta.action ?? null);
  const savedReport = meta.action?.startsWith("report_") ? meta.action : null;
  const scheduleDirty =
    savedScheduleKind !== scheduleKind ||
    (needsBusinessDayCount(scheduleKind) && savedDayCount !== dayCount);
  const actionDirty =
    savedActionChoice !== action || (action === "build_report" && savedReport !== report);

  useEffect(() => {
    setScheduleKind(meta.schedule?.kind ?? "last_business_day");
    setDayCount(meta.schedule && "n" in meta.schedule ? String(meta.schedule.n) : "3");
    setAction(meta.action?.startsWith("report_") ? "build_report" : (meta.action ?? meta.routine));
    setReport(meta.action?.startsWith("report_") ? meta.action : "report_pack");
  }, [meta]);

  async function onSave() {
    setProblem(null);
    setNote(null);
    let schedule: RoutineSchedule;
    if (needsBusinessDayCount(scheduleKind)) {
      const n = Number(dayCount);
      if (!Number.isInteger(n) || n < 1 || n > 15) {
        setProblem("Enter a whole number of business days from 1 to 15.");
        return;
      }
      schedule = { kind: scheduleKind, n };
    } else if (scheduleKind === "last_business_day" || scheduleKind === "every_monday" || scheduleKind === "books_close") {
      schedule = { kind: scheduleKind };
    } else {
      setProblem("Choose a schedule.");
      return;
    }
    const chosen: RoutineActionKind = action === "build_report" ? report : action;
    setBusy(true);
    try {
      const saved = await saveSettings({
        data: { firmId, clientId, artifactId, schedule, action: chosen },
      });
      if (!saved.ok) throw new Error("Could not save.");
      onSaved(saved.schedule, saved.action);
      setNote("Saved. Milōn will queue an unsent draft on this schedule. Nothing is sent.");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function onFlag(on: boolean) {
    setProblem(null);
    setNote(null);
    setBusy(true);
    try {
      const saved = await setAutoSend({ data: { firmId, clientId, artifactId, on } });
      if (!saved.ok) throw new Error("Could not save.");
      onAutoSend(saved.autoSend);
      setNote(on ? "Auto-send is on. The next client update can go out. This one was not sent." : "Auto-send is off.");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const autoSendBlocked = routineAutoSendBlocked(meta);
  const unlocked = meta.autoSend.clean >= ROUTINE_AUTO_SEND_UNLOCK;

  return (
    <form
      data-routine-settings=""
      onSubmit={(event) => {
        event.preventDefault();
        void onSave();
      }}
      style={{ display: "grid", gap: 8, marginTop: 12 }}
    >
      <label style={{ color: "#102A43" }}>
        Schedule
        <select
          value={scheduleKind}
          data-routine-schedule-saved={scheduleDirty ? "no" : "yes"}
          onChange={(event) => setScheduleKind(event.target.value as RoutineSchedule["kind"])}
          style={{ display: "block", marginTop: 4, color: "#102A43" }}
        >
          {SCHEDULE_OPTIONS.map((option) => (
            <option key={option.kind} value={option.kind}>
              {option.label}
            </option>
          ))}
        </select>
        {scheduleDirty ? (
          <span data-routine-unsaved="schedule" style={{ display: "block", marginTop: 4 }}>
            Not saved yet
          </span>
        ) : null}
      </label>
      {needsBusinessDayCount(scheduleKind) ? (
        <label style={{ color: "#102A43" }}>
          Business days
          <input
            type="number"
            min={1}
            max={15}
            value={dayCount}
            onChange={(event) => setDayCount(event.target.value)}
            style={{ display: "block", marginTop: 4, color: "#102A43" }}
          />
        </label>
      ) : null}
      <label style={{ color: "#102A43" }}>
        Action
        <select
          value={action}
          data-routine-action-saved={actionDirty ? "no" : "yes"}
          onChange={(event) => setAction(event.target.value as RoutineActionKind | "build_report")}
          style={{ display: "block", marginTop: 4, color: "#102A43" }}
        >
          {ACTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {actionDirty ? (
          <span data-routine-unsaved="action" style={{ display: "block", marginTop: 4 }}>
            Not saved yet
          </span>
        ) : null}
      </label>
      {action === "build_report" ? (
        <label style={{ color: "#102A43" }}>
          Report
          <select
            value={report}
            onChange={(event) => setReport(event.target.value as RoutineActionKind)}
            style={{ display: "block", marginTop: 4, color: "#102A43" }}
          >
            {REPORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {autoSendBlocked ? null : (
        <div data-routine-auto-send="" style={{ display: "grid", gap: 8 }}>
          <p style={{ color: "#102A43", margin: 0 }}>
            {meta.autoSend.on
              ? "Auto-send is on for this client."
              : unlocked
                ? `${ROUTINE_AUTO_SEND_UNLOCK} clean approvals. Auto-send stays off until you turn it on.`
                : `${meta.autoSend.clean} of ${ROUTINE_AUTO_SEND_UNLOCK} clean approvals. Auto-send stays off.`}
          </p>
          {meta.autoSend.on ? (
            <button type="button" disabled={busy} onClick={() => void onFlag(false)} style={{ justifySelf: "start", color: "#102A43" }}>
              Turn off auto-send
            </button>
          ) : unlocked ? (
            <button type="button" disabled={busy} onClick={() => void onFlag(true)} style={{ justifySelf: "start", color: "#102A43" }}>
              Turn on auto-send
            </button>
          ) : null}
        </div>
      )}
      <p style={{ color: "#102A43", margin: 0 }}>
        {meta.schedule
          ? "Milōn queues an unsent draft on this schedule. Nothing is sent."
          : "Not saved yet. Milōn keeps the current trigger until you save. Nothing is sent."}
      </p>
      <button type="submit" disabled={busy} style={{ justifySelf: "start", color: "#102A43" }}>
        {busy ? "Saving…" : "Save routine"}
      </button>
      {note ? <p style={{ color: "#102A43", margin: 0 }}>{note}</p> : null}
      {problem ? (
        <p className="setup-partner__error" role="alert" style={{ color: "#102A43", margin: 0 }}>
          {problem}
        </p>
      ) : null}
    </form>
  );
}
