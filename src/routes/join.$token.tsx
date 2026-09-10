import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  acceptAccountantInvite,
  previewAccountantInvite,
  signUpAccountantInvite,
} from "@/lib/accountant-invite.functions";
import { isEmailAlreadyRegistered, waitForAuthSession } from "@/lib/invite-handoff";
import { forcePortal } from "@/lib/user-roles";
import {
  OwnerInviteCard,
  OwnerInviteEyebrow,
  OwnerInviteFieldLabel,
  OwnerInviteInput,
  OwnerInviteNote,
  OwnerInvitePrimaryButton,
  OwnerInviteShell,
} from "@/components/owner-invite-shell";

export const Route = createFileRoute("/join/$token")({
  component: AccountantJoinPage,
  head: () => ({ meta: [{ title: "Join as accountant — Milōn" }] }),
});

function AccountantJoinPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const doPreview = useServerFn(previewAccountantInvite);
  const doSignUp = useServerFn(signUpAccountantInvite);
  const doAccept = useServerFn(acceptAccountantInvite);

  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firmName, setFirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [signInMode, setSignInMode] = useState(false);

  useEffect(() => {
    let alive = true;
    void doPreview({ data: { token } })
      .then((p) => {
        if (!alive) return;
        setClientName(p.clientName);
        setInvitedEmail(p.invitedEmail);
        if (p.invitedEmail) setEmail((prev) => prev || p.invitedEmail || "");
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setPreviewError(err instanceof Error ? err.message : "This invite link is invalid.");
      })
      .finally(() => {
        if (alive) setPreviewLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [doPreview, token]);

  useEffect(() => {
    if (user?.email) setEmail((prev) => prev || user.email || "");
  }, [user?.email]);

  const finish = async () => {
    forcePortal("accountant");
    toast.success("Practice seat ready — opening the accountant portal.");
    await navigate({ to: "/dashboard", replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      forcePortal("accountant");
      const sameAccount =
        Boolean(user) && user?.email?.toLowerCase() === email.trim().toLowerCase();

      if (signInMode || sameAccount) {
        if (!sameAccount) {
          const { error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          });
          if (error) throw error;
          await waitForAuthSession();
        }
        await doAccept({ data: { token, firmName: firmName.trim() || null } });
        await finish();
        return;
      }

      if (password.length < 6) {
        throw new Error("Password must be at least 6 characters.");
      }

      if (user && user.email?.toLowerCase() !== email.trim().toLowerCase()) {
        await supabase.auth.signOut();
      }

      let needsExistingAccept = false;
      try {
        await doSignUp({
          data: {
            token,
            email: email.trim(),
            password,
            fullName: name.trim() || undefined,
            firmName: firmName.trim() || null,
          },
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!isEmailAlreadyRegistered(msg)) throw err;
        needsExistingAccept = true;
      }

      const { error: siErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (siErr) {
        if (needsExistingAccept && /invalid login credentials/i.test(siErr.message)) {
          throw new Error(
            "This email already has a Milōn account. Sign in with your existing password to accept.",
          );
        }
        throw siErr;
      }
      await waitForAuthSession();

      if (needsExistingAccept) {
        await doAccept({ data: { token, firmName: firmName.trim() || null } });
      }
      await finish();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not accept the invite.");
    } finally {
      setBusy(false);
    }
  };

  const sameAccount =
    Boolean(user?.email) && user?.email?.toLowerCase() === email.trim().toLowerCase();

  return (
    <OwnerInviteShell businessName={clientName} loading={previewLoading || authLoading}>
      <OwnerInviteEyebrow>Accountant invitation</OwnerInviteEyebrow>
      <h1 className="mt-2 text-[22px] font-semibold leading-tight tracking-tight text-[#e8ede9]">
        {clientName ? `Join ${clientName}` : "Join a shared workspace"}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-[#8a938c]">
        A business owner invited you as their accountant. You will land in the practice portal,
        linked to this client — not as a second owner.
      </p>

      {previewError ? (
        <div className="mt-5 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
          {previewError}
        </div>
      ) : (
        <OwnerInviteCard className="mt-6">
          {user?.email ? (
            <OwnerInviteNote>
              Signed in as <span className="text-[#e8ede9]">{user.email}</span>. Accepting opens
              the accountant portal for this client.
            </OwnerInviteNote>
          ) : invitedEmail ? (
            <OwnerInviteNote>
              Use <span className="text-[#e8ede9]">{invitedEmail}</span> — the address this invite
              was sent to.
            </OwnerInviteNote>
          ) : (
            <OwnerInviteNote>Create a practice login, or sign in if you already have one.</OwnerInviteNote>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-0">
            {!sameAccount && !signInMode ? (
              <>
                <OwnerInviteFieldLabel htmlFor="accInviteName">Full name</OwnerInviteFieldLabel>
                <OwnerInviteInput
                  id="accInviteName"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </>
            ) : null}

            <OwnerInviteFieldLabel htmlFor="accInviteEmail">Work email</OwnerInviteFieldLabel>
            <OwnerInviteInput
              id="accInviteEmail"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@practice.com"
            />

            {!sameAccount ? (
              <>
                <OwnerInviteFieldLabel htmlFor="accInvitePassword">Password</OwnerInviteFieldLabel>
                <OwnerInviteInput
                  id="accInvitePassword"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                />
              </>
            ) : null}

            {!signInMode ? (
              <>
                <OwnerInviteFieldLabel htmlFor="accInviteFirm">
                  Practice name <span className="normal-case tracking-normal text-[#8a938c]">(optional)</span>
                </OwnerInviteFieldLabel>
                <OwnerInviteInput
                  id="accInviteFirm"
                  type="text"
                  value={firmName}
                  onChange={(e) => setFirmName(e.target.value)}
                  placeholder="Your firm"
                />
              </>
            ) : null}

            <div className="mt-6">
              <OwnerInvitePrimaryButton type="submit" disabled={busy}>
                {busy ? "Accepting…" : "Accept as accountant"}
              </OwnerInvitePrimaryButton>
            </div>
          </form>

          {!user ? (
            <p className="mt-5 text-center text-xs text-[#8a938c]">
              {signInMode ? "Need a new practice login? " : "Already have a Milōn account? "}
              <button
                type="button"
                onClick={() => setSignInMode((v) => !v)}
                className="font-medium text-[#d4a550] underline underline-offset-2"
              >
                {signInMode ? "Create one" : "Sign in"}
              </button>
            </p>
          ) : null}
        </OwnerInviteCard>
      )}
    </OwnerInviteShell>
  );
}
