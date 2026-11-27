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

export function AssetDateInput({
  id,
  label,
  value,
  disabled,
  showLabel = true,
  onCommit,
}: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  /** The table heading is the visible label. The input keeps its accessible name. */
  showLabel?: boolean;
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
  const field = (
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
  );
  if (!showLabel) return field;
  return (
    <label>
      {label}
      {field}
    </label>
  );
}
