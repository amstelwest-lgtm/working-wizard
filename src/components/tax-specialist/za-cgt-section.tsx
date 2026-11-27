/**
 * Capital gains register on the ITR12 and ITR14 sheets.
 * Amounts commit on blur. Keys stay on the disposal id so typed text is not rewritten.
 * The owner gets the same section with the controls disabled.
 */
import { useEffect, useRef, useState } from "react";
import {
  CGT_BLANK_SCHEDULE,
  markAssessedCapitalLossNil,
  undoAssessedCapitalLossNil,
  type CgtDisposal,
  type CgtPerson,
  type CgtSchedule,
} from "@/lib/tax-specialist/forms/cgt";
import type { NilMark } from "@/lib/tax-specialist/forms/nil-mark";
import { parseRandsToCents } from "@/lib/tax-specialist/forms/irp6";
import { formatSampleCents } from "@/lib/tax-specialist/sample-compute";
import { NilBlanksControl } from "./za-nil-blanks-control";

const BLANK_LINES = [
  "Description",
  "Date acquired",
  "Date disposed",
  "Proceeds",
  "Cost",
  "Improvements",
  "Selling costs",
  "Base cost",
  "Gain or loss",
] as const;

function centsText(cents: number | null): string {
  if (cents == null) return "";
  const abs = Math.abs(cents);
  const rands = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${cents < 0 ? "-" : ""}${rands}${rem ? `.${String(rem).padStart(2, "0")}` : ""}`;
}

function showCents(cents: number | null): string {
  return cents == null ? "" : formatSampleCents(cents);
}

function rowId(): string {
  return `cgt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function emptyDisposal(): CgtDisposal {
  return {
    id: rowId(),
    description: "",
    dateAcquired: "",
    dateDisposed: "",
    proceedsCents: null,
    costCents: null,
    improvementsCents: null,
    sellingCostsCents: null,
    primaryResidence: null,
  };
}

function BlurAmount({
  id,
  value,
  label,
  disabled,
  entry,
  onCommit,
}: {
  id: string;
  value: number | null;
  label: string;
  disabled: boolean;
  entry: string;
  onCommit: (cents: number | null) => void;
}) {
  const [text, setText] = useState(centsText(value));
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(centsText(value));
  }, [value]);
  return (
    <span className="irp6-amount">
      <span aria-hidden="true">R</span>
      <input
        id={id}
        className="irp6-input irp6-input--num"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={bad || undefined}
        disabled={disabled}
        value={text}
        placeholder="Blank"
        data-cgt-entry={entry}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => {
          setText(event.target.value);
          setBad(false);
        }}
        onBlur={() => {
          focused.current = false;
          if (!text.trim()) {
            setBad(false);
            setText("");
            if (value != null) onCommit(null);
            return;
          }
          const cents = parseRandsToCents(text);
          if (cents == null || cents < 0) {
            setBad(true);
            return;
          }
          setBad(false);
          setText(centsText(cents));
          if (cents !== value) onCommit(cents);
        }}
      />
    </span>
  );
}

function BlurText({
  id,
  value,
  label,
  disabled,
  entry,
  onCommit,
}: {
  id: string;
  value: string;
  label: string;
  disabled: boolean;
  entry: string;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  return (
    <input
      id={id}
      className="irp6-input"
      aria-label={label}
      disabled={disabled}
      value={text}
      placeholder="Blank"
      data-cgt-entry={entry}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        focused.current = false;
        const next = text.trim();
        setText(next);
        if (next !== value.trim()) onCommit(next);
      }}
    />
  );
}

export function CgtSection({
  form,
  person,
  disposals,
  assessedCapitalLossBroughtForwardCents,
  assessedCapitalLossNilMark,
  schedule,
  locked,
  onChange,
  onNilMark,
}: {
  form: "itr12" | "itr14";
  person: CgtPerson;
  disposals: readonly CgtDisposal[];
  assessedCapitalLossBroughtForwardCents: number | null;
  assessedCapitalLossNilMark: NilMark | null;
  schedule: CgtSchedule | null;
  locked: boolean;
  onChange: (next: {
    disposals: CgtDisposal[];
    assessedCapitalLossBroughtForwardCents: number | null;
  }) => void;
  onNilMark: (mark: NilMark | null, cents: number | null) => void;
}) {
  const blank = schedule == null;
  const update = (id: string, patch: Partial<CgtDisposal>) => {
    onChange({
      disposals: disposals.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      assessedCapitalLossBroughtForwardCents,
    });
  };
  const summary: Array<[string, string]> = blank
    ? []
    : [
        ["Aggregate gain or loss", showCents(schedule.aggregateCents)],
        [
          "Annual exclusion",
          schedule.annualExclusionApplies
            ? showCents(schedule.annualExclusionCents)
            : "Does not apply",
        ],
        [
          "Primary residence exclusion",
          schedule.primaryResidenceApplies
            ? showCents(schedule.primaryResidenceExclusionCents)
            : "Does not apply",
        ],
        [
          "Assessed capital loss brought forward",
          showCents(schedule.assessedCapitalLossBroughtForwardCents),
        ],
        ["Net capital gain", showCents(schedule.netCapitalGainCents)],
        ["Inclusion", schedule.inclusionPercent == null ? "" : `${schedule.inclusionPercent}%`],
        ["Taxable capital gain", showCents(schedule.taxableCapitalGainCents)],
        [
          "Capital loss carried forward",
          schedule.lossCarriedForward ? showCents(schedule.carriedForwardCents) : "",
        ],
      ];

  return (
    <section
      className="irp6-section"
      data-cgt={blank ? "blank" : "filled"}
      data-cgt-form={form}
      {...(form === "itr12"
        ? { "data-itr12-cgt": blank ? "blank" : "filled" }
        : { "data-itr14-cgt": blank ? "blank" : "filled" })}
    >
      <h3 className="irp6-section-title">Capital gains</h3>
      <p className="irp6-note">Eighth Schedule disposals. Draft for checking. Not a SARS return.</p>
      {blank ? <p className="irp6-note">{CGT_BLANK_SCHEDULE}</p> : null}
      {blank ? (
        <table className="irp6-table" data-cgt-blank="true">
          <tbody>
            {(person === "individual"
              ? [...BLANK_LINES.slice(0, 8), "Primary residence", BLANK_LINES[8]]
              : BLANK_LINES
            ).map((label) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td className="irp6-value" data-cgt-blank-line={label}></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {disposals.map((row) => (
        <div key={row.id} data-cgt-disposal={row.id}>
          <BlurText
            key={`${row.id}-description`}
            id={`${form}-cgt-description-${row.id}`}
            entry="description"
            label="Disposal description"
            disabled={locked}
            value={row.description}
            onCommit={(description) => update(row.id, { description })}
          />
          <label>
            Date acquired
            <input
              id={`${form}-cgt-acquired-${row.id}`}
              className="irp6-input"
              type="date"
              aria-label="Date acquired"
              disabled={locked}
              value={row.dateAcquired}
              data-cgt-entry="date-acquired"
              onChange={(event) => update(row.id, { dateAcquired: event.target.value })}
            />
          </label>
          <label>
            Date disposed
            <input
              id={`${form}-cgt-disposed-${row.id}`}
              className="irp6-input"
              type="date"
              aria-label="Date disposed"
              disabled={locked}
              value={row.dateDisposed}
              data-cgt-entry="date-disposed"
              onChange={(event) => update(row.id, { dateDisposed: event.target.value })}
            />
          </label>
          <BlurAmount
            key={`${row.id}-proceeds`}
            id={`${form}-cgt-proceeds-${row.id}`}
            entry="proceeds"
            label="Proceeds"
            disabled={locked}
            value={row.proceedsCents}
            onCommit={(proceedsCents) => update(row.id, { proceedsCents })}
          />
          <BlurAmount
            key={`${row.id}-cost`}
            id={`${form}-cgt-cost-${row.id}`}
            entry="cost"
            label="Cost"
            disabled={locked}
            value={row.costCents}
            onCommit={(costCents) => update(row.id, { costCents })}
          />
          <BlurAmount
            key={`${row.id}-improvements`}
            id={`${form}-cgt-improvements-${row.id}`}
            entry="improvements"
            label="Improvements"
            disabled={locked}
            value={row.improvementsCents}
            onCommit={(improvementsCents) => update(row.id, { improvementsCents })}
          />
          <BlurAmount
            key={`${row.id}-selling`}
            id={`${form}-cgt-selling-${row.id}`}
            entry="selling-costs"
            label="Selling costs"
            disabled={locked}
            value={row.sellingCostsCents}
            onCommit={(sellingCostsCents) => update(row.id, { sellingCostsCents })}
          />
          {person === "individual" ? (
            <label>
              Primary residence
              <select
                id={`${form}-cgt-residence-${row.id}`}
                className="irp6-input"
                aria-label="Primary residence"
                disabled={locked}
                value={row.primaryResidence == null ? "" : row.primaryResidence ? "yes" : "no"}
                data-cgt-entry="primary-residence"
                onChange={(event) => {
                  const next = event.target.value;
                  update(row.id, {
                    primaryResidence: next === "yes" ? true : next === "no" ? false : null,
                  });
                }}
              >
                <option value="">Blank</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          ) : null}
          <p className="irp6-note" data-cgt-gain={row.id}>
            Gain or loss:{" "}
            {showCents(schedule?.rows.find((item) => item.id === row.id)?.gainCents ?? null)}
          </p>
          {locked ? null : (
            <button
              type="button"
              className="irp6-back"
              data-cgt-remove={row.id}
              onClick={() =>
                onChange({
                  disposals: disposals.filter((item) => item.id !== row.id),
                  assessedCapitalLossBroughtForwardCents,
                })
              }
            >
              Remove disposal
            </button>
          )}
        </div>
      ))}
      {locked ? null : (
        <button
          type="button"
          className="irp6-back"
          data-cgt-add="true"
          onClick={() =>
            onChange({
              disposals: [...disposals, emptyDisposal()],
              assessedCapitalLossBroughtForwardCents,
            })
          }
        >
          Add a disposal
        </button>
      )}
      <BlurAmount
        key="cgt-assessed-loss"
        id={`${form}-cgt-assessed-loss`}
        entry="assessed-loss"
        label="Assessed capital loss brought forward"
        disabled={locked}
        value={assessedCapitalLossBroughtForwardCents}
        onCommit={(assessedCapitalLossBroughtForwardCentsNext) =>
          onChange({
            disposals: [...disposals],
            assessedCapitalLossBroughtForwardCents: assessedCapitalLossBroughtForwardCentsNext,
          })
        }
      />
      <NilBlanksControl
        target={`${form}-cgt-assessed-loss`}
        active={assessedCapitalLossNilMark != null}
        locked={locked}
        onMark={() => {
          const marked = markAssessedCapitalLossNil(
            assessedCapitalLossBroughtForwardCents,
            assessedCapitalLossNilMark,
          );
          onNilMark(marked.mark, marked.cents);
        }}
        onUndo={() => {
          const undone = undoAssessedCapitalLossNil(
            assessedCapitalLossBroughtForwardCents,
            assessedCapitalLossNilMark,
          );
          onNilMark(undone.mark, undone.cents);
        }}
      />
      {blank ? null : (
        <table className="irp6-table">
          <tbody>
            {summary.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td className="irp6-value" data-cgt-summary={label}>
                  {value}
                  {label === "Taxable capital gain" && schedule.ratesNote ? (
                    <span className="irp6-note" data-cgt-rates-note="true">
                      {schedule.ratesNote}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {schedule?.notes.map((note) => (
        <p key={note} className="irp6-note">
          {note}
        </p>
      ))}
    </section>
  );
}
