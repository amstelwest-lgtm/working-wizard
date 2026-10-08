import { useEffect, useState } from "react";
import { AuthDivider, GoogleSignInButton } from "@/components/google-sign-in-button";
import { PasswordResetRequest } from "@/components/password-reset-request";
import { PasswordSignInAlert } from "@/components/password-sign-in-alert";
import {
  OwnerInviteCard,
  OwnerInviteEyebrow,
  OwnerInviteFieldLabel,
  OwnerInviteInput,
  OwnerInviteNote,
  OwnerInvitePrimaryButton,
  OwnerInviteShell,
} from "@/components/owner-invite-shell";
import {
  STAFF_INVITE_INVALID_MESSAGE,
  STAFF_INVITE_USED_MESSAGE,
  staffInviteSignOutLabel,
  type StaffInvitePhase,
} from "@/lib/staff-invite-landing";

export type StaffInviteLandingProps = {
  token: string;
  firmName: string | null;
  memberName: string | null;
  memberEmail: string;
  classification: string | null;
  phase: StaffInvitePhase | "joining";
  signedInEmail?: string | null;
  name: string;
  onNameChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  busy: boolean;
  error: string | null;
  notice: string | null;
  onCreate: (event: React.FormEvent) => void;
  onSignIn: (event: React.FormEvent) => void;
  onSignOut: () => void;
  onGoogleError: (message: string) => void;
};

function LockedEmail({ email }: { email: string }) {
  return (
    <>
      <OwnerInviteFieldLabel htmlFor="staff-invite-email">Email</OwnerInviteFieldLabel>
      <OwnerInviteInput
        id="staff-invite-email"
        type="email"
        name="email"
        value={email}
        readOnly
        aria-readonly="true"
        autoComplete="username"
        onChange={() => {
          /* locked to the invited address */
        }}
      />
      <p className="mt-2 text-[11px] leading-relaxed text-[#8a938c]">
        Locked to this invitation. Use this address to join the firm.
      </p>
    </>
  );
}

export function StaffInviteLanding({
  token,
  firmName,
  memberName,
  memberEmail,
  classification,
  phase,
  signedInEmail,
  name,
  onNameChange,
  password,
  onPasswordChange,
  busy,
  error,
  notice,
  onCreate,
  onSignIn,
  onSignOut,
  onGoogleError,
}: StaffInviteLandingProps) {
  const [resetOpen, setResetOpen] = useState(false);
  const practice = firmName?.trim() || "the practice";
  const role = classification?.trim() || "team member";
  const next = `/access/${token}`;

  useEffect(() => {
    const el = document.documentElement;
    const hadDark = el.classList.contains("dark");
    el.classList.add("dark");
    return () => {
      if (!hadDark) el.classList.remove("dark");
    };
  }, []);

  useEffect(() => {
    if (phase !== "signin") setResetOpen(false);
  }, [phase]);

  return (
    <OwnerInviteShell businessName={firmName}>
      <div data-staff-invite={phase} data-invite-ready="true">
        <OwnerInviteEyebrow>Practice invitation</OwnerInviteEyebrow>
        <h1 className="mt-2 text-[22px] font-semibold leading-tight tracking-tight text-[#e8ede9]">
          {phase === "invalid" || phase === "used" ? "Practice invitation" : `Join ${practice}`}
        </h1>

        {phase === "invalid" ? (
          <OwnerInviteCard className="mt-6">
            <p className="text-sm leading-relaxed text-rose-200" role="alert">
              {STAFF_INVITE_INVALID_MESSAGE}
            </p>
          </OwnerInviteCard>
        ) : null}

        {phase === "used" ? (
          <OwnerInviteCard className="mt-6">
            <p className="text-sm leading-relaxed text-[#8a938c]" role="status">
              {STAFF_INVITE_USED_MESSAGE}
            </p>
          </OwnerInviteCard>
        ) : null}

        {phase === "joining" || phase === "auto_accept" ? (
          <OwnerInviteCard className="mt-6">
            {error ? (
              <p className="text-sm leading-relaxed text-rose-200" role="alert">
                {error}
              </p>
            ) : (
              <div className="flex flex-col items-center gap-4 py-4">
                <div
                  className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--brand-gold-ui)]/25 border-t-[var(--brand-gold-ui)]"
                  aria-hidden
                />
                <p className="text-sm text-[#8a938c]">Joining {practice}…</p>
              </div>
            )}
          </OwnerInviteCard>
        ) : null}

        {phase === "mismatch" ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-[#8a938c]">
              You&apos;re signed in as {signedInEmail}. This invitation is for {memberEmail}.
            </p>
            <OwnerInviteCard className="mt-6">
              <p className="text-sm leading-relaxed text-[#e8b34b]" role="alert">
                You&apos;re signed in as {signedInEmail}. This invitation is for {memberEmail}.
              </p>
              <div className="mt-6">
                <button
                  type="button"
                  onClick={onSignOut}
                  disabled={busy}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-4 py-3 text-center text-[13px] font-bold leading-snug text-[#1b1300] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {staffInviteSignOutLabel(memberEmail)}
                </button>
              </div>
            </OwnerInviteCard>
          </>
        ) : null}

        {phase === "create" || phase === "signin" ? (
          <>
            <p className="mt-3 text-sm leading-relaxed text-[#8a938c]">
              {practice} invited {memberName?.trim() || "you"} to join their Milōn workspace as {role}.
              {phase === "create"
                ? " Create your account with this email address. It takes a minute."
                : " Sign in with this email address to accept."}
            </p>
            <p className="mt-3 text-xs leading-relaxed text-[#c5b48a]">
              {[memberName, memberEmail, classification, firmName].filter(Boolean).join(" · ")}
            </p>
            <OwnerInviteCard className="mt-6">
              {phase === "signin" && resetOpen ? (
                <PasswordResetRequest
                  key={memberEmail}
                  initialEmail={memberEmail}
                  variant="overlay"
                  onBack={() => setResetOpen(false)}
                />
              ) : (
                <>
                  <OwnerInviteNote>
                    {phase === "create"
                      ? "You are joining an existing practice workspace."
                      : "Use the password for this email. Accepting opens the firm workspace."}
                  </OwnerInviteNote>
                  <div className="mt-5">
                    <GoogleSignInButton
                      intent="accountant"
                      tone="portal"
                      label={phase === "create" ? "Continue with Google" : "Sign in with Google"}
                      disabled={busy}
                      next={next}
                      onError={onGoogleError}
                    />
                  </div>
                  <AuthDivider label="or use email" />
                  <form onSubmit={phase === "create" ? onCreate : onSignIn}>
                    {phase === "create" ? (
                      <>
                        <OwnerInviteFieldLabel htmlFor="staff-invite-name">Full name</OwnerInviteFieldLabel>
                        <OwnerInviteInput
                          id="staff-invite-name"
                          type="text"
                          name="name"
                          required
                          autoComplete="name"
                          value={name}
                          onChange={(event) => onNameChange(event.target.value)}
                        />
                      </>
                    ) : null}
                    <LockedEmail email={memberEmail} />
                    <OwnerInviteFieldLabel htmlFor="staff-invite-password">Password</OwnerInviteFieldLabel>
                    <OwnerInviteInput
                      id="staff-invite-password"
                      type="password"
                      name="password"
                      required
                      minLength={phase === "create" ? 8 : undefined}
                      autoComplete={phase === "create" ? "new-password" : "current-password"}
                      value={password}
                      onChange={(event) => onPasswordChange(event.target.value)}
                      aria-describedby={phase === "create" ? "staff-invite-password-hint" : undefined}
                    />
                    {phase === "create" ? (
                      <p id="staff-invite-password-hint" className="mt-2 text-[11px] text-[#8a938c]">
                        At least 8 characters.
                      </p>
                    ) : null}
                    {notice ? (
                      <p className="mt-4 text-sm leading-relaxed text-[#c5b48a]" role="status">
                        {notice}
                      </p>
                    ) : null}
                    {phase === "signin" ? (
                      <PasswordSignInAlert
                        message={error ?? ""}
                        onForgotPassword={() => setResetOpen(true)}
                        tone="overlay"
                      />
                    ) : error ? (
                      <p className="mt-4 text-sm text-rose-200" role="alert">
                        {error}
                      </p>
                    ) : null}
                    <div className="mt-6">
                      <OwnerInvitePrimaryButton type="submit" disabled={busy} aria-busy={busy}>
                        {busy
                          ? phase === "create"
                            ? "Creating your account…"
                            : "Signing in…"
                          : phase === "create"
                            ? "Create your account"
                            : "Sign in to accept"}
                      </OwnerInvitePrimaryButton>
                    </div>
                  </form>
                  {phase === "create" ? (
                    <p className="mt-5 text-center text-[11px] leading-relaxed text-[#8a938c]">
                      By joining you agree to the{" "}
                      <a href="/terms" className="underline underline-offset-2">
                        Terms
                      </a>
                      .{" "}
                      <a href="/privacy" className="underline underline-offset-2">
                        Privacy
                      </a>
                    </p>
                  ) : null}
                </>
              )}
            </OwnerInviteCard>
          </>
        ) : null}
      </div>
    </OwnerInviteShell>
  );
}
