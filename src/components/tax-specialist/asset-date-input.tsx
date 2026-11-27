/**
 * Plain date text for a wear-and-tear asset.
 * The value stays local while typing, and is stored only as a real ISO date or blank.
 */
import { useEffect, useRef, useState } from "react";

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function validIsoDate(value: string): boolean {
  const match = ISO_DAY.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= last;
}

function invalidDateMessage(label: string): string {
  const text = label.toLowerCase();
  if (text.includes("disposal")) return "Disposal date must be a real date.";
  if (text.includes("addition")) return "An addition needs the date it was brought into use.";
  if (text.includes("declaration")) return "Declaration date must be a real date.";
  return "Date brought into use must be a real date.";
}

export function AssetDateInput({
  id,
  label,
  value,
  disabled,
  hideLabel = false,
  issue,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  hideLabel?: boolean;
  /** Stored-field message. A half-typed date uses the same spot. */
  issue?: string;
  onCommit: (iso: string) => void;
}) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  const commit = (raw: string) => {
    const next = raw.trim();
    if (!next) {
      setBad(false);
      setText("");
      if (value !== "") onCommit("");
      return;
    }
    if (!validIsoDate(next)) {
      setBad(true);
      setText(next);
      return;
    }
    setBad(false);
    setText(next);
    if (next !== value) onCommit(next);
  };
  const message = bad ? invalidDateMessage(label) : (issue ?? "");
  return (
    <label>
      {hideLabel ? null : label}
      <input
        id={id}
        className="irp6-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="YYYY-MM-DD"
        aria-label={label}
        aria-invalid={bad || undefined}
        disabled={disabled}
        value={text}
        data-asset-date="true"
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          setBad(false);
          const trimmed = next.trim();
          if (!trimmed) {
            if (value !== "") onCommit("");
            return;
          }
          if (validIsoDate(trimmed) && trimmed !== value) onCommit(trimmed);
        }}
        onBlur={() => {
          focused.current = false;
          commit(text);
        }}
      />
      {message ? (
        <span className="irp6-field-error" data-asset-field-issue="date">
          {message}
        </span>
      ) : null}
    </label>
  );
}
