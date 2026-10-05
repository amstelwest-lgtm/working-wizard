import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PreLoginShareButton } from "@/components/share";
import { useState, useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { notifySignup } from "@/lib/signup-notify";
import { ensurePracticePortalAccess } from "@/lib/auth.functions";
import {
  forcePortal,
  setPortalIntent,
  resolvePostLoginPath,
  clearForcePortal,
  shouldOpenItInbox,
} from "@/lib/user-roles";
import { isOpsNext, lighthouseTabFromOpsNext } from "@/lib/client-note-link";
import {
  billingStartPath,
  billingStartSearch,
  checkoutEmailRedirectTo,
  clearPendingCheckout,
  FIRM_BILLING_SIGNIN_MESSAGE,
  isBillingStartPath,
  peekPendingCheckout,
  stashPendingCheckout,
  stashResumeFirmBilling,
  type PendingCheckout,
} from "@/lib/pending-checkout";
import { decideAccountantAuthLanding, safeAccountantRedirect } from "@/lib/auth-landing";
import { listUserFirms } from "@/lib/firm-brand";
import { getFirmBillingEntitlement } from "@/lib/stripe-checkout.functions";
import { practiceLocationHint } from "@/lib/firm-signup-copy";
import { FirmSignupTerms } from "@/components/firm-signup-terms";
import {
  isFirmCheckoutBand,
  isFirmInterval,
  type FirmCheckoutBand,
  type FirmInterval,
} from "@/lib/stripe-plans";
import { accessTokenFromNext } from "@/lib/practice-access";
import { AuthDivider, GoogleSignInButton } from "@/components/google-sign-in-button";
import { stashAccountantGoogleSignup } from "@/lib/google-auth";
import { signupLooksAlreadyRegistered } from "@/lib/invite-handoff";
import { MarketPicker } from "@/components/market-picker";
import {
  AuthEntryCard,
  AuthEntryEyebrow,
  AuthEntryFieldLabel,
  AuthEntryFootnote,
  AuthEntryInput,
  AuthEntryLead,
  AuthEntryLink,
  AuthEntryPrimaryButton,
  AuthEntryShell,
  AuthEntryTabs,
  AuthEntryTitle,
} from "@/components/auth-entry-shell";
import {
  draftToSelection,
  isDraftComplete,
  marketToJson,
  readVisitorDraft,
  writeVisitorDraft,
  type DraftMarket,
} from "@/lib/market";

import { pageHead, SEO_PAGES } from "@/lib/seo";

type AuthSearch = {
  next?: string;
  signup?: boolean;
  plan?: FirmCheckoutBand;
  interval?: FirmInterval;
};

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  validateSearch: (search: Record<string, unknown>): AuthSearch => {
    const next =
      typeof search.next === "string" && search.next.startsWith("/") ? search.next : undefined;
    const plan =
      typeof search.plan === "string" && isFirmCheckoutBand(search.plan) ? search.plan : undefined;
    const interval =
      typeof search.interval === "string" && isFirmInterval(search.interval)
        ? search.interval
        : undefined;
    const signupFlag =
      search.signup === true || search.signup === "1" || search.signup === "true" || plan != null;
    return {
      ...(next ? { next } : {}),
      ...(signupFlag ? { signup: true } : {}),
      ...(plan ? { plan } : {}),
      ...(interval ? { interval } : {}),
    };
  },
  head: () => pageHead(SEO_PAGES.auth),
});

function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { next, signup, plan, interval } = Route.useSearch();
  const ensurePractice = useServerFn(ensurePracticePortalAccess);
  const checkEntitlement = useServerFn(getFirmBillingEntitlement);
  // URL owns the tab. signup=true (or a plan query) opens Create Firm even if
  // state was initialized on Sign in. A tab click sets an override, then rewrites the URL.
  const [tabOverride, setTabOverride] = useState<"signin" | "signup" | null>(null);
  const signupOn = Boolean(signup);
  const [syncedSignup, setSyncedSignup] = useState(signupOn);
  if (syncedSignup !== signupOn) {
    setSyncedSignup(signupOn);
    setTabOverride(null);
  }
  const mode: "signin" | "signup" = tabOverride ?? (signupOn ? "signup" : "signin");
  const [storedBand, setStoredBand] = useState<{
    plan: FirmCheckoutBand;
    interval: FirmInterval;
  } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftMarket, setDraftMarket] = useState<DraftMarket>({ country: null, regionCode: null });

  /* Client-only form gate — browser password managers (LastPass etc.) inject
     DOM nodes into password forms, causing fatal SSR hydration mismatches. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    setDraftMarket(readVisitorDraft());
    const pending = peekPendingCheckout();
    if (pending) setStoredBand({ plan: pending.plan, interval: pending.interval });
  }, []);
  const selectedPlan = plan ?? storedBand?.plan ?? "solo";
  const selectedInterval = interval ?? storedBand?.interval ?? "month";
  const practiceHint = practiceLocationHint(draftMarket);

  const pendingForSignup = (country: "ZA" | "US" | null): PendingCheckout => {
    const existing = peekPendingCheckout();
    const market = country === "ZA" ? "za" : country === "US" ? "us" : (existing?.market ?? "us");
    return {
      plan: selectedPlan,
      interval: selectedInterval,
      market,
      ...(existing?.promo ? { promo: existing.promo } : {}),
    };
  };

  const openSignIn = (pending?: PendingCheckout) => {
    setTabOverride("signin");
    if (pending) {
      stashPendingCheckout(pending);
      void navigate({
        to: "/auth",
        search: { next: billingStartPath(pending) },
        replace: true,
      });
      return;
    }
    // Plain Sign in drops a plan left behind by the Create firm tab.
    clearPendingCheckout();
    const safe = safeAccountantRedirect(next);
    void navigate({
      to: "/auth",
      search: safe ? { next: safe } : {},
      replace: true,
    });
  };

  useEffect(() => {
    if (mode !== "signup") return;
    const existing = peekPendingCheckout();
    // A bare /auth?signup=true must not wipe a band already stashed by pricing.
    if (!plan && !interval && existing) return;
    stashPendingCheckout({
      plan: plan ?? existing?.plan ?? "solo",
      interval: interval ?? existing?.interval ?? "month",
      market: existing?.market ?? "us",
      ...(existing?.promo ? { promo: existing.promo } : {}),
    });
  }, [mode, plan, interval]);

  useEffect(() => {
    if (!mounted) return;
    writeVisitorDraft(draftMarket);
  }, [draftMarket, mounted]);

  const afterAuthPath = isOpsNext(next)
    ? "/ops"
    : next?.startsWith("/access/")
      ? next
      : "/dashboard";
  const googleNext =
    isOpsNext(next) || next?.startsWith("/access/") || isBillingStartPath(next) ? next : undefined;
  const landedPathRef = useRef<string | null>(null);
  const landInflightRef = useRef<Promise<string> | null>(null);
  /** While Create firm is provisioning, don't let the session effect steal the landing. */
  const signupLandingRef = useRef(false);

  // Stamp the accountant door as soon as this page is shown — before submit —
  // so a dual-role session cannot be claimed by the founder landing redirect.
  useEffect(() => {
    setPortalIntent("accountant");
  }, []);

  const landAfterAccountantAuth = async (
    userId: string,
    flow: "signin" | "signup",
    hadFirmBefore?: boolean,
  ) => {
    if (landedPathRef.current) return landedPathRef.current;
    if (landInflightRef.current) return landInflightRef.current;
    const run = (async () => {
      forcePortal("accountant");
      const accessTok = accessTokenFromNext(next);
      if (accessTok) {
        landedPathRef.current = `/access/${accessTok}`;
        navigate({ to: "/access/$token", params: { token: accessTok } });
        return landedPathRef.current;
      }
      if (isOpsNext(next)) {
        landedPathRef.current = "/ops";
        const tab = lighthouseTabFromOpsNext(next);
        navigate({ to: "/ops", search: tab ? { tab } : {} });
        return "/ops";
      }
      const firmsKnown =
        hadFirmBefore !== undefined ? hadFirmBefore : (await listUserFirms(userId)).length > 0;
      const pending = peekPendingCheckout();
      const explicitBilling = isBillingStartPath(next);
      const mightBill =
        !firmsKnown &&
        ((flow === "signup" && Boolean(pending || explicitBilling)) ||
          (flow === "signin" && explicitBilling));
      let hasLiveEntitlement = false;
      if (mightBill) {
        try {
          const ent = await checkEntitlement({ data: {} });
          hasLiveEntitlement = ent.reason === "active_subscription" || ent.reason === "firm_member";
        } catch {
          hasLiveEntitlement = false;
        }
      }
      const decision = decideAccountantAuthLanding({
        flow,
        hadFirmBefore: firmsKnown,
        hasLiveEntitlement,
        pending,
        next,
      });
      if (decision.kind === "billing") {
        const path = billingStartPath(decision.pending);
        landedPathRef.current = path;
        navigate({
          to: "/billing/start",
          search: billingStartSearch(decision.pending),
        });
        return path;
      }
      clearPendingCheckout();
      if (await shouldOpenItInbox(userId)) {
        landedPathRef.current = "/ops";
        navigate({ to: "/ops", search: { tab: "it" } });
        return "/ops";
      }
      const path = await resolvePostLoginPath(userId);
      if (path === "/app") {
        clearForcePortal();
        setPortalIntent("owner");
        toast.message("This sign-in is for accounting firms. Opening the business board instead.");
        landedPathRef.current = path;
        navigate({ to: path });
        return path;
      }
      await ensurePractice().catch(() => {
        /* non-fatal — role guard still uses firm ownership */
      });
      landedPathRef.current = path;
      navigate({ to: path });
      return path;
    })();
    landInflightRef.current = run;
    try {
      return await run;
    } finally {
      landInflightRef.current = null;
    }
  };

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    void (async () => {
      if (signupLandingRef.current) return;
      await landAfterAccountantAuth(user.id, mode);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, navigate, ensurePractice, checkEntitlement, next, mode]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    const market = mode === "signup" ? draftToSelection(draftMarket) : null;
    if (mode === "signup" && !market) {
      toast.error("Pick South Africa or the United States (and a state) first.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        if (!market) {
          toast.error("Pick South Africa or the United States (and a state) first.");
          return;
        }
        const pending = pendingForSignup(market.country);
        stashPendingCheckout(pending);
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: checkoutEmailRedirectTo(window.location.origin, pending),
            data: {
              full_name: fullName,
              firm_name: firmName.trim(),
              signup_type: "accountant",
              ...(market
                ? { market_country: market.country, market_region: market.regionCode }
                : {}),
            },
          },
        });
        if (signupLooksAlreadyRegistered({ errorMessage: error?.message, user: data?.user })) {
          stashPendingCheckout(pending);
          stashResumeFirmBilling();
          openSignIn(pending);
          toast.message(FIRM_BILLING_SIGNIN_MESSAGE);
          return;
        }
        if (error) throw error;
        notifySignup("Accountant firm", email, fullName);
        if (!data.session) {
          toast.success("Account created — check your email to confirm before signing in.");
          return;
        }
        signupLandingRef.current = true;
        let hadFirmBefore = false;
        if (data.user) {
          hadFirmBefore = (await listUserFirms(data.user.id)).length > 0;
          // One provisioning path (firm + membership + firm_admin), serialised
          // per user in the database so a concurrent profile hydrate cannot
          // mint a second firm. Carries the market picked above.
          const { error: firmErr } = await supabase.rpc("ensure_practice_firm", {
            p_name: firmName.trim() || null,
            p_market: market ? marketToJson(market) : null,
          });
          if (firmErr) toast.error(firmErr.message);
        }
        forcePortal("accountant");
        await ensurePractice().catch(() => undefined);
        toast.success("Account created");
        if (data.user) await landAfterAccountantAuth(data.user.id, "signup", hadFirmBefore);
        else navigate({ to: afterAuthPath as "/dashboard" });
      } else {
        if (!isBillingStartPath(next)) clearPendingCheckout();
        const { error, data: signInData } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        // Lazy firm provisioning — runs in a separate try/catch so any failure
        // here never blocks the user from signing in.
        try {
          if (signInData.user) {
            const meta = signInData.user.user_metadata as {
              firm_name?: string;
              full_name?: string;
            } | null;
            if (meta?.firm_name) {
              const { data: existing } = await supabase
                .from("firms")
                .select("id")
                .eq("owner_user_id", signInData.user.id)
                .maybeSingle();
              if (!existing) {
                const { data: firm } = await supabase
                  .from("firms")
                  .insert({ name: meta.firm_name, owner_user_id: signInData.user.id })
                  .select("id")
                  .single();
                if (firm) {
                  await supabase
                    .from("firm_memberships")
                    .insert({ firm_id: firm.id, user_id: signInData.user.id, role: "owner" });
                  await supabase
                    .from("user_roles")
                    .insert({ user_id: signInData.user.id, role: "firm_admin" });
                }
              }
            }
          }
        } catch {
          // provisioning failure is non-fatal — user proceeds to dashboard regardless
        }
        const path = signInData.user
          ? await landAfterAccountantAuth(signInData.user.id, "signin")
          : afterAuthPath;
        if (path === "/dashboard" || path === "/ops") {
          toast.success("Welcome back");
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (mode === "signup" && signupLooksAlreadyRegistered({ errorMessage: msg })) {
        const pending = pendingForSignup(draftToSelection(draftMarket)?.country ?? null);
        stashPendingCheckout(pending);
        stashResumeFirmBilling();
        openSignIn(pending);
        toast.message(FIRM_BILLING_SIGNIN_MESSAGE);
        return;
      }
      toast.error(msg);
    } finally {
      signupLandingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <AuthEntryShell badge="Accountant portal">
      <AuthEntryEyebrow>Practice sign-in</AuthEntryEyebrow>
      <AuthEntryTitle>Your firm workspace</AuthEntryTitle>
      <AuthEntryLead>
        For accounting firms and advisory practices. <AuthEntryLink to="/">Back home</AuthEntryLink>
      </AuthEntryLead>

      <AuthEntryCard className="mt-6">
        <AuthEntryTabs
          value={mode}
          onChange={(v) => {
            if (v === "signin") {
              openSignIn();
              return;
            }
            setTabOverride("signup");
            void navigate({
              to: "/auth",
              search: {
                ...(next ? { next } : {}),
                signup: true,
                plan: selectedPlan,
                interval: selectedInterval,
              },
              replace: true,
            });
          }}
          options={[
            { value: "signin", label: "Sign in" },
            { value: "signup", label: "Create firm" },
          ]}
        />

        {mode === "signup" && (
          <FirmSignupTerms
            variant="auth"
            plan={selectedPlan}
            interval={selectedInterval}
            onPlanChange={(nextPlan) => {
              setTabOverride("signup");
              void navigate({
                to: "/auth",
                search: {
                  ...(next ? { next } : {}),
                  signup: true,
                  plan: nextPlan,
                  interval: selectedInterval,
                },
                replace: true,
              });
            }}
          />
        )}

        {mounted && (
          <>
            {mode === "signin" && (
              <div>
                <GoogleSignInButton
                  intent="accountant"
                  next={googleNext ?? afterAuthPath}
                  tone="entry"
                  disabled={busy}
                  onError={(msg) => toast.error(msg)}
                />
                <AuthDivider />
              </div>
            )}
            <form onSubmit={handle} className={mode === "signin" ? "" : "mt-4"}>
              {mode === "signup" && (
                <>
                  <AuthEntryFieldLabel htmlFor="auth-full-name">Your name</AuthEntryFieldLabel>
                  <AuthEntryInput
                    id="auth-full-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                  <AuthEntryFieldLabel htmlFor="auth-firm-name">Firm name</AuthEntryFieldLabel>
                  <AuthEntryInput
                    id="auth-firm-name"
                    value={firmName}
                    onChange={(e) => setFirmName(e.target.value)}
                    placeholder="Acme & Partners"
                    required
                  />
                  <div className="mt-4">
                    <MarketPicker
                      value={draftMarket}
                      onChange={setDraftMarket}
                      audience="practice"
                      locationNoun="practice"
                    />
                    {practiceHint ? (
                      <p id="practice-missing" className="firm-signup-hint" role="status">
                        {practiceHint}
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-5">
                    <GoogleSignInButton
                      intent="accountant"
                      next={googleNext ?? afterAuthPath}
                      tone="entry"
                      label="Continue with Google"
                      disabled={busy}
                      onBeforeStart={() => {
                        const market = draftToSelection(draftMarket);
                        if (!market) {
                          toast.error(
                            "Pick South Africa or the United States (and a state) first.",
                          );
                          return false;
                        }
                        writeVisitorDraft(draftMarket);
                        stashAccountantGoogleSignup({
                          firmName: firmName.trim(),
                          fullName: fullName.trim() || undefined,
                          marketCountry: market.country,
                          marketRegion: market.regionCode,
                        });
                        stashPendingCheckout(pendingForSignup(market.country));
                        return true;
                      }}
                      onError={(msg) => toast.error(msg)}
                    />
                    <AuthDivider />
                  </div>
                </>
              )}
              <AuthEntryFieldLabel htmlFor="auth-email">Email</AuthEntryFieldLabel>
              <AuthEntryInput
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <AuthEntryFieldLabel htmlFor="auth-password">Password</AuthEntryFieldLabel>
              <AuthEntryInput
                id="auth-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                aria-describedby={mode === "signup" ? "auth-password-hint" : undefined}
              />
              {mode === "signup" ? (
                <p id="auth-password-hint" className="firm-signup-hint">
                  At least 8 characters.
                </p>
              ) : null}
              {mode === "signup" && practiceHint ? (
                <p className="firm-signup-hint">
                  Create firm account stays off until the practice location is filled in.
                </p>
              ) : null}
              <AuthEntryPrimaryButton
                type="submit"
                className="mt-6"
                disabled={busy || (mode === "signup" && !isDraftComplete(draftMarket))}
                aria-describedby={
                  mode === "signup" && practiceHint ? "practice-missing" : undefined
                }
              >
                {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create firm account"}
              </AuthEntryPrimaryButton>
              {mode === "signup" && (
                <AuthEntryFootnote>
                  By creating a firm account you agree to the{" "}
                  <a href="/terms" className="auth-entry__link">
                    Terms
                  </a>
                  . AI is powered by Claude; financial information sent to it is anonymised.{" "}
                  <a href="/privacy" className="auth-entry__link">
                    Privacy
                  </a>
                  {" · "}
                  <a href="/ai" className="auth-entry__link">
                    AI notice
                  </a>
                </AuthEntryFootnote>
              )}
            </form>
          </>
        )}
      </AuthEntryCard>

      <p className="auth-entry__muted mt-6 text-center text-sm">
        Business owner? <AuthEntryLink to="/">Sign in at milonfinance.com →</AuthEntryLink>
      </p>
      <div className="mt-4 flex justify-center">
        <PreLoginShareButton />
      </div>
    </AuthEntryShell>
  );
}
