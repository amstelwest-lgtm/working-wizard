/**
 * Accountant review of one finished document pack.
 * Approve and reject use the existing draft decision. Nothing is sent on.
 */
import type { TaxReviewCardModel } from "@/lib/tax-review-card";

const PRIMARY =
  "inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[#0B5FFF] px-4 text-sm font-semibold text-white hover:bg-[#2563EB] disabled:opacity-60";
const SECONDARY =
  "inline-flex min-h-11 w-full items-center justify-center rounded-full border border-[#0B5FFF] bg-white px-4 text-sm font-semibold text-[#102A43] hover:bg-[#F4F8FF] disabled:opacity-60";

export function TaxSpecialistReviewCard({
  review,
  busy = false,
  onDecide,
}: {
  review: TaxReviewCardModel;
  busy?: boolean;
  onDecide?: (decision: "approve" | "dismiss") => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-[#DBEAFE] p-3" data-tax-review="">
      <h3 className="text-sm font-semibold">Tax Specialist review</h3>
      {review.summary ? <p className="text-sm leading-6 text-[#3D5270]">{review.summary}</p> : null}
      <ul className="flex flex-col gap-3">
        {review.figures.map((figure) => (
          <li key={`${figure.label}-${figure.fileName}`} className="flex flex-col gap-1">
            <p className="text-sm font-semibold">
              {figure.label}
              {figure.amount ? ` · ${figure.amount}` : ""}
            </p>
            <p className="text-sm text-[#3D5270]">
              {figure.fileName} · {figure.confidence}
            </p>
            {figure.reason ? <p className="text-sm text-[#3D5270]">{figure.reason}</p> : null}
          </li>
        ))}
      </ul>
      {review.flags.length > 0 ? (
        <ul className="flex flex-col gap-1" data-tax-flags="">
          {review.flags.map((flag) => (
            <li key={flag} className="text-sm text-[#3D5270]">
              {flag}
            </li>
          ))}
        </ul>
      ) : null}
      {review.questions.length > 0 ? (
        <div className="flex flex-col gap-1" data-tax-questions="">
          <p className="text-sm font-semibold">Questions for the accountant</p>
          <ul className="flex flex-col gap-1">
            {review.questions.map((question) => (
              <li key={question} className="text-sm text-[#3D5270]">
                {question}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {review.status === "waiting" ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className={PRIMARY}
            data-tax-approve=""
            disabled={busy}
            onClick={() => onDecide?.("approve")}
          >
            Approve
          </button>
          <button
            type="button"
            className={SECONDARY}
            data-tax-reject=""
            disabled={busy}
            onClick={() => onDecide?.("dismiss")}
          >
            Reject
          </button>
        </div>
      ) : (
        <p className="text-sm text-[#3D5270]">{review.status === "approved" ? "Approved" : "Rejected"}</p>
      )}
    </div>
  );
}
