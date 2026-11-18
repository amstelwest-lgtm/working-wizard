import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  accountantRoutineSteps,
  ownerRoutineMonthLines,
  parseRoutineMapMeta,
  routineHoursSavedLine,
  type RoutineActionRow,
  type RoutineRunRow,
} from "@/lib/client-routines";
import { IM_ACTIVATION_SOURCE } from "@/lib/im-activation-persist";
import { formatLastRun } from "@/lib/milon-team";

export function ClientRoutinesPanel({
  clientId,
  firmId,
  ownerSeat,
}: {
  clientId: string;
  firmId: string | null;
  ownerSeat: boolean;
}) {
  const [artifacts, setArtifacts] = useState<Record<string, unknown>[]>([]);
  const [actions, setActions] = useState<RoutineActionRow[]>([]);
  const [runs, setRuns] = useState<RoutineRunRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
      const [artifactRes, actionRes, runRes] = await Promise.all([
        supabase.from("client_artifacts").select("meta").eq("client_id", clientId).eq("kind", "routine_map").limit(12),
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
      setArtifacts(artifactRes.data ?? []);
      setActions((actionRes.data ?? []) as RoutineActionRow[]);
      setRuns((runRes.data ?? []) as RoutineRunRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const metas = useMemo(
    () => artifacts.map((row) => parseRoutineMapMeta(row.meta)).filter((row): row is NonNullable<typeof row> => !!row),
    [artifacts],
  );

  const ownerLines = useMemo(() => ownerRoutineMonthLines(actions, runs), [actions, runs]);

  if (ownerSeat) {
    return (
      <section className="im-card" data-owner-routines="" style={{ borderColor: "#DBEAFE", background: "#fff" }}>
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

  if (metas.length === 0) {
    return (
      <section className="im-card" style={{ borderColor: "#DBEAFE", background: "#fff" }}>
        <p style={{ color: "#102A43" }}>No activation routine maps yet. Accept routines in Implementation Manager setup.</p>
      </section>
    );
  }

  return (
    <section data-client-routines="" style={{ display: "grid", gap: 16 }}>
      {metas.map((meta) => {
        const steps = accountantRoutineSteps({ firmId, clientId, meta, actions, runs });
        const completed = runs.filter(
          (run) => run.status === "succeeded" || run.status === "partial" || run.status === "skipped",
        ).length;
        const hoursLine = routineHoursSavedLine(meta, completed);
        return (
          <article key={meta.idempotency_key} className="im-card" style={{ borderColor: "#DBEAFE", background: "#fff" }}>
            <h2 style={{ color: "#102A43" }}>
              {meta.routine === "document_chase" ? "Document chase routine" : "Monthly pack routine"}
            </h2>
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
          </article>
        );
      })}
    </section>
  );
}