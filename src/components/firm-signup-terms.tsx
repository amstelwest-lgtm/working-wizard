import {
  FIRM_BAND_CATALOG,
  FIRM_CHECKOUT_BANDS,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";
import { registerLabelForPlan } from "@/lib/pending-checkout";
import { FUNNEL_SOLO_FIRST } from "@/lib/funnel-timing";
import { FIRM_ROLE_LABEL, FIRM_ROLE_PROMPT, firmSignupTrialReminder } from "@/lib/firm-signup-copy";

type Props = {
  variant: "auth" | "landing";
  plan: FirmCheckoutBand;
  interval: FirmInterval;
  onPlanChange: (plan: FirmCheckoutBand) => void;
  /** Homepage already has the role switcher. Auth shows the firm role in this block. */
  showRole?: boolean;
};

/**
 * Pre-commit terms shared by homepage #register and /auth Create Firm.
 * Solo is the plan on screen. Larger bands stay behind a disclosure.
 */
export function FirmSignupTerms({
  variant,
  plan,
  interval,
  onPlanChange,
  showRole = variant === "auth",
}: Props) {
  const bandId = variant === "auth" ? "auth-firm-band" : "register-firm-band";
  const intervalLabel = interval === "year" ? "annually" : "monthly";
  const reminder = firmSignupTrialReminder(registerLabelForPlan(plan));
  const soloLimit = FIRM_BAND_CATALOG.solo.clientLimit;
  const hintClass = variant === "auth" ? "auth-entry__hint" : "firm-signup-hint";
  const trialClass = variant === "auth" ? "auth-entry__trial" : "firm-signup-hint";

  const bandPicker = (
    <div data-funnel={FUNNEL_SOLO_FIRST}>
      <p className={trialClass}>
        <strong>Solo</strong>
        {soloLimit != null ? ` · up to ${soloLimit} active clients` : ""}. This is the plan to start
        on.
        {plan !== "solo" ? ` You currently have ${registerLabelForPlan(plan)} selected.` : ""}
      </p>
      {plan !== "solo" ? (
        <p className={hintClass}>
          <button type="button" className="btn btn-ghost" onClick={() => onPlanChange("solo")}>
            Use Solo
          </button>
        </p>
      ) : null}
      <details>
        <summary className={hintClass}>Larger band, when the book outgrows Solo</summary>
        {variant === "auth" ? (
          <label className="auth-entry__field-label" htmlFor={bandId}>
            Band
          </label>
        ) : (
          <label htmlFor={bandId}>Band</label>
        )}
        <select
          id={bandId}
          className={variant === "auth" ? "auth-entry__input" : undefined}
          value={plan}
          onChange={(e) => onPlanChange(e.target.value as FirmCheckoutBand)}
        >
          {FIRM_CHECKOUT_BANDS.map((id) => (
            <option key={id} value={id}>
              {FIRM_BAND_CATALOG[id].name}
            </option>
          ))}
        </select>
      </details>
      <p className={hintClass}>Billed {intervalLabel}.</p>
      <p className={trialClass}>{reminder}</p>
    </div>
  );

  if (variant === "auth") {
    return (
      <div className="auth-entry__terms">
        {showRole ? (
          <p className="auth-entry__role">
            {FIRM_ROLE_PROMPT} <strong>{FIRM_ROLE_LABEL}</strong>
          </p>
        ) : null}
        {bandPicker}
      </div>
    );
  }

  return (
    <div className="firm-signup-terms">
      {showRole ? (
        <p>
          {FIRM_ROLE_PROMPT} <strong>{FIRM_ROLE_LABEL}</strong>
        </p>
      ) : null}
      {bandPicker}
    </div>
  );
}
