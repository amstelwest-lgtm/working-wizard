import type { FormEvent } from "react";
import { t, type VisitorCopyPack } from "@/lib/market";

export function PasswordResetPanel({
  done,
  email,
  busy,
  error,
  copyMarket,
  onEmailChange,
  onSubmit,
  onBack,
}: {
  done: boolean;
  email: string;
  busy: boolean;
  error: string;
  copyMarket: { copyPack: VisitorCopyPack };
  onEmailChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  onBack: () => void;
}) {
  if (done) {
    return (
      <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            background: "rgba(212,175,55,.1)",
            display: "grid",
            placeItems: "center",
            margin: "0 auto 18px",
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#d4af37"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        </div>
        <p style={{ fontSize: 14, color: "var(--ink-dim)", lineHeight: 1.6 }}>
          We sent a reset link to <span style={{ color: "var(--gold-ink)" }}>{email}</span>. Check
          your inbox and follow the link to set a new password.
        </p>
        <button
          type="button"
          onClick={onBack}
          style={{
            marginTop: 22,
            fontSize: 12,
            color: "var(--ink-dim)",
            background: "none",
            border: "none",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <p style={{ fontSize: 13, color: "var(--ink-dim)", marginBottom: 18, lineHeight: 1.6 }}>
        Enter your email address and we&apos;ll send you a link to reset your password.
      </p>
      <div className="field">
        <label htmlFor="fp-email">Email</label>
        <input
          id="fp-email"
          type="email"
          required
          autoFocus
          placeholder={t("emailExample", copyMarket)}
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" style={{ fontSize: 13, color: "var(--risk)", margin: "8px 0" }}>
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="btn btn-gold"
        disabled={busy}
        style={{ width: "100%", justifyContent: "center", marginTop: 18 }}
      >
        {busy ? "Sending…" : "Send reset link ✦"}
      </button>
      <p style={{ marginTop: 14, fontSize: 12, color: "var(--ink-dim)", textAlign: "center" }}>
        <button
          type="button"
          onClick={onBack}
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
          Back to sign in
        </button>
      </p>
    </form>
  );
}
