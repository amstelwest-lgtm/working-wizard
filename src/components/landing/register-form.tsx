import type { FormEvent } from "react";
import { AuthDivider, AccountProviderButtons } from "@/components/google-sign-in-button";
import { FirmSignupTerms } from "@/components/firm-signup-terms";
import { MarketPicker } from "@/components/market-picker";
import { firmSignupTrialReminder, practiceLocationHint } from "@/lib/firm-signup-copy";
import {
  draftToSelection,
  isDraftComplete,
  t,
  visitorCopyPack,
  writeVisitorDraft,
  type DraftMarket,
  type VisitorCopyPack,
} from "@/lib/market";
import {
  billingStartPath,
  clearPendingCheckout,
  paidPlanFromRegisterLabel,
  peekPendingCheckout,
  registerLabelForPlan,
  stashPendingCheckout,
} from "@/lib/pending-checkout";
import { stashAccountantGoogleSignup } from "@/lib/google-auth";
import { setPortalIntent } from "@/lib/user-roles";
import { PasswordWithShow } from "@/components/show-password";
import { ownerInviteLead } from "@/lib/invite-claim";
import type { FirmCheckoutBand, FirmInterval } from "@/lib/stripe-plans";

type SignedIn = { email?: string | null } | null;

export function LandingRegisterForm({
  inviteClientId,
  inviteBusiness,
  inviteFirmName,
  inviteNeedsCode,
  inviteIsLegacyUuid,
  user,
  regClientCode,
  setRegClientCode,
  regBusy,
  regError,
  showRegisterError,
  regName,
  setRegName,
  regEmail,
  setRegEmail,
  regPassword,
  setRegPassword,
  regRole,
  setRegRole,
  regPlan,
  setRegPlan,
  regFirmName,
  setRegFirmName,
  regBusiness,
  setRegBusiness,
  draftMarket,
  setDraftMarket,
  firmInterval,
  copyMarket,
  ownerNote,
  handleRegister,
  goToFirmSignup,
  goToOwnerSpark,
}: {
  inviteClientId: string | null;
  inviteBusiness: string | null;
  inviteFirmName?: string | null;
  inviteNeedsCode: boolean;
  inviteIsLegacyUuid: boolean;
  user: SignedIn;
  regClientCode: string;
  setRegClientCode: (value: string) => void;
  regBusy: boolean;
  regError: string;
  showRegisterError: (message: string) => void;
  regName: string;
  setRegName: (value: string) => void;
  regEmail: string;
  setRegEmail: (value: string) => void;
  regPassword: string;
  setRegPassword: (value: string) => void;
  regRole: string;
  setRegRole: (value: string) => void;
  regPlan: string;
  setRegPlan: (value: string) => void;
  regFirmName: string;
  setRegFirmName: (value: string) => void;
  regBusiness: string;
  setRegBusiness: (value: string) => void;
  draftMarket: DraftMarket;
  setDraftMarket: (value: DraftMarket) => void;
  firmInterval: FirmInterval;
  copyMarket: { copyPack: VisitorCopyPack };
  /** Server-built for ZA. The US sentence otherwise. Never a client-side rand literal. */
  ownerNote: string;
  handleRegister: (event: FormEvent) => void;
  goToFirmSignup: (opts?: { plan?: FirmCheckoutBand; scrollTo?: "register" | "pricing" }) => void;
  goToOwnerSpark: () => void;
}) {
  return (
    <div className="reg-shell">
      <form onSubmit={handleRegister}>
        {regError ? (
          <p id="register-error" role="alert" className="reg-error">
            {regError}
          </p>
        ) : null}
        {inviteClientId ? (
          <>
            <p
              style={{
                fontSize: 13,
                color: "var(--gold-ink)",
                marginBottom: 16,
                lineHeight: 1.5,
                fontWeight: 600,
              }}
            >
              {ownerInviteLead(inviteFirmName, inviteBusiness)}. Create your account or sign in to
              take ownership and see your numbers.
              {inviteNeedsCode ? " You'll need the client code from the email (MLN-XXXXXX)." : ""}
            </p>
            {user ? (
              <p style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 16, lineHeight: 1.5 }}>
                You&apos;re signed in as {user.email}. Accepting this invite will open the owner
                workspace
                {user.email?.toLowerCase() !== regEmail.trim().toLowerCase() && regEmail
                  ? ` as ${regEmail}`
                  : ""}
                .
              </p>
            ) : null}
            {inviteIsLegacyUuid ? (
              <p style={{ fontSize: 12, color: "var(--ink-dim)", marginBottom: 16, lineHeight: 1.5 }}>
                Note: this is an older invite link format. It still works — for the most secure
                link, ask your accountant to copy a fresh invite from the dashboard.
              </p>
            ) : null}
            {inviteNeedsCode ? (
              <>
                <label htmlFor="regClientCodeField">Client code</label>
                <input
                  id="regClientCodeField"
                  type="text"
                  required
                  autoCapitalize="characters"
                  placeholder="MLN-XXXXXX"
                  value={regClientCode}
                  onChange={(e) => setRegClientCode(e.target.value.toUpperCase())}
                />
                <p style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 6 }}>
                  It&apos;s in the invite email, next to the claim link.
                </p>
              </>
            ) : null}
            <div style={{ margin: "18px 0 8px" }}>
              <AccountProviderButtons
                intent="owner"
                tone="landing"
                label="Continue with Google"
                disabled={regBusy || (inviteNeedsCode && !regClientCode.trim())}
                ownerInvite={{
                  token: inviteClientId,
                  clientCode: regClientCode.trim() || null,
                }}
                next={`/?invite=${encodeURIComponent(inviteClientId)}&mode=signup`}
                onError={(msg) => showRegisterError(msg)}
              />
            </div>
            <AuthDivider />
            <label htmlFor="regNameField">Full name</label>
            <input
              id="regNameField"
              type="text"
              required={!user}
              placeholder={t("nameExample", copyMarket)}
              value={regName}
              onChange={(e) => setRegName(e.target.value)}
            />
            <label htmlFor="regEmailField">Work email</label>
            <input
              id="regEmailField"
              type="email"
              required
              placeholder={t("emailExample", copyMarket)}
              value={regEmail}
              onChange={(e) => setRegEmail(e.target.value)}
            />
            <label htmlFor="regPasswordField">Password</label>
            <PasswordWithShow id="regPasswordField">
              {(type) => (
                <input
                  id="regPasswordField"
                  type={type}
                  required={!user}
                  placeholder="At least 6 characters"
                  minLength={user ? undefined : 6}
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                />
              )}
            </PasswordWithShow>
            <button
              type="submit"
              className="btn btn-cobalt"
              disabled={regBusy}
              style={{ width: "100%", justifyContent: "center", marginTop: 16 }}
            >
              {regBusy ? "Joining workspace…" : "Accept invitation ✦"}
            </button>
            <p
              style={{
                textAlign: "center",
                fontSize: 11,
                color: "var(--ink-dim)",
                marginTop: 14,
                lineHeight: 1.5,
              }}
            >
              By joining you agree to the <a href="/terms">Terms</a>.
            </p>
          </>
        ) : (
          <>
            <label htmlFor="regRoleField">
              {regRole.startsWith("Accountant") ? "I am an" : "I am a"}
            </label>
            <select
              id="regRoleField"
              value={regRole}
              onChange={(e) => {
                const value = e.target.value;
                setRegRole(value);
                if (value === "Accountant / Advisory firm") {
                  goToFirmSignup({ plan: "starter", scrollTo: "register" });
                } else {
                  clearPendingCheckout();
                  setRegPlan("Business owner");
                }
              }}
            >
              <option>Accountant / Advisory firm</option>
              <option>Business owner</option>
            </select>
            {regRole === "Accountant / Advisory firm" ? (
              <>
                <FirmSignupTerms
                  variant="landing"
                  showRole={false}
                  plan={paidPlanFromRegisterLabel(regPlan) ?? "starter"}
                  interval={firmInterval}
                  onPlanChange={(nextPlan) => {
                    setRegPlan(registerLabelForPlan(nextPlan));
                    stashPendingCheckout({
                      plan: nextPlan,
                      interval: firmInterval,
                      market: visitorCopyPack(draftMarket),
                    });
                  }}
                />
                <div style={{ margin: "8px 0 18px" }}>
                  <MarketPicker
                    value={draftMarket}
                    onChange={setDraftMarket}
                    variant="landing"
                    audience="practice"
                    vatCopy={false}
                    taxWording={draftMarket.country === "US"}
                  />
                  {practiceLocationHint(draftMarket) ? (
                    <p className="firm-signup-hint" role="status">
                      {practiceLocationHint(draftMarket)}
                    </p>
                  ) : null}
                </div>
                <AccountProviderButtons
                  intent="accountant"
                  tone="landing"
                  label="Continue with Google"
                  disabled={regBusy || !isDraftComplete(draftMarket)}
                  next={billingStartPath({
                    plan: paidPlanFromRegisterLabel(regPlan) ?? "starter",
                    interval: firmInterval,
                    market: visitorCopyPack(draftMarket),
                  })}
                  onBeforeStart={() => {
                    const market = draftToSelection(draftMarket);
                    if (!market) {
                      showRegisterError(
                        "Choose a practice location first. A United States practice also needs a state.",
                      );
                      return false;
                    }
                    writeVisitorDraft(draftMarket);
                    setPortalIntent("accountant");
                    stashAccountantGoogleSignup({
                      firmName: regFirmName.trim(),
                      fullName: regName.trim() || undefined,
                      marketCountry: market.country,
                      marketRegion: market.regionCode,
                    });
                    stashPendingCheckout({
                      plan: paidPlanFromRegisterLabel(regPlan) ?? "starter",
                      interval: firmInterval,
                      market: market.country === "ZA" ? "za" : "us",
                    });
                    return true;
                  }}
                  onError={(msg) => showRegisterError(msg)}
                />
                <AuthDivider />
                <label htmlFor="regNameField">Your name</label>
                <input
                  id="regNameField"
                  type="text"
                  required
                  placeholder={t("nameExample", copyMarket)}
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                />
                <label htmlFor="regFirmNameField">Firm name</label>
                <input
                  id="regFirmNameField"
                  type="text"
                  required
                  placeholder="Acme & Partners"
                  value={regFirmName}
                  onChange={(e) => setRegFirmName(e.target.value)}
                />
                <label htmlFor="regEmailField">Work email</label>
                <input
                  id="regEmailField"
                  type="email"
                  required
                  placeholder={t("emailExample", copyMarket)}
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                />
                <label htmlFor="regPasswordField">Password</label>
                <PasswordWithShow id="regPasswordField">
                  {(type) => (
                    <input
                      id="regPasswordField"
                      type={type}
                      required
                      placeholder="At least 6 characters"
                      minLength={6}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      aria-describedby="register-password-hint"
                    />
                  )}
                </PasswordWithShow>
                <p id="register-password-hint" className="firm-signup-hint">
                  At least 6 characters.
                </p>
                {practiceLocationHint(draftMarket) ? (
                  <p className="firm-signup-hint">{practiceLocationHint(draftMarket)}</p>
                ) : null}
                <button
                  type="submit"
                  id="create-firm"
                  className="btn btn-cobalt"
                  disabled={regBusy || !isDraftComplete(draftMarket)}
                  style={{ width: "100%", justifyContent: "center", marginTop: 20 }}
                >
                  {regBusy ? "Creating your firm account…" : "Create firm account ✦"}
                </button>
                <p
                  style={{
                    textAlign: "center",
                    fontSize: 11,
                    color: "var(--ink-dim)",
                    marginTop: 14,
                    lineHeight: 1.5,
                  }}
                >
                  {firmSignupTrialReminder("Starter")} The AI team prepares the analysis and you
                  review and approve it. By creating an account you agree to the <a href="/terms">Terms</a>.
                </p>
                <p style={{ textAlign: "center", marginTop: 16 }}>
                  <button type="button" className="reg-owner-link" onClick={goToOwnerSpark}>
                    Business owner? Get your own AI finance team →
                  </button>
                </p>
              </>
            ) : (
              <>
                <div style={{ margin: "8px 0 18px" }}>
                  <MarketPicker
                    value={draftMarket}
                    onChange={setDraftMarket}
                    variant="landing"
                    vatCopy={false}
                    taxWording={draftMarket.country === "US"}
                  />
                </div>
                <AccountProviderButtons
                  intent="owner"
                  tone="landing"
                  label="Continue with Google"
                  disabled={regBusy || !isDraftComplete(draftMarket)}
                  next={
                    peekPendingCheckout() ? billingStartPath(peekPendingCheckout()!) : undefined
                  }
                  onError={(msg) => showRegisterError(msg)}
                />
                <AuthDivider />
                <label htmlFor="regNameField">Full name</label>
                <input
                  id="regNameField"
                  type="text"
                  required
                  placeholder={t("nameExample", copyMarket)}
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                />
                <label htmlFor="regEmailField">Work email</label>
                <input
                  id="regEmailField"
                  type="email"
                  required
                  placeholder={t("emailExample", copyMarket)}
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                />
                <label htmlFor="regPasswordField">Password</label>
                <PasswordWithShow id="regPasswordField">
                  {(type) => (
                    <input
                      id="regPasswordField"
                      type={type}
                      required
                      placeholder="At least 6 characters"
                      minLength={6}
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                    />
                  )}
                </PasswordWithShow>
                <label htmlFor="regBusinessField">Business name</label>
                <input
                  id="regBusinessField"
                  type="text"
                  placeholder={t("entityExample", copyMarket)}
                  value={regBusiness}
                  onChange={(e) => setRegBusiness(e.target.value)}
                />
                <label htmlFor="regPlan">Plan</label>
                <select
                  id="regPlan"
                  value={regPlan}
                  onChange={(e) => {
                    const value = e.target.value;
                    setRegPlan(value);
                    const paid = paidPlanFromRegisterLabel(value);
                    if (paid) {
                      stashPendingCheckout({
                        plan: paid,
                        interval: "month",
                        market: visitorCopyPack(draftMarket),
                      });
                    } else {
                      clearPendingCheckout();
                    }
                  }}
                >
                  <option value="Business owner">Business owner</option>
                </select>
                <button
                  type="submit"
                  className="btn btn-cobalt"
                  disabled={regBusy}
                  style={{ width: "100%", justifyContent: "center", marginTop: 28 }}
                >
                  {regBusy
                    ? "Creating your account…"
                    : paidPlanFromRegisterLabel(regPlan)
                      ? `Create account and start ${regPlan}`
                      : "Create owner account"}
                </button>
                <p
                  style={{
                    textAlign: "center",
                    fontSize: 11,
                    color: "var(--ink-dim)",
                    marginTop: 14,
                    lineHeight: 1.5,
                  }}
                >
                  {ownerNote} Accounting firms: {firmSignupTrialReminder("Starter")} By creating an
                  account you agree to the <a href="/terms">Terms</a>.
                </p>
              </>
            )}
          </>
        )}
      </form>
    </div>
  );
}
