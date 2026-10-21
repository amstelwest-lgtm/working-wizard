import { useState } from "react";
import {
  AuthEntryFieldLabel,
  AuthEntryGhostButton,
  AuthEntryInput,
} from "@/components/auth-entry-shell";
import {
  EMAIL_SIGN_IN_CODE_INSTEAD,
  EMAIL_SIGN_IN_TAP_LINK,
  emailCodeFallbackEnabled,
  requestEmailSignInLink,
  verifyEmailSignInCode,
  type EmailSignInDoor,
  type EmailSignInNotice,
} from "@/lib/email-sign-in";

/**
 * "Email me a sign-in link" plus the 6-digit code fallback.
 * Shared by /auth (accountant) and the landing sign-in modal (owner).
 */
export function EmailSignInOption({
  email,
  door,
  tone,
  disabled = false,
  next,
  onSignedIn,
}: {
  email: string;
  door: EmailSignInDoor;
  tone: "entry" | "landing";
  disabled?: boolean;
  next?: string | null;
  /** When set, the caller lands the session. Otherwise the owner door uses the shared resolver. */
  onSignedIn?: (user: {
    id: string;
    user_metadata: Record<string, unknown>;
  }) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<EmailSignInNotice | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const showCode = Boolean(notice?.offerCode) && emailCodeFallbackEnabled();
  const codeId = tone === "entry" ? "auth-email-code" : "si-email-code";

  const send = async () => {
    if (busy || disabled) return;
    setBusy(true);
    setCodeError("");
    try {
      const origin = window.location.origin;
      const result = await requestEmailSignInLink({ email, door, origin, next });
      setNotice(result);
    } catch {
      setNotice({
        kind: "failed",
        message: "Could not send the sign-in email. Try again.",
        offerCode: false,
      });
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (busy || disabled) return;
    setBusy(true);
    setCodeError("");
    try {
      const result = await verifyEmailSignInCode({ email, token: code });
      if (!result.ok) {
        setCodeError(result.message);
        return;
      }
      if (onSignedIn) {
        await onSignedIn({ id: result.userId, user_metadata: result.meta });
      }
    } catch {
      setCodeError("That code didn't work. Request a new sign-in link and try again.");
    } finally {
      setBusy(false);
    }
  };

  const status = notice?.message ?? "";

  if (tone === "entry") {
    return (
      <div className="mt-4">
        <AuthEntryGhostButton type="button" disabled={busy || disabled} onClick={() => void send()}>
          {busy && !showCode ? "Sending…" : "Email me a sign-in link"}
        </AuthEntryGhostButton>
        {notice?.kind === "sent" ? (
          <div className="mt-3" role="status">
            <p className="auth-entry__lead">{EMAIL_SIGN_IN_TAP_LINK}</p>
            {status ? <p className="auth-entry__lead mt-2">{status}</p> : null}
          </div>
        ) : null}
        {status && notice?.kind !== "sent" ? (
          <p className="auth-entry__lead mt-3" role="status">
            {status}
          </p>
        ) : null}
        {showCode ? (
          <details className="mt-4">
            <summary className="auth-entry__lead cursor-pointer list-none underline">
              {EMAIL_SIGN_IN_CODE_INSTEAD}
            </summary>
            <div className="mt-4">
              <AuthEntryFieldLabel htmlFor={codeId}>Enter the 6-digit code</AuthEntryFieldLabel>
              <AuthEntryInput
                id={codeId}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
                  setCodeError("");
                }}
              />
              <AuthEntryGhostButton
                type="button"
                className="mt-3"
                disabled={busy || disabled || code.length !== 6}
                onClick={() => void verify()}
              >
                {busy ? "Signing in…" : "Sign in with code"}
              </AuthEntryGhostButton>
              {codeError ? (
                <p className="auth-entry__lead mt-3" role="status">
                  {codeError}
                </p>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14 }}>
      <button
        type="button"
        onClick={() => void send()}
        disabled={busy || disabled}
        style={{
          display: "block",
          width: "100%",
          fontSize: 13,
          color: "var(--ink-dim)",
          background: "none",
          border: "none",
          cursor: busy || disabled ? "default" : "pointer",
          padding: 0,
          textAlign: "center",
          textDecoration: "underline",
          fontFamily: "inherit",
        }}
      >
        {busy && !showCode ? "Sending…" : "Email me a sign-in link"}
      </button>
      {notice?.kind === "sent" ? (
        <div role="status" style={{ marginTop: 10 }}>
          <p style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5 }}>
            {EMAIL_SIGN_IN_TAP_LINK}
          </p>
          {status ? (
            <p style={{ marginTop: 6, fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5 }}>
              {status}
            </p>
          ) : null}
        </div>
      ) : null}
      {status && notice?.kind !== "sent" ? (
        <p
          role="status"
          style={{ marginTop: 10, fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5 }}
        >
          {status}
        </p>
      ) : null}
      {showCode ? (
        <details style={{ marginTop: 12 }}>
          <summary
            style={{
              cursor: "pointer",
              listStyle: "none",
              fontSize: 13,
              color: "var(--ink-dim)",
              textDecoration: "underline",
            }}
          >
            {EMAIL_SIGN_IN_CODE_INSTEAD}
          </summary>
          <div style={{ marginTop: 12 }}>
          <label htmlFor={codeId} style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
            Enter the 6-digit code
          </label>
          <input
            id={codeId}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
              setCodeError("");
            }}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid var(--line)",
              background: "var(--bg-2)",
              color: "var(--ink)",
              letterSpacing: "0.3em",
            }}
          />
          <button
            type="button"
            className="btn btn-cobalt"
            disabled={busy || disabled || code.length !== 6}
            onClick={() => void verify()}
            style={{ width: "100%", justifyContent: "center", marginTop: 12 }}
          >
            {busy ? "Signing in…" : "Sign in with code"}
          </button>
          {codeError ? (
            <p role="status" style={{ marginTop: 8, fontSize: 13, color: "var(--ink-dim)" }}>
              {codeError}
            </p>
          ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
