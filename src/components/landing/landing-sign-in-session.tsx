/**
 * Landing sign-in modal for public marketing pages.
 * Loaded only after Sign in is clicked. Supabase attaches on that click
 * (wakeAuth) and again inside the password grant — not on first paint.
 */
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { wakeAuth } from "@/hooks/use-auth";
import { browserAppUrl } from "@/lib/app-origin";
import { readInsightSeen } from "@/lib/funnel-timing";
import { resolveSignedInDestination } from "@/lib/landing-sign-in-destination";
import { settleWithin } from "@/lib/bounded-load";
import {
  finishOwnerSignIn,
  POST_AUTH_DEADLINE_MS,
  POST_AUTH_TIMEOUT_MESSAGE,
} from "@/lib/post-auth-landing";
import type { VisitorCopyPack } from "@/lib/market";
import { explainPasswordSignInFailure } from "@/lib/password-sign-in";
import {
  billingStartSearch,
  checkoutEmailRedirectTo,
  consumeResumeFirmBilling,
  parsePendingCheckoutFromSearch,
  peekPendingCheckout,
  stashPendingCheckout,
} from "@/lib/pending-checkout";
import { checkoutIntentForUser } from "@/lib/billing-market";
import { decidePostLoginBillingResume } from "@/lib/stripe-entitlement";

const LandingSignInModal = lazy(() =>
  import("@/components/landing/sign-in-modal").then((mod) => ({
    default: mod.LandingSignInModal,
  })),
);

async function landingSupabase() {
  wakeAuth();
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase;
}

export function LandingSignInSession({
  onClose,
  createAccountHref = "/?signup=owner#register",
  copyPack = "us",
}: {
  onClose: () => void;
  /** Same create-account target as the homepage modal: the register section. */
  createAccountHref?: string;
  /** Server geo pack. Defaults to US so a stored market cannot open rand copy. */
  copyPack?: VisitorCopyPack;
}) {
  const navigate = useNavigate();
  const copyMarket = { copyPack };
  const [fpMode, setFpMode] = useState(false);
  const [fpDone, setFpDone] = useState(false);
  const [fpEmail, setFpEmail] = useState("");
  const [fpBusy, setFpBusy] = useState(false);
  const [siEmail, setSiEmail] = useState("");
  const [siPassword, setSiPassword] = useState("");
  const [siBusy, setSiBusy] = useState(false);
  const [siError, setSiError] = useState("");
  const [siUnconfirmed, setSiUnconfirmed] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const submitLock = useRef(false);

  useEffect(() => {
    wakeAuth();
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  const paidSignupRedirectTo = () => {
    const pending = peekPendingCheckout();
    return pending
      ? checkoutEmailRedirectTo(window.location.origin, pending)
      : browserAppUrl("/app");
  };

  const landOwnerSession = async (userId: string, knownMeta: Record<string, unknown>) => {
    const storedPending =
      peekPendingCheckout() ?? parsePendingCheckoutFromSearch(window.location.search);
    let pendingCheckout: Awaited<ReturnType<typeof checkoutIntentForUser>> | null = null;
    if (storedPending) {
      const intent = await settleWithin(
        checkoutIntentForUser(userId, storedPending, copyPack),
        POST_AUTH_DEADLINE_MS,
      );
      if (intent.status !== "value") {
        setSiError(POST_AUTH_TIMEOUT_MESSAGE);
        return;
      }
      pendingCheckout = intent.value;
    }
    if (pendingCheckout) {
      consumeResumeFirmBilling();
      stashPendingCheckout(pendingCheckout);
      const { setPortalIntent } = await import("@/lib/user-roles");
      setPortalIntent("accountant");
      const { activeFirmIdForUser } = await import("@/lib/firm-brand");
      const insightFirm = await settleWithin(activeFirmIdForUser(userId), POST_AUTH_DEADLINE_MS);
      const insightFirmId = insightFirm.status === "value" ? insightFirm.value : null;
      if (readInsightSeen(insightFirmId)) {
        void navigate({
          to: "/billing/start",
          search: billingStartSearch(pendingCheckout),
          replace: true,
        });
      } else {
        void navigate({ to: "/dashboard", replace: true });
      }
      return;
    }

    const resumeFirmBilling = consumeResumeFirmBilling();
    if (resumeFirmBilling) {
      const { listUserFirms, readActiveFirmId } = await import("@/lib/firm-brand");
      const firmRead = await settleWithin(listUserFirms(userId), POST_AUTH_DEADLINE_MS);
      if (firmRead.status !== "value") {
        setSiError(POST_AUTH_TIMEOUT_MESSAGE);
        return;
      }
      const firms = firmRead.value;
      const ownsFirm = firms.some((f) => f.owner_user_id === userId);
      const preferred = readActiveFirmId(userId);
      const insightFirmId =
        firms.find((f) => f.id === preferred)?.id ??
        firms.find((f) => f.owner_user_id === userId)?.id ??
        null;
      const resume = decidePostLoginBillingResume({
        hasPendingFirmCheckout: false,
        ownsFirm,
        resumeFirmBilling: true,
        insightSeen: readInsightSeen(insightFirmId),
      });
      if (resume === "workspace") {
        const { setPortalIntent } = await import("@/lib/user-roles");
        setPortalIntent("accountant");
        void navigate({ to: "/dashboard", replace: true });
        return;
      }
      if (resume) {
        const pending = await checkoutIntentForUser(userId, peekPendingCheckout(), copyPack);
        stashPendingCheckout(pending);
        const { setPortalIntent } = await import("@/lib/user-roles");
        setPortalIntent("accountant");
        void navigate({
          to: resume === "billing_start" ? "/billing/start" : "/billing/required",
          search: billingStartSearch(pending),
          replace: true,
        });
        return;
      }
    }

    const settled = await finishOwnerSignIn({
      readDestination: () =>
        resolveSignedInDestination(userId, {
          door: "landing",
          knownMeta,
        }),
    });
    if (settled.status === "retry") {
      setSiError(POST_AUTH_TIMEOUT_MESSAGE);
      return;
    }
    void navigate({ to: settled.path, replace: true });
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSiError("");
    setSiUnconfirmed(false);
    setSiBusy(true);
    try {
      const id = siEmail.trim().toLowerCase();
      if (!id.includes("@")) {
        throw new Error("Enter a valid email address.");
      }
      const granted = await (
        await landingSupabase()
      ).auth.signInWithPassword({
        email: siEmail,
        password: siPassword,
      });
      if (granted.error) {
        const failure = explainPasswordSignInFailure(granted.error);
        setSiUnconfirmed(failure.kind === "email_not_confirmed");
        setSiError(failure.message);
        return;
      }
      setSiUnconfirmed(false);
      const { waitForAuthSession } = await import("@/lib/invite-handoff");
      await waitForAuthSession();
      const userId = granted.data.user?.id;
      if (!userId) {
        void navigate({ to: "/app", replace: true });
        return;
      }
      await landOwnerSession(
        userId,
        (granted.data.user?.user_metadata as Record<string, unknown> | undefined) ?? {},
      );
    } catch (err: unknown) {
      const failure = explainPasswordSignInFailure(err);
      setSiUnconfirmed(failure.kind === "email_not_confirmed");
      setSiError(
        failure.kind === "other"
          ? err instanceof Error
            ? err.message
            : "Sign in failed"
          : failure.message,
      );
    } finally {
      submitLock.current = false;
      setSiBusy(false);
    }
  };

  return (
    <Suspense fallback={null}>
      <LandingSignInModal
        fpMode={fpMode}
        fpDone={fpDone}
        fpEmail={fpEmail}
        fpBusy={fpBusy}
        siEmail={siEmail}
        siPassword={siPassword}
        siBusy={siBusy}
        siError={siError}
        siUnconfirmed={siUnconfirmed}
        resendBusy={resendBusy}
        resendCooldown={resendCooldown}
        inviteClientId={null}
        regClientCode=""
        copyMarket={copyMarket}
        onClose={() => {
          setFpMode(false);
          setFpDone(false);
          setSiError("");
          onClose();
        }}
        onSiEmailChange={(value) => {
          setSiEmail(value);
          setSiError("");
        }}
        onSiPasswordChange={(value) => {
          setSiPassword(value);
          setSiError("");
        }}
        onSubmit={(event) => void onSubmit(event)}
        onGoogleError={(message) => setSiError(message)}
        onForgotPassword={() => {
          setFpEmail(siEmail);
          setFpMode(true);
          setFpDone(false);
          setSiError("");
          setSiUnconfirmed(false);
        }}
        onFpEmailChange={setFpEmail}
        onForgotSubmit={(event) => {
          event.preventDefault();
          setFpBusy(true);
          void (async () => {
            try {
              const { error } = await (
                await landingSupabase()
              ).auth.resetPasswordForEmail(fpEmail, {
                redirectTo: browserAppUrl("/reset-password"),
              });
              if (error) throw error;
              setFpDone(true);
            } catch (err: unknown) {
              const failure = explainPasswordSignInFailure(err);
              setSiError(
                failure.kind === "other"
                  ? err instanceof Error
                    ? err.message
                    : "Could not send reset email"
                  : failure.message,
              );
            } finally {
              setFpBusy(false);
            }
          })();
        }}
        onBackToSignIn={() => {
          setFpMode(false);
          setFpDone(false);
          setSiError("");
        }}
        onResend={() => {
          const target = siEmail.trim();
          if (!target) return;
          setResendBusy(true);
          void (async () => {
            try {
              const { error } = await (
                await landingSupabase()
              ).auth.resend({
                type: "signup",
                email: target,
                options: { emailRedirectTo: paidSignupRedirectTo() },
              });
              if (error) throw error;
              toast.success(`Confirmation email sent to ${target}`);
              setResendCooldown(60);
            } catch (err: unknown) {
              toast.error(err instanceof Error ? err.message : "Could not resend the email.");
            } finally {
              setResendBusy(false);
            }
          })();
        }}
        onCreateAccount={() => {
          window.location.assign(createAccountHref);
        }}
        onEmailSignedIn={(user) => landOwnerSession(user.id, user.user_metadata)}
      />
    </Suspense>
  );
}
