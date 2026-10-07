import { lazy, Suspense, useEffect, useId, useRef, type FormEvent } from "react";
import { AuthDivider, GoogleSignInButton } from "@/components/google-sign-in-button";
import { PasswordSignInAlert } from "@/components/password-sign-in-alert";
import { t, type VisitorCopyPack } from "@/lib/market";
import { billingStartPath, peekPendingCheckout } from "@/lib/pending-checkout";
import { readInsightSeen } from "@/lib/funnel-timing";

const PasswordResetPanel = lazy(() =>
  import("./password-reset-panel").then((mod) => ({ default: mod.PasswordResetPanel })),
);

export function LandingSignInModal({
  fpMode,
  fpDone,
  fpEmail,
  fpBusy,
  siEmail,
  siPassword,
  siBusy,
  siError,
  siUnconfirmed,
  resendBusy,
  resendCooldown,
  inviteClientId,
  regClientCode,
  copyMarket,
  onClose,
  onSiEmailChange,
  onSiPasswordChange,
  onSubmit,
  onGoogleError,
  onForgotPassword,
  onFpEmailChange,
  onForgotSubmit,
  onBackToSignIn,
  onResend,
  onCreateAccount,
}: {
  fpMode: boolean;
  fpDone: boolean;
  fpEmail: string;
  fpBusy: boolean;
  siEmail: string;
  siPassword: string;
  siBusy: boolean;
  siError: string;
  siUnconfirmed: boolean;
  resendBusy: boolean;
  resendCooldown: number;
  inviteClientId: string | null;
  regClientCode: string;
  copyMarket: { copyPack: VisitorCopyPack };
  onClose: () => void;
  onSiEmailChange: (value: string) => void;
  onSiPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onGoogleError: (message: string) => void;
  onForgotPassword: () => void;
  onFpEmailChange: (value: string) => void;
  onForgotSubmit: (event: FormEvent) => void;
  onBackToSignIn: () => void;
  onResend: () => void;
  onCreateAccount: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const title = fpMode
    ? fpDone
      ? "Check your email"
      : "Reset password"
    : peekPendingCheckout()
      ? readInsightSeen()
        ? "Sign in to finish firm billing"
        : "Sign in to open your practice"
      : "Sign in to MILŌN";

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = dialogRef.current;
    const focusables = () =>
      root
        ? [
            ...root.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ]
        : [];
    const initial = window.setTimeout(() => {
      const first = focusables()[0];
      (first ?? root)?.focus();
    }, 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(initial);
      document.removeEventListener("keydown", onKey);
      restoreRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div className="milon-signin-modal" onClick={onClose}>
      <div
        ref={dialogRef}
        className="milon-signin-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 24,
          }}
        >
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "1px solid var(--line)",
              background: "transparent",
              color: "var(--ink-dim)",
              cursor: "pointer",
              fontSize: 20,
              display: "grid",
              placeItems: "center",
            }}
          >
            ×
          </button>
        </div>
        {!fpMode && peekPendingCheckout() ? (
          <p style={{ fontSize: 13, color: "var(--ink-dim)", marginBottom: 18, lineHeight: 1.5 }}>
            Sign in with this email to resume Stripe Checkout for your firm. Abandoned Checkout
            does not unlock the accountant workspace.
          </p>
        ) : null}

        {fpMode ? (
          <Suspense fallback={null}>
            <PasswordResetPanel
              done={fpDone}
              email={fpEmail}
              busy={fpBusy}
              error={siError}
              copyMarket={copyMarket}
              onEmailChange={onFpEmailChange}
              onSubmit={onForgotSubmit}
              onBack={onBackToSignIn}
            />
          </Suspense>
        ) : (
          <>
            <GoogleSignInButton
              intent="owner"
              tone="landing"
              disabled={siBusy}
              ownerInvite={
                inviteClientId
                  ? { token: inviteClientId, clientCode: regClientCode.trim() || null }
                  : undefined
              }
              next={
                inviteClientId
                  ? `/?invite=${encodeURIComponent(inviteClientId)}&mode=signup`
                  : peekPendingCheckout()
                    ? billingStartPath(peekPendingCheckout()!)
                    : undefined
              }
              onError={onGoogleError}
            />
            <AuthDivider />
            <form onSubmit={onSubmit} noValidate>
              <div className="field">
                <label htmlFor="si-email">Email</label>
                <input
                  id="si-email"
                  type="text"
                  inputMode="email"
                  autoComplete="username"
                  required
                  placeholder={t("emailExample", copyMarket)}
                  value={siEmail}
                  onChange={(e) => onSiEmailChange(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="si-password">Password</label>
                <input
                  id="si-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  placeholder="••••••••"
                  value={siPassword}
                  onChange={(e) => onSiPasswordChange(e.target.value)}
                />
                <button
                  type="button"
                  onClick={onForgotPassword}
                  style={{
                    display: "block",
                    marginTop: 6,
                    fontSize: 12,
                    color: "var(--ink-dim)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    textAlign: "right",
                    width: "100%",
                    textDecoration: "underline",
                  }}
                >
                  Forgot password?
                </button>
              </div>
              <button
                type="submit"
                className="btn btn-gold"
                disabled={siBusy}
                aria-busy={siBusy}
                style={{ width: "100%", justifyContent: "center", marginTop: 18 }}
              >
                {siBusy ? "Signing in…" : "Sign in ✦"}
              </button>
              <PasswordSignInAlert
                message={siError}
                onForgotPassword={onForgotPassword}
                tone="landing"
              />
              {siUnconfirmed ? (
                <button
                  type="button"
                  disabled={resendBusy || resendCooldown > 0}
                  onClick={onResend}
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: resendCooldown > 0 ? "var(--ink-dim)" : "var(--gold-ink)",
                    background: "none",
                    border: "none",
                    cursor: resendCooldown > 0 ? "default" : "pointer",
                    padding: 0,
                    textDecoration: "underline",
                    fontFamily: "inherit",
                  }}
                >
                  {resendBusy
                    ? "Sending…"
                    : resendCooldown > 0
                      ? `Email sent · resend in ${resendCooldown}s`
                      : "Resend confirmation email"}
                </button>
              ) : null}
            </form>
            <p style={{ marginTop: 18, fontSize: 12, color: "var(--ink-dim)", textAlign: "center" }}>
              Accountant?{" "}
              <a href="/auth" style={{ color: "var(--gold-ink)" }}>
                Sign in to the accountant portal →
              </a>
            </p>
            <p style={{ marginTop: 8, fontSize: 12, color: "var(--ink-dim)", textAlign: "center" }}>
              New here?{" "}
              <button
                type="button"
                onClick={onCreateAccount}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--gold-ink)",
                  cursor: "pointer",
                  fontSize: 12,
                  padding: 0,
                  textDecoration: "underline",
                }}
              >
                Get your free health score
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
