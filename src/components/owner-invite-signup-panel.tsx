import { AuthDivider, GoogleSignInButton } from "@/components/google-sign-in-button";
import {
  OwnerInviteCard,
  OwnerInviteEyebrow,
  OwnerInviteFieldLabel,
  OwnerInviteInput,
  OwnerInviteNote,
  OwnerInvitePrimaryButton,
} from "@/components/owner-invite-shell";
import { t } from "@/lib/market";

export type OwnerInviteSignupPanelProps = {
  inviteToken: string;
  businessName: string | null;
  inviteNeedsCode: boolean;
  inviteIsLegacyUuid: boolean;
  regClientCode: string;
  onRegClientCodeChange: (value: string) => void;
  regName: string;
  onRegNameChange: (value: string) => void;
  regEmail: string;
  onRegEmailChange: (value: string) => void;
  regPassword: string;
  onRegPasswordChange: (value: string) => void;
  regBusy: boolean;
  signedInEmail?: string | null;
  copyMarket: { copyPack: ReturnType<typeof import("@/lib/market").visitorCopyPack> };
  onSubmit: (e: React.FormEvent) => void;
  onSignInClick: () => void;
  onGoogleError: (msg: string) => void;
  previewError?: string | null;
};

export function OwnerInviteSignupPanel({
  inviteToken,
  businessName,
  inviteNeedsCode,
  inviteIsLegacyUuid,
  regClientCode,
  onRegClientCodeChange,
  regName,
  onRegNameChange,
  regEmail,
  onRegEmailChange,
  regPassword,
  onRegPasswordChange,
  regBusy,
  signedInEmail,
  copyMarket,
  onSubmit,
  onSignInClick,
  onGoogleError,
  previewError,
}: OwnerInviteSignupPanelProps) {
  const sameAccount =
    Boolean(signedInEmail) && signedInEmail?.toLowerCase() === regEmail.trim().toLowerCase();

  return (
    <>
      <OwnerInviteEyebrow>Workspace invitation</OwnerInviteEyebrow>
      <h1 className="mt-2 text-[22px] font-semibold leading-tight tracking-tight text-[#e8ede9]">
        {businessName ? `Join ${businessName}` : "Join your business workspace"}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[#8a938c]">
        Your accountant invited you to view and sign off on your business numbers. Create an account
        or sign in to accept — your workspace is already set up.
      </p>

      {previewError ? (
        <div className="mt-5 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
          {previewError}
        </div>
      ) : null}

      <OwnerInviteCard className="mt-6">
        {signedInEmail ? (
          <OwnerInviteNote>
            Signed in as <span className="text-[#e8ede9]">{signedInEmail}</span>.
            {signedInEmail.toLowerCase() !== regEmail.trim().toLowerCase() && regEmail
              ? ` Accepting will attach the workspace to ${regEmail}.`
              : " Accepting will open your owner workspace."}
          </OwnerInviteNote>
        ) : (
          <OwnerInviteNote>
            Use the email address your accountant sent the invitation to.
          </OwnerInviteNote>
        )}

        {inviteIsLegacyUuid ? (
          <p className="mt-3 text-xs leading-relaxed text-[#e8b34b]">
            This link uses an older format. It still works — ask your accountant for a fresh invite
            when convenient.
          </p>
        ) : null}

        {inviteNeedsCode ? (
          <>
            <OwnerInviteFieldLabel htmlFor="ownerInviteClientCode">Client code</OwnerInviteFieldLabel>
            <OwnerInviteInput
              id="ownerInviteClientCode"
              type="text"
              required
              autoCapitalize="characters"
              placeholder="MLN-XXXXXX"
              value={regClientCode}
              onChange={(e) => onRegClientCodeChange(e.target.value.toUpperCase())}
            />
            <p className="mt-2 text-[11px] text-[#8a938c]">
              From your invite email, next to the claim link.
            </p>
          </>
        ) : null}

        <div className="mt-5">
          <GoogleSignInButton
            intent="owner"
            tone="portal"
            label="Continue with Google"
            disabled={regBusy || (inviteNeedsCode && !regClientCode.trim())}
            ownerInvite={{
              token: inviteToken,
              clientCode: regClientCode.trim() || null,
            }}
            next={`/?invite=${encodeURIComponent(inviteToken)}&mode=signup`}
            onError={onGoogleError}
          />
        </div>
        <AuthDivider label="or use email" />

        <form onSubmit={onSubmit} className="space-y-0">
          <OwnerInviteFieldLabel htmlFor="ownerInviteName">Full name</OwnerInviteFieldLabel>
          <OwnerInviteInput
            id="ownerInviteName"
            type="text"
            required={!sameAccount}
            placeholder={t("nameExample", copyMarket)}
            value={regName}
            onChange={(e) => onRegNameChange(e.target.value)}
          />

          <OwnerInviteFieldLabel htmlFor="ownerInviteEmail">Work email</OwnerInviteFieldLabel>
          <OwnerInviteInput
            id="ownerInviteEmail"
            type="email"
            required
            placeholder={t("emailExample", copyMarket)}
            value={regEmail}
            onChange={(e) => onRegEmailChange(e.target.value)}
          />

          {!sameAccount ? (
            <>
              <OwnerInviteFieldLabel htmlFor="ownerInvitePassword">Password</OwnerInviteFieldLabel>
              <OwnerInviteInput
                id="ownerInvitePassword"
                type="password"
                required
                placeholder="At least 6 characters"
                minLength={6}
                value={regPassword}
                onChange={(e) => onRegPasswordChange(e.target.value)}
              />
            </>
          ) : null}

          <div className="mt-6">
            <OwnerInvitePrimaryButton type="submit" disabled={regBusy}>
              {regBusy ? "Accepting invitation…" : "Accept invitation"}
            </OwnerInvitePrimaryButton>
          </div>
        </form>

        {!signedInEmail ? (
          <p className="mt-5 text-center text-xs text-[#8a938c]">
            Already have an account?{" "}
            <button
              type="button"
              onClick={onSignInClick}
              className="font-medium text-[#d4a550] underline underline-offset-2"
            >
              Sign in
            </button>
          </p>
        ) : null}

        <p className="mt-5 text-center text-[11px] leading-relaxed text-[#8a938c]">
          By joining you agree to the{" "}
          <a href="/terms" className="underline underline-offset-2">
            Terms
          </a>
          . AI is powered by Claude; financial information sent to it is anonymised.{" "}
          <a href="/privacy" className="underline underline-offset-2">
            Privacy
          </a>
          {" · "}
          <a href="/ai" className="underline underline-offset-2">
            AI notice
          </a>
        </p>
      </OwnerInviteCard>
    </>
  );
}
