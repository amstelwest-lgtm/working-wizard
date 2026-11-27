import { NIL_CONFIRMED_NOTE } from "@/lib/tax-specialist/forms/nil-mark";

/** One schedule. The note stays visible while the mark applies, including for the owner. */
export function NilBlanksControl({
  target,
  active,
  locked,
  onMark,
  onUndo,
}: {
  target: string;
  active: boolean;
  locked: boolean;
  onMark: () => void;
  onUndo: () => void;
}) {
  if (!active && locked) return null;
  return (
    <p data-nil-schedule={target}>
      {active ? (
        <span className="irp6-note" data-nil-note={target}>
          {NIL_CONFIRMED_NOTE}
        </span>
      ) : null}
      {locked ? null : (
        <button type="button" className="irp6-back" data-nil-blanks={target} onClick={onMark}>
          Mark remaining blanks as nil
        </button>
      )}
      {active && !locked ? (
        <button type="button" className="irp6-back" data-nil-undo={target} onClick={onUndo}>
          Undo
        </button>
      ) : null}
    </p>
  );
}
