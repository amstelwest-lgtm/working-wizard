import type { ReactNode } from "react";

/** Closed until the accountant asks to see the inputs. */
export function ReviewInputsDrawer({
  children,
  hint,
}: {
  children: ReactNode;
  /** One line from labels already on the drawer, such as "Inputs, what-ifs". */
  hint?: string;
}) {
  return (
    <details className="review-inputs" data-review-inputs>
      <summary className="review-inputs__summary">
        <span>Review inputs</span>
        {hint ? <span className="review-inputs__hint">{hint}</span> : null}
        <span className="review-inputs__chevron" aria-hidden="true" />
      </summary>
      <div className="review-inputs__body">{children}</div>
    </details>
  );
}
