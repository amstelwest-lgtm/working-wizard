import {
  FIRM_BAND_CATALOG,
  FIRM_CHECKOUT_BANDS,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";
import { registerLabelForPlan } from "@/lib/pending-checkout";
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
 * Pre-commit terms shared by homepage #register and /auth Create Firm:
 * role, selected band, and the homepage trial/card sentence.
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

  if (variant === "auth") {
    return (
      <div className="auth-entry__terms">
        {showRole ? (
          <p className="auth-entry__role">
            {FIRM_ROLE_PROMPT} <strong>{FIRM_ROLE_LABEL}</strong>
          </p>
        ) : null}
        <label className="auth-entry__field-label" htmlFor={bandId}>
          Band
        </label>
        <select
          id={bandId}
          className="auth-entry__input"
          value={plan}
          onChange={(e) => onPlanChange(e.target.value as FirmCheckoutBand)}
        >
          {FIRM_CHECKOUT_BANDS.map((id) => (
            <option key={id} value={id}>
              {FIRM_BAND_CATALOG[id].name}
            </option>
          ))}
        </select>
        <p className="auth-entry__hint">Billed {intervalLabel}.</p>
        <p className="auth-entry__trial">{reminder}</p>
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
      <label htmlFor={bandId}>Band</label>
      <select
        id={bandId}
        value={plan}
        onChange={(e) => onPlanChange(e.target.value as FirmCheckoutBand)}
      >
        {FIRM_CHECKOUT_BANDS.map((id) => (
          <option key={id} value={id}>
            {FIRM_BAND_CATALOG[id].name}
          </option>
        ))}
      </select>
      <p className="firm-signup-hint">Billed {intervalLabel}.</p>
      <p className="firm-signup-hint">{reminder}</p>
    </div>
  );
}
