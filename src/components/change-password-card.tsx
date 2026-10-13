import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { PasswordWithShow } from "@/components/show-password";
import { supabase } from "@/integrations/supabase/client";

/**
 * Settings change-password. The same card is shown on the owner and accountant
 * views of /settings. Each field starts masked.
 */
export function ChangePasswordCard() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setDone(false);
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
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 border-t border-[var(--line)] pt-4">
      <p className="text-sm font-medium text-[var(--ink)]">Change password</p>
      <div>
        <label className="settings-label" htmlFor="settings-new-password">
          New password
        </label>
        <PasswordWithShow id="settings-new-password">
          {(type) => (
            <input
              id="settings-new-password"
              className="settings-field mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              type={type}
              autoComplete="new-password"
              value={password}
              minLength={8}
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </PasswordWithShow>
      </div>
      <div>
        <label className="settings-label" htmlFor="settings-confirm-password">
          Confirm password
        </label>
        <PasswordWithShow id="settings-confirm-password">
          {(type) => (
            <input
              id="settings-confirm-password"
              className="settings-field mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              type={type}
              autoComplete="new-password"
              value={confirm}
              minLength={8}
              required
              onChange={(event) => setConfirm(event.target.value)}
            />
          )}
        </PasswordWithShow>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-[var(--risk,#e25c5c)]">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-sm text-[var(--ink-dim)]">
          Password updated.
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
