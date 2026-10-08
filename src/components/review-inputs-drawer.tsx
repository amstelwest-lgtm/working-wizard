import type { ReactNode } from "react";

/** Closed until the accountant asks to see the inputs. */
export function ReviewInputsDrawer({ children }: { children: ReactNode }) {
  return (
    <details className="review-inputs" data-review-inputs>
      <summary className="review-inputs__summary">Review inputs</summary>
      <div className="review-inputs__body">{children}</div>
    </details>
  );
}
