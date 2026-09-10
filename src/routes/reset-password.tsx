import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BackLink } from "@/components/back-link";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AuthEntryCard,
  AuthEntryFieldLabel,
  AuthEntryInput,
  AuthEntryLead,
  AuthEntryLink,
  AuthEntryPrimaryButton,
  AuthEntryShell,
  AuthEntrySuccessIcon,
  AuthEntryTitle,
} from "@/components/auth-entry-shell";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
  head: () => ({
    meta: [{ title: "Reset password — MILŌN" }],
  }),
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);

  /* Supabase sends the recovery token in the URL hash.
     The client picks it up via onAuthStateChange with event = PASSWORD_RECOVERY. */
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setDone(true);
      setTimeout(() => navigate({ to: "/" }), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthEntryShell>
      <AuthEntryCard>
        {done ? (
          <div className="text-center">
            <AuthEntrySuccessIcon />
            <AuthEntryTitle>Password updated</AuthEntryTitle>
            <AuthEntryLead>
              Your password has been changed. Redirecting you to the home page…
            </AuthEntryLead>
          </div>
        ) : !ready ? (
          <div className="text-center">
            <AuthEntryTitle>Set a new password</AuthEntryTitle>
            <AuthEntryLead>
              Verifying your reset link… If nothing happens, the link may have expired.{" "}
              <AuthEntryLink href="/">Go home</AuthEntryLink>
            </AuthEntryLead>
          </div>
        ) : (
          <>
            <AuthEntryTitle>Set a new password</AuthEntryTitle>
            <AuthEntryLead>Choose a strong password of at least 8 characters.</AuthEntryLead>
            <form onSubmit={handleSubmit} className="mt-6">
              <AuthEntryFieldLabel htmlFor="reset-password">New password</AuthEntryFieldLabel>
              <AuthEntryInput
                id="reset-password"
                type="password"
                required
                autoFocus
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <AuthEntryFieldLabel htmlFor="reset-confirm">Confirm password</AuthEntryFieldLabel>
              <AuthEntryInput
                id="reset-confirm"
                type="password"
                required
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {error ? <p className="auth-entry__error">{error}</p> : null}
              <AuthEntryPrimaryButton type="submit" className="mt-6" disabled={busy}>
                {busy ? "Updating…" : "Update password ✦"}
              </AuthEntryPrimaryButton>
            </form>
          </>
        )}

        <p className="auth-entry__footnote mt-6">
          <BackLink href="/" variant="inline" className="mt-0 !text-[var(--brand-gold-ui)] !no-underline">
            Back to Milōn
          </BackLink>
        </p>
      </AuthEntryCard>
    </AuthEntryShell>
  );
}
