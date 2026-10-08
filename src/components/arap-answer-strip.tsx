import type { ReactNode } from "react";
import { SIGNOFF_GOLD_BTN } from "@/components/review-signoff";
import { signoffStatusLine } from "@/lib/signoff-status";

/** Gold primary on the strip. Full width under 480px via `.answer-strip__primary`. */
export const ARAP_GOLD_BTN = `${SIGNOFF_GOLD_BTN} answer-strip__primary`;

/**
 * Collections and Payables have no review scope, so this strip shows Draft
 * from the shared status line and does not offer Sign off.
 */
export function ArapAnswerStrip({
  heading,
  sentence,
  chip,
  primary,
}: {
  heading: string;
  sentence: string;
  chip?: string | null;
  primary?: ReactNode;
}) {
  return (
    <section className="answer-strip" data-answer-strip>
      <div className="answer-strip__lead">
        <h2 className="answer-strip__heading">{heading}</h2>
        {sentence ? <p className="answer-strip__sentence">{sentence}</p> : null}
      </div>
      <div className="answer-strip__actions">{primary}</div>
      <div className="answer-strip__meta">
        {chip ? (
          <span className="answer-strip__chip" data-source-chip>
            {chip}
          </span>
        ) : null}
        <p data-signoff-status className="answer-strip__status">
          {signoffStatusLine({ kind: "draft" })}
        </p>
      </div>
    </section>
  );
}
