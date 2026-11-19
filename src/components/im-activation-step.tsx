import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { fetchFirmInterviewDraft, fetchFirmSetupPlan } from "@/lib/setup-partner-client";
import {
  pickPilotClients,
  type ImActivationPlan,
  type ImPilotClient,
  type ImRoutineKind,
} from "@/lib/im-activation-planner";
import { acceptImActivation, loadImActivationContext } from "@/lib/im-activation.functions";
import { SETUP_PARTNER_DISPLAY_NAME } from "@/lib/setup-partner";

type RoutineChoice = {
  routine: ImRoutineKind;
  accepted: boolean;
  hours: string;
};

const ROUTINE_LABELS: Record<ImRoutineKind, string> = {
  document_chase: "Document chase",
  monthly_pack: "Monthly pack",
  cash_debtor_early_warning: "Cash and debtor early warning",
  budget_actual_drift: "Budget-versus-actual drift",
};

export function ImActivationStep() {
  const { firmId, firmMarket } = useAccountantProfile();
  const loadContext = useServerFn(loadImActivationContext);
  const acceptActivation = useServerFn(acceptImActivation);
  const [activation, setActivation] = useState<ImActivationPlan | null>(null);
  const [pilots, setPilots] = useState<ImPilotClient[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [choices, setChoices] = useState<RoutineChoice[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);

  const country = firmMarket === "US" ? "US" : "ZA";

  const refresh = useCallback(async () => {
    if (!firmId) return;
    setBusy(true);
    setNote(null);
    try {
      const savedPlan = await fetchFirmSetupPlan(firmId);
      const draft = await fetchFirmInterviewDraft(firmId);
      if (!savedPlan?.steps.length && !draft?.messages.some((row) => row.role === "user")) {
        setVisible(false);
        setActivation(null);
        return;
      }
      const ctx = await loadContext({ data: { firmId, country } });
      if (!ctx.ok) {
        setNote(ctx.needsQuestions.join(" "));
        setVisible(true);
        return;
      }
      setActivation(ctx.activation);
      setChoices(
        ctx.activation.routineMaps.map((map) => ({
          routine: map.routine,
          accepted: false,
          hours: "",
        })),
      );
      const defaultPilots = pickPilotClients(ctx.pilots);
      setPilots(ctx.pilots);
      setSelected(defaultPilots.map((row) => row.id));
      setVisible(true);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not load activation.");
      setVisible(true);
    } finally {
      setBusy(false);
    }
  }, [country, firmId, loadContext]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const togglePilot = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((row) => row !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  };

  const accept = async () => {
    if (!firmId || !activation || selected.length < 2) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await acceptActivation({
        data: {
          firmId,
          pilotIds: selected,
          accepts: choices.map((row) => ({
            routine: row.routine,
            accepted: row.accepted,
            hoursSavedPerRun: row.hours.trim() ? Number(row.hours) : null,
          })),
        },
      });
      setNote(
        result.enqueued > 0
          ? `Saved. ${result.wrote} backlog row(s); ${result.enqueued} draft run(s) queued.`
          : `Saved. ${result.wrote} backlog row(s). No runs queued until triggers are met.`,
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Accept failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!firmId || !visible) return null;

  const localPlan = activation;

  return (
    <section className="setup-partner im-flow" data-im-activation="" aria-label="Activation">
      <div className="im-card" style={{ borderColor: "#DBEAFE", background: "#fff" }}>
        <h2 className="im-card__title" style={{ color: "#102A43" }}>
          Activation
        </h2>
        <p className="im-muted" style={{ color: "#102A43" }}>
          After you confirm the {SETUP_PARTNER_DISPLAY_NAME} map, pick pilots and accept routines. Milōn prepares
          drafts only — nothing is sent.
        </p>
        <button type="button" className="setup-partner__ghost" disabled={busy} onClick={() => void refresh()}>
          Resume from saved answers
        </button>

        {localPlan ? (
          <>
            <h3 style={{ color: "#102A43" }}>Partner checklist</h3>
            <ul className="im-checks">
              {localPlan.partnerChecklist.map((line) => (
                <li key={line}>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p style={{ color: "#102A43" }}>
              <strong>First value milestone:</strong> {localPlan.firstValueMilestone.title}
            </p>

            <h3 style={{ color: "#102A43" }}>Pilot clients (2–3)</h3>
            <ul>
              {pilots.map((row) => (
                <li key={row.id}>
                  <label style={{ color: "#102A43" }}>
                    <input
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      onChange={() => togglePilot(row.id)}
                    />{" "}
                    {row.name}
                    {row.hasLedger || row.hasUpload ? " — books on file" : ""}
                  </label>
                </li>
              ))}
            </ul>

            {localPlan.routineMaps.map((map) => {
              const choice = choices.find((row) => row.routine === map.routine) ?? {
                routine: map.routine,
                accepted: false,
                hours: "",
              };
              const title = ROUTINE_LABELS[map.routine];
              return (
                <div key={map.routine} className="im-card" data-im-routine="" style={{ borderColor: "#DBEAFE" }}>
                  <h3 style={{ color: "#102A43" }}>{title}</h3>
                  <ol>
                    {map.steps.map((step) => (
                      <li key={step.id} style={{ color: "#102A43" }}>
                        {step.title} — {step.botOwner}
                      </li>
                    ))}
                  </ol>
                  <label style={{ color: "#102A43" }}>
                    Hours saved per run (optional, leave blank if unknown)
                    <input
                      type="number"
                      min={0}
                      step={0.25}
                      disabled={busy || !choice.accepted}
                      value={choice.hours}
                      onChange={(event) =>
                        setChoices((prev) =>
                          prev.map((row) =>
                            row.routine === map.routine ? { ...row, hours: event.target.value } : row,
                          ),
                        )
                      }
                      style={{ borderColor: "#DBEAFE", marginLeft: 8 }}
                    />
                  </label>
                  <div className="setup-partner__actions">
                    <button
                      type="button"
                      className="setup-partner__primary"
                      style={{ background: choice.accepted ? "#102A43" : "#0B5FFF" }}
                      disabled={busy}
                      onClick={() =>
                        setChoices((prev) =>
                          prev.map((row) => (row.routine === map.routine ? { ...row, accepted: true } : row)),
                        )
                      }
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="setup-partner__ghost"
                      disabled={busy}
                      onClick={() =>
                        setChoices((prev) =>
                          prev.map((row) =>
                            row.routine === map.routine ? { ...row, accepted: false, hours: "" } : row,
                          ),
                        )
                      }
                    >
                      Not now
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="setup-partner__actions">
              <button
                type="button"
                className="setup-partner__primary"
                disabled={busy || selected.length < 2 || !choices.some((row) => row.accepted)}
                onClick={() => void accept()}
                style={{ background: "#0B5FFF" }}
              >
                {busy ? "Saving…" : "Accept selected routines"}
              </button>
            </div>
          </>
        ) : (
          <p style={{ color: "#102A43" }}>Confirm or resume the practice map to see activation steps.</p>
        )}
        {note ? (
          <p className="setup-partner__error" role="status" style={{ color: "#102A43" }}>
            {note}
          </p>
        ) : null}
      </div>
    </section>
  );
}