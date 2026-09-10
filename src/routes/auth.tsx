import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
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
import { accessTokenFromNext } from "@/lib/practice-access";
import { AuthDivider, GoogleSignInButton } from "@/components/google-sign-in-button";
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

export const Route = createFileRoute("/auth")({
  component: AuthPage,
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: typeof search.next === "string" && search.next.startsWith("/") ? search.next : undefined,
  }),
  head: () => ({
    meta: [{ title: "Sign in — Milōn" }],
  }),
});

function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const ensurePractice = useServerFn(ensurePracticePortalAccess);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
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
  }, []);

  useEffect(() => {
    if (!mounted) return;
    writeVisitorDraft(draftMarket);
  }, [draftMarket, mounted]);

  const afterAuthPath = isOpsNext(next)
    ? "/ops"
    : next?.startsWith("/access/")
      ? next
      : "/dashboard";
  const googleNext = isOpsNext(next) || next?.startsWith("/access/") ? next : undefined;
  const landedPathRef = useRef<string | null>(null);
  const landInflightRef = useRef<Promise<string> | null>(null);

  // Stamp the accountant door as soon as this page is shown — before submit —
  // so a dual-role session cannot be claimed by the founder landing redirect.
  useEffect(() => {
    setPortalIntent("accountant");
  }, []);

  const landAfterAccountantAuth = async (userId: string) => {
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
      await landAfterAccountantAuth(user.id);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, navigate, ensurePractice, next]);

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
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/dashboard`,
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
        if (error) throw error;
        notifySignup("Accountant firm", email, fullName);
        if (!data.session) {
          toast.success("Account created — check your email to confirm before signing in.");
          return;
        }
        if (data.user) {
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
        if (data.user) await landAfterAccountantAuth(data.user.id);
        else navigate({ to: afterAuthPath as "/dashboard" });
      } else {
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
          ? await landAfterAccountantAuth(signInData.user.id)
          : afterAuthPath;
        if (path === "/dashboard" || path === "/ops") {
          toast.success("Welcome back");
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthEntryShell badge="Accountant portal">
      <AuthEntryEyebrow>Practice sign-in</AuthEntryEyebrow>
      <AuthEntryTitle>Your firm workspace</AuthEntryTitle>
      <AuthEntryLead>
        For accounting firms and advisory practices.{" "}
        <Link to="/" className="text-[#d4a550] underline underline-offset-4 hover:text-[#fdee79]">
          Back home
        </Link>
      </AuthEntryLead>

      <AuthEntryCard className="mt-6">
        <AuthEntryTabs
          value={mode}
          onChange={(v) => setMode(v as typeof mode)}
          options={[
            { value: "signin", label: "Sign in" },
            { value: "signup", label: "Create firm" },
          ]}
        />

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
                    />
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
              />
              <AuthEntryPrimaryButton
                type="submit"
                className="mt-6"
                disabled={busy || (mode === "signup" && !isDraftComplete(draftMarket))}
              >
                {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create firm account"}
              </AuthEntryPrimaryButton>
              {mode === "signup" && (
                <AuthEntryFootnote>
                  By creating a firm account you agree to the{" "}
                  <a href="/terms" className="text-[#d4a550] underline">
                    Terms
                  </a>
                  . AI is powered by Claude; financial information sent to it is anonymised.{" "}
                  <a href="/privacy" className="text-[#d4a550] underline">
                    Privacy
                  </a>
                  {" · "}
                  <a href="/ai" className="text-[#d4a550] underline">
                    AI notice
                  </a>
                </AuthEntryFootnote>
              )}
            </form>
          </>
        )}
      </AuthEntryCard>

      <p className="mt-6 text-center text-sm text-[#8a938c]">
        Business owner? <AuthEntryLink to="/">Sign in at milon.co.za →</AuthEntryLink>
      </p>
      <div className="mt-4 flex justify-center">
        <PreLoginShareButton />
      </div>
    </AuthEntryShell>
  );
}
