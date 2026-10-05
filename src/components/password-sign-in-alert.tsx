import { INVALID_CREDENTIALS_MESSAGE } from "@/lib/password-sign-in";

type Tone = "entry" | "overlay" | "landing";

/**
 * Inline sign-in failure. Wrong-password copy sits next to Forgot password,
 * which opens the existing reset flow with the address already typed.
 */
export function PasswordSignInAlert({
  message,
  onForgotPassword,
  tone,
}: {
  message: string;
  onForgotPassword?: () => void;
  tone: Tone;
}) {
  if (!message) return null;
  const showForgot = message === INVALID_CREDENTIALS_MESSAGE && Boolean(onForgotPassword);

  if (tone === "entry") {
    return (
      <p id="auth-signin-error" className="auth-entry__error mt-4" role="alert">
        {message}
        {showForgot ? (
          <>
            {" "}
            <button type="button" className="auth-entry__link" onClick={onForgotPassword}>
              Forgot password
            </button>
          </>
        ) : null}
      </p>
    );
  }

  if (tone === "overlay") {
    return (
      <p className="mt-3 text-sm text-rose-300" role="alert">
        {message}
        {showForgot ? (
          <>
            {" "}
            <button
              type="button"
              className="font-medium text-[#d4a550] underline underline-offset-2"
              onClick={onForgotPassword}
            >
              Forgot password
            </button>
          </>
        ) : null}
      </p>
    );
  }

  return (
    <p style={{ fontSize: 13, color: "var(--risk)", margin: "8px 0" }} role="alert">
      {message}
      {showForgot ? (
        <>
          {" "}
          <button
            type="button"
            onClick={onForgotPassword}
            style={{
              background: "none",
              border: "none",
              color: "var(--gold)",
              cursor: "pointer",
              fontSize: 13,
              padding: 0,
              textDecoration: "underline",
              fontFamily: "inherit",
            }}
          >
            Forgot password
          </button>
        </>
      ) : null}
    </p>
  );
}
