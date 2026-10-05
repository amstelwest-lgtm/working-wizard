import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { explainPasswordSignInFailure } from "@/lib/password-sign-in";
import { PasswordSignInAlert } from "@/components/password-sign-in-alert";
import {
  AuthEntryFieldLabel,
  AuthEntryInput,
  AuthEntryLead,
  AuthEntryPrimaryButton,
} from "@/components/auth-entry-shell";
import {
  OwnerInviteFieldLabel,
  OwnerInviteInput,
  OwnerInvitePrimaryButton,
} from "@/components/owner-invite-shell";

/**
 * Same reset GoTrue call as the landing sign-in modal: email a link to
 * `/reset-password`, with the address the person already typed.
 */
export function PasswordResetRequest({
  initialEmail,
  onBack,
  variant,
}: {
  initialEmail: string;
  onBack: () => void;
  variant: "entry" | "overlay";
}) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const inputId = variant === "entry" ? "auth-reset-email" : "overlay-reset-email";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (resetError) {
        setError(explainPasswordSignInFailure(resetError).message);
        return;
      }
      setDone(true);
    } catch (err: unknown) {
      setError(explainPasswordSignInFailure(err).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    if (variant === "entry") {
      return (
        <div>
          <p className="auth-entry__title">Check your email</p>
          <AuthEntryLead>
            We sent a reset link to {email}. Open it to choose a new password.
          </AuthEntryLead>
          <button type="button" className="auth-entry__link mt-4" onClick={onBack}>
            Back to sign in
          </button>
        </div>
      );
    }
    return (
      <div>
        <h2 className="text-lg font-semibold text-[#e8ede9]">Check your email</h2>
        <p className="mt-3 text-sm leading-relaxed text-[#8a938c]">
          We sent a reset link to <span className="text-[#e8ede9]">{email}</span>. Open it to choose
          a new password.
        </p>
        <button
          type="button"
          className="mt-4 text-sm font-medium text-[#d4a550] underline underline-offset-2"
          onClick={onBack}
        >
          Back to sign in
        </button>
      </div>
    );
  }

  if (variant === "entry") {
    return (
      <form onSubmit={(e) => void submit(e)}>
        <p className="auth-entry__lead">
          We&apos;ll email a reset link to this address. It opens the password reset page.
        </p>
        <AuthEntryFieldLabel htmlFor={inputId}>Email</AuthEntryFieldLabel>
        <AuthEntryInput
          id={inputId}
          type="email"
          required
          autoFocus
          autoComplete="username"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError("");
          }}
        />
        <PasswordSignInAlert message={error} tone="entry" />
        <AuthEntryPrimaryButton type="submit" className="mt-6" disabled={busy} aria-busy={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </AuthEntryPrimaryButton>
        <button type="button" className="auth-entry__link mt-4" onClick={onBack}>
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <p className="text-sm leading-relaxed text-[#8a938c]">
        We&apos;ll email a reset link to this address.
      </p>
      <OwnerInviteFieldLabel htmlFor={inputId}>Email</OwnerInviteFieldLabel>
      <OwnerInviteInput
        id={inputId}
        type="email"
        required
        autoFocus
        autoComplete="username"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          setError("");
        }}
      />
      <PasswordSignInAlert message={error} tone="overlay" />
      <div className="mt-5">
        <OwnerInvitePrimaryButton type="submit" disabled={busy} aria-busy={busy}>
          {busy ? "Sending…" : "Send reset link"}
        </OwnerInvitePrimaryButton>
      </div>
      <button
        type="button"
        className="mt-4 text-sm font-medium text-[#d4a550] underline underline-offset-2"
        onClick={onBack}
      >
        Back to sign in
      </button>
    </form>
  );
}
