import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { BackLink } from "@/components/back-link";
import { StaffInviteLanding } from "@/components/staff-invite-landing";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { browserAppOrigin } from "@/lib/app-origin";
import { signupLooksAlreadyRegistered, waitForAuthSession } from "@/lib/invite-handoff";
import { clearPendingCheckout } from "@/lib/pending-checkout";
import {
  passwordGrantFailure,
  explainPasswordSignInFailure,
} from "@/lib/password-sign-in";
import {
  previewAccessToken,
  redeemAccessToken,
  type AccessTokenPreview,
} from "@/lib/practice-access.functions";
import {
  staffInviteEmailRedirectTo,
  staffInvitePhase,
  type StaffInvitePhase,
} from "@/lib/staff-invite-landing";
import { forcePortal, setPortalIntent } from "@/lib/user-roles";

export const Route = createFileRoute("/access/$token")({
  component: AccessApprovePage,
  head: () => ({ meta: [{ title: "Approve access — Milōn" }] }),
});

function AccessApprovePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const previewFn = useServerFn(previewAccessToken);
  const redeem = useServerFn(redeemAccessToken);
  const [status, setStatus] = useState<"loading" | "ready" | "done" | "error">("loading");
  const [message, setMessage] = useState("Opening…");
  const [purpose, setPurpose] = useState("");
  const [detail, setDetail] = useState("");
  const [preview, setPreview] = useState<AccessTokenPreview | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preferSignIn, setPreferSignIn] = useState(false);
  const submitLock = useRef(false);
  const acceptLock = useRef<"idle" | "running" | "done">("idle");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const p = await previewFn({ data: { token } });
        if (!alive) return;
        if (!p.purpose) {
          setStatus("error");
          setMessage("This link is invalid.");
          return;
        }
        if (p.purpose !== "firm_invite") {
          if (p.used) {
            setStatus("error");
            setMessage("This link has already been used.");
            return;
          }
          if (p.expired) {
            setStatus("error");
            setMessage("This link has expired.");
            return;
          }
        }
        setPreview(p);
        setPurpose(p.purpose);
        setName((current) => current || (p.memberName ?? "").trim());
        const bits = [p.memberName, p.memberEmail, p.classification, p.clientName, p.firmName].filter(
          Boolean,
        );
        setDetail(bits.join(" · "));
        setStatus("ready");
        setMessage(
          p.purpose === "firm_invite"
            ? "Accept this practice invitation?"
            : "Approve this person on the client file?",
        );
      } catch (e) {
        if (!alive) return;
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "Could not open this link.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [previewFn, token]);

  const acceptStaffInvite = async (userId: string) => {
    if (acceptLock.current === "done" || acceptLock.current === "running") return;
    acceptLock.current = "running";
    setBusy(true);
    setFormError(null);
    try {
      clearPendingCheckout();
      setPortalIntent("accountant");
      forcePortal("accountant");
      const result = await redeem({
        data: { token, decision: "approve", userId },
      });
      acceptLock.current = "done";
      if (!result.accepted) {
        setFormError("Invitation declined.");
        return;
      }
      await navigate({ to: "/dashboard", replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not accept this invitation.";
      if (/already (been )?used|already accepted/i.test(msg)) {
        acceptLock.current = "done";
        clearPendingCheckout();
        setPortalIntent("accountant");
        forcePortal("accountant");
        await navigate({ to: "/dashboard", replace: true });
        return;
      }
      acceptLock.current = "idle";
      setFormError(msg);
    } finally {
      setBusy(false);
    }
  };

  const invitedEmail = preview?.memberEmail?.trim() ?? "";
  const phase: StaffInvitePhase | "joining" | null =
    preview?.purpose === "firm_invite"
      ? acceptLock.current === "running"
        ? "joining"
        : staffInvitePhase({
            expired: preview.expired,
            used: preview.used,
            accountExists: preview.accountExists || preferSignIn,
            signedInEmail: user?.email ?? null,
            invitedEmail,
          })
      : null;

  useEffect(() => {
    if (authLoading || !user?.id || !preview || preview.purpose !== "firm_invite") return;
    if (preview.expired || preview.used) return;
    if (acceptLock.current !== "idle") return;
    const gate = staffInvitePhase({
      expired: preview.expired,
      used: preview.used,
      accountExists: preview.accountExists || preferSignIn,
      signedInEmail: user.email ?? null,
      invitedEmail: preview.memberEmail,
    });
    if (gate !== "auto_accept") return;
    void acceptStaffInvite(user.id);
    // acceptStaffInvite is stable enough for this gate; lock prevents a second redeem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id, user?.email, preview, preferSignIn]);

  const createAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitLock.current || !invitedEmail) return;
    submitLock.current = true;
    setFormError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (password.length < 8) {
        setFormError("Password must be at least 8 characters.");
        return;
      }
      if (user && user.email?.toLowerCase() !== invitedEmail.toLowerCase()) {
        await signOut();
      }
      const { data, error } = await supabase.auth.signUp({
        email: invitedEmail,
        password,
        options: {
          emailRedirectTo: staffInviteEmailRedirectTo(browserAppOrigin(), token),
          data: {
            full_name: name.trim(),
            signup_type: "staff",
          },
        },
      });
      if (signupLooksAlreadyRegistered({ errorMessage: error?.message, user: data?.user })) {
        setPreferSignIn(true);
        setFormError("This email already has a Milōn account. Sign in with your password to accept.");
        return;
      }
      if (error) throw error;
      if (!data.session || !data.user) {
        setNotice(
          "Check your email to confirm this address. The link brings you back here to join the firm.",
        );
        return;
      }
      await waitForAuthSession();
      await acceptStaffInvite(data.user.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not create the account.";
      if (signupLooksAlreadyRegistered({ errorMessage: msg })) {
        setPreferSignIn(true);
        setFormError("This email already has a Milōn account. Sign in with your password to accept.");
        return;
      }
      setFormError(msg);
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };

  const signInToAccept = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitLock.current || !invitedEmail) return;
    submitLock.current = true;
    setFormError(null);
    setNotice(null);
    setBusy(true);
    try {
      const granted = await supabase.auth.signInWithPassword({
        email: invitedEmail,
        password,
      });
      const failure = passwordGrantFailure(granted);
      if (failure) {
        setFormError(failure.message);
        return;
      }
      await waitForAuthSession();
      const userId = granted.data.user?.id;
      if (!userId) throw new Error("Sign-in did not complete.");
      await acceptStaffInvite(userId);
    } catch (err) {
      setFormError(explainPasswordSignInFailure(err).message);
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  };

  const holdForAuth = Boolean(
    preview?.purpose === "firm_invite" && authLoading && !preview.expired && !preview.used,
  );

  if (!holdForAuth && status !== "loading" && phase && preview) {
    const shownPhase =
      acceptLock.current === "running" || (phase === "auto_accept" && !formError) ? "joining" : phase;
    return (
      <StaffInviteLanding
        token={token}
        firmName={preview.firmName}
        memberName={preview.memberName}
        memberEmail={invitedEmail}
        classification={preview.classification}
        phase={shownPhase === "auto_accept" ? "joining" : shownPhase}
        signedInEmail={user?.email ?? null}
        name={name}
        onNameChange={setName}
        password={password}
        onPasswordChange={setPassword}
        busy={busy || shownPhase === "joining"}
        error={formError}
        notice={notice}
        onCreate={(event) => void createAccount(event)}
        onSignIn={(event) => void signInToAccept(event)}
        onSignOut={() => void signOut()}
        onGoogleError={setFormError}
      />
    );
  }

  const title =
    status === "loading" || holdForAuth
      ? "Verifying access"
      : status === "done"
        ? "Complete"
        : purpose === "firm_invite"
          ? "Practice invitation"
          : "Client access";

  const act = async (decision: "approve" | "decline") => {
    setStatus("loading");
    try {
      const { data } = await supabase.auth.getUser();
      const result = await redeem({
        data: { token, decision, userId: data.user?.id },
      });
      setStatus("done");
      if (result.kind === "firm_invite") {
        setMessage(result.accepted ? "You have joined the practice." : "Invitation declined.");
      } else {
        setMessage(result.accepted ? "Access approved." : "Access declined.");
      }
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Could not complete this action.");
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-[#0a0c0b] px-5 pb-10 pt-8 text-[#e8ede9]">
      <div className="mx-auto w-full max-w-md flex-1">
        <header className="mb-8">
          <span className="text-sm font-black tracking-[0.35em] text-[var(--brand-gold-ui)]">MILŌN</span>
        </header>
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a938c]">
          {purpose === "firm_invite" ? "Firm access" : status === "loading" ? "Access" : "Client file"}
        </p>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight">{title}</h1>
        <div className="mt-6 rounded-2xl border border-white/10 bg-[#10130f] p-7 text-center shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
          {status === "loading" || holdForAuth ? (
            <div className="flex flex-col items-center gap-4 py-6">
              <div
                className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--brand-gold-ui)]/25 border-t-[var(--brand-gold-ui)]"
                aria-hidden
              />
              <p className="text-sm text-[#8a938c]">{holdForAuth ? "Opening…" : message}</p>
            </div>
          ) : (
            <>
              <p
                className={`text-sm leading-relaxed ${status === "error" ? "text-rose-300" : "text-[#8a938c]"}`}
              >
                {message}
              </p>
              {detail ? (
                <p className="mt-3 text-xs leading-relaxed text-[#c5b48a]">{detail}</p>
              ) : null}
              {status === "ready" && purpose !== "firm_invite" ? (
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                  <button
                    type="button"
                    onClick={() => void act("approve")}
                    className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-5 text-xs font-bold uppercase tracking-[0.14em] text-[#1b1300] sm:max-w-[160px]"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => void act("decline")}
                    className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-white/15 px-5 text-xs font-bold uppercase tracking-[0.14em] text-[#c9d0cb] sm:max-w-[160px]"
                  >
                    Decline
                  </button>
                </div>
              ) : null}
              {status === "done" ? (
                <BackLink to="/" variant="inline" className="mt-6">
                  Back to Milōn
                </BackLink>
              ) : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
