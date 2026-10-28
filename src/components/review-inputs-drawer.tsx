import { useState, type ReactNode } from "react";

/** Closed until the accountant asks to see the inputs. */
export function ReviewInputsDrawer({
  children,
  hint,
  label = "Review inputs",
}: {
  children: ReactNode;
  /** One line from labels already on the drawer, such as "Inputs, what-ifs". */
  hint?: string;
  /** Summary wording. Health says "Review Source documents". */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="review-inputs"
      data-review-inputs
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="review-inputs__summary">
        <span>{label}</span>
        {hint ? <span className="review-inputs__hint">{hint}</span> : null}
        <span className="review-inputs__chevron" aria-hidden="true" />
      </summary>
      <div className="review-inputs__body">{open ? children : null}</div>
    </details>
  );
}
