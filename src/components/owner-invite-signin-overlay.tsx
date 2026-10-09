import { useState } from "react";
import { AuthDivider, GoogleSignInButton } from "@/components/google-sign-in-button";
import { PasswordResetRequest } from "@/components/password-reset-request";
import { PasswordSignInAlert } from "@/components/password-sign-in-alert";
import {
  OwnerInviteCard,
  OwnerInviteFieldLabel,
  OwnerInviteInput,
  OwnerInvitePrimaryButton,
} from "@/components/owner-invite-shell";
import { t } from "@/lib/market/copy";

type Props = {
  open: boolean;
  onClose: () => void;
  inviteToken: string;
  regClientCode: string;
  siEmail: string;
  onSiEmailChange: (v: string) => void;
  siPassword: string;
  onSiPasswordChange: (v: string) => void;
  siBusy: boolean;
  siError: string;
  onSubmit: (e: React.FormEvent) => void;
  onGoogleError: (msg: string) => void;
  copyMarket: { copyPack: ReturnType<typeof import("@/lib/market").visitorCopyPack> };
};

export function OwnerInviteSigninOverlay({
  open,
  onClose,
  inviteToken,
  regClientCode,
  siEmail,
  onSiEmailChange,
  siPassword,
  onSiPasswordChange,
  siBusy,
  siError,
  onSubmit,
  onGoogleError,
  copyMarket,
}: Props) {
  const [resetOpen, setResetOpen] = useState(false);
  if (!open && resetOpen) setResetOpen(false);
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#050507]/90 px-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-labelledby="owner-invite-signin-title"
    >
      <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <OwnerInviteCard>
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a938c]">
                Existing account
              </p>
              <h2
                id="owner-invite-signin-title"
                className="mt-1 text-lg font-semibold text-[#e8ede9]"
              >
                Sign in to accept
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 text-[#8a938c] hover:border-white/20"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {resetOpen ? (
            <PasswordResetRequest
              key={siEmail}
              initialEmail={siEmail}
              variant="overlay"
              onBack={() => setResetOpen(false)}
            />
          ) : (
            <>
              <GoogleSignInButton
                intent="owner"
                tone="portal"
                label="Continue with Google"
                disabled={siBusy}
                ownerInvite={{
                  token: inviteToken,
                  clientCode: regClientCode.trim() || null,
                }}
                next={`/?invite=${encodeURIComponent(inviteToken)}&mode=signup`}
                onError={onGoogleError}
              />
              <AuthDivider label="or use email" />

              <form onSubmit={onSubmit}>
                <OwnerInviteFieldLabel htmlFor="ownerInviteSiEmail">Email</OwnerInviteFieldLabel>
                <OwnerInviteInput
                  id="ownerInviteSiEmail"
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                  placeholder={t("emailExample", copyMarket)}
                  value={siEmail}
                  onChange={(e) => onSiEmailChange(e.target.value)}
                />

                <OwnerInviteFieldLabel htmlFor="ownerInviteSiPassword">
                  Password
                </OwnerInviteFieldLabel>
                <OwnerInviteInput
                  id="ownerInviteSiPassword"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={siPassword}
                  onChange={(e) => onSiPasswordChange(e.target.value)}
                />

                <div className="mt-5">
                  <OwnerInvitePrimaryButton type="submit" disabled={siBusy} aria-busy={siBusy}>
                    {siBusy ? "Signing in…" : "Sign in and accept"}
                  </OwnerInvitePrimaryButton>
                </div>
                <PasswordSignInAlert
                  message={siError}
                  onForgotPassword={() => setResetOpen(true)}
                  tone="overlay"
                />
              </form>
            </>
          )}
        </OwnerInviteCard>
      </div>
    </div>
  );
}
