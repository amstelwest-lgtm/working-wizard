import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Users,
  Building2,
  LogOut,
  Palette,
  RotateCcw,
  Scale,
  Trash2,
  User,
  CreditCard,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { AI_MODEL_DISCLOSURE } from "@/lib/marketing-faq";
import { supabase } from "@/integrations/supabase/client";
import { deleteOwnAccount } from "@/lib/account.functions";
import {
  firmRenewalStatusLine,
  firmTrialStatusLine,
  showStarterTrialEndedCopy,
  type FirmPlanDisplay,
} from "@/lib/firm-client-cap";
import { firmStarterTrialCountdownCopy } from "@/lib/firm-starter-trial";
import { FirmBandUpgrade } from "@/components/firm-band-upgrade";
import { TrialEndedPlanBlock } from "@/components/trial-ended-plan-block";
import { useFirmVoucherCheck } from "@/hooks/use-firm-voucher";
import {
  formatFirmOverLimitNote,
  practiceDisplaysZarPlan,
  UPGRADE_FAILED_MESSAGE,
} from "@/lib/firm-band-upgrade";
import type { FirmCheckoutBand, FirmInterval } from "@/lib/stripe-plans";
import {
  createBillingPortalSession,
  getFirmPlanDisplay,
  upgradeFirmBand,
} from "@/lib/stripe-checkout.functions";
import { resetOnboardingTours } from "@/lib/onboarding";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { MarketSettingsCard } from "@/components/market-settings-card";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { listUserFirms } from "@/lib/firm-brand";
import { readCachedFirmPlan } from "@/lib/firm-plan-client";
import {
  decideSettingsView,
  getPortalIntent,
  isPracticeSignupMeta,
  peekForcePortal,
  peekSettingsReturn,
  resolvePortalRoles,
  setPortalIntent,
  setSettingsReturn,
  settingsBackPath,
  type SettingsView,
} from "@/lib/user-roles";
import { PageHeader, SectionCard } from "@/components/primitives";
import { InviteAccountantCard } from "@/components/invite-accountant-card";
import { OwnerPracticeAccessCard } from "@/components/owner-practice-access";
import { pickOwnedSettingsClient, readStoredOwnerClientId } from "@/lib/owner-workspaces";
import { SettingsShell } from "@/components/settings-shell";
import { ChangePasswordCard } from "@/components/change-password-card";

export const Route = createFileRoute("/_authenticated/settings/")({
  component: SettingsPage,
  head: () => ({
    meta: [{ title: "Settings — Milōn" }],
  }),
});

function SettingsPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const doDelete = useServerFn(deleteOwnAccount);
  const startBillingPortal = useServerFn(createBillingPortalSession);
  const loadPlan = useServerFn(getFirmPlanDisplay);
  const upgradeBand = useServerFn(upgradeFirmBand);
  const { firmId } = useAccountantProfile();
  const onValidateVoucher = useFirmVoucherCheck(firmId);
  const [plan, setPlan] = useState<FirmPlanDisplay | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const [view, setView] = useState<SettingsView | null>(null);
  const [hasPractice, setHasPractice] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [ownerClientId, setOwnerClientId] = useState<string | null>(null);
  const [regionSnapshot, setRegionSnapshot] = useState<{
    view: SettingsView;
    firmId: string | null;
    market: unknown;
    clientMarkets: unknown[] | null;
  } | null>(null);

  const viewReady = view != null;
  const isPractice = view === "practice";
  const regionReady =
    viewReady &&
    regionSnapshot != null &&
    regionSnapshot.view === view &&
    (view !== "practice" || regionSnapshot.firmId === (firmId ?? null)) &&
    (view !== "practice" || regionSnapshot.clientMarkets != null);
  const marketBlob = regionReady && regionSnapshot ? regionSnapshot.market : null;
  const zarPlan =
    isPractice &&
    regionSnapshot != null &&
    regionSnapshot.view === "practice" &&
    regionSnapshot.firmId === (firmId ?? null) &&
    regionSnapshot.clientMarkets != null &&
    practiceDisplaysZarPlan({
      firmMarket: regionSnapshot.market,
      clientMarkets: regionSnapshot.clientMarkets,
    });
  const planPricesReady = !isPractice || regionReady;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const portal = await resolvePortalRoles(user.id);
      const firms = portal.hasPracticeRole ? [] : await listUserFirms(user.id);
      if (cancelled) return;
      const next = decideSettingsView({
        hasPracticeRole: portal.hasPracticeRole,
        hasClientRole: portal.hasClientRole,
        hasFirm: firms.length > 0,
        intent: getPortalIntent(),
        force: peekForcePortal(),
        practiceSignup: isPracticeSignupMeta(
          user.user_metadata as Record<string, unknown> | undefined,
        ),
        returnTo: peekSettingsReturn(),
      });
      setView(next);
      setHasPractice(portal.hasPracticeRole || firms.length > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user || view == null) return;
    let cancelled = false;
    const requested = view;
    if (requested === "practice") {
      if (!firmId) return;
      void (async () => {
        const firmRes = await supabase
          .from("firms")
          .select("market")
          .eq("id", firmId)
          .maybeSingle();
        const clientRes = await supabase.from("clients").select("market").eq("firm_id", firmId);
        if (cancelled) return;
        const market = firmRes.error
          ? null
          : ((firmRes.data as { market?: unknown } | null)?.market ?? null);
        const rows = clientRes.error ? [] : ((clientRes.data ?? []) as Array<{ market?: unknown }>);
        setRegionSnapshot({
          view: "practice",
          firmId,
          market,
          clientMarkets: rows.map((row) => row.market),
        });
      })();
      return () => {
        cancelled = true;
      };
    }
    void supabase
      .from("clients")
      .select("id, market, firm_id")
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(10)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data ?? []) as Array<{
          id?: string;
          market?: unknown;
          firm_id?: string | null;
        }>;
        const preferred = pickOwnedSettingsClient(rows, readStoredOwnerClientId(user.id));
        setOwnerClientId(preferred?.id ?? null);
        setRegionSnapshot({
          view: "owner",
          firmId: null,
          market: preferred?.market ?? null,
          clientMarkets: null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [user, view, firmId]);

  useEffect(() => {
    if (!isPractice) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    setPlanLoading(true);
    void readCachedFirmPlan(firmId, (input) => loadPlan(input))
      .then((next) => {
        if (!cancelled) setPlan(next);
      })
      .catch(() => {
        if (!cancelled) setPlan(null);
      })
      .finally(() => {
        if (!cancelled) setPlanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isPractice, firmId, loadPlan]);

  const backTo = view == null ? null : settingsBackPath(view);
  const trialLine = firmTrialStatusLine({
    phase: plan?.phase,
    trialEndsOn: plan?.trialEndsOn,
  });
  const renewalLine = firmRenewalStatusLine({
    phase: plan?.phase,
    renewsOn: plan?.renewsOn,
  });

  const handleDelete = async () => {
    if (confirmText.trim().toUpperCase() !== "DELETE") return;
    setDeleting(true);
    try {
      await doDelete();
      toast.success("Account deleted");
      await signOut();
      window.location.href = "/";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete account");
      setDeleting(false);
    }
  };

  const handlePlanUpgrade = (
    band: FirmCheckoutBand,
    interval: FirmInterval,
    voucherCode?: string | null,
  ) => {
    if (!firmId) return;
    setUpgrading(true);
    setUpgradeError(null);
    void upgradeBand({
      data: {
        firmId,
        band,
        interval,
        voucherCode: voucherCode?.trim() || undefined,
      },
    })
      .then(async (result) => {
        if (result.kind === "checkout") {
          window.location.href = result.url;
          return;
        }
        toast.success(result.message);
        const next = await loadPlan({ data: { firmId } });
        setPlan(next);
      })
      .catch((ex: unknown) => {
        const message = ex instanceof Error ? ex.message : UPGRADE_FAILED_MESSAGE;
        setUpgradeError(message);
        toast.error(message);
      })
      .finally(() => setUpgrading(false));
  };

  const handleRestartTour = () => {
    resetOnboardingTours(isPractice ? "accountant" : "owner");
    toast.success("Guided tour will show next time you open the board");
  };

  const trialEnded =
    plan != null &&
    plan.configured !== false &&
    showStarterTrialEndedCopy(plan.phase, plan.starterTrial?.expired);
  const overLimitNote =
    plan && plan.configured !== false
      ? formatFirmOverLimitNote({
          count: plan.clientCount,
          limit: plan.clientLimit,
          planName: plan.headline,
        })
      : null;

  return (
    <SettingsShell
      onSettings={() => {
        void navigate({ to: "/settings" });
      }}
      onPlan={() => {
        if (isPractice) {
          document.getElementById("firm-billing")?.scrollIntoView({ block: "start" });
          return;
        }
        setPortalIntent("owner");
        void navigate({ to: "/app", search: { screen: "plan" } });
      }}
    >
      {backTo ? (
        <BackLink
          onClick={() => {
            if (backTo === "/app") setPortalIntent("owner");
            else setPortalIntent("accountant");
            navigate({ to: backTo });
          }}
          className="mb-3"
        >
          {backTo === "/app" ? "Back to board" : "Back to practice"}
        </BackLink>
      ) : null}
      <PageHeader
        compact
        className="mb-8"
        eyebrow="Account"
        title="Settings"
        subtitle={
          view === "practice"
            ? "Profile, practice preferences, and account controls"
            : view === "owner"
              ? "Profile, workspace, and account controls"
              : "Profile and account controls"
        }
        meta={<ThemeToggle />}
      />

      <SectionCard
        className="mb-6"
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <User className="h-4 w-4" />
            Profile
          </span>
        }
      >
        <div className="space-y-4">
          <div>
            <span className="settings-label">Signed in as</span>
            <p className="settings-value">{user?.email ?? "—"}</p>
          </div>

          <ChangePasswordCard />

          {view === "owner" && (
            <button
              type="button"
              className="settings-row"
              onClick={() => {
                sessionStorage.setItem("milon_open_profile", "1");
                navigate({ to: "/app" });
              }}
            >
              <Building2 className="h-4 w-4" />
              Business profile (10 questions)
            </button>
          )}

          {view === "practice" && (
            <p className="text-xs text-[var(--ink-dim)]">
              Client business profiles are edited inside each client workspace.
            </p>
          )}
        </div>
      </SectionCard>

      {view === "owner" && ownerClientId ? (
        <div className="mb-6">
          <InviteAccountantCard clientId={ownerClientId} tone="settings" />
        </div>
      ) : null}

      {view === "owner" ? <OwnerPracticeAccessCard /> : null}

      <MarketSettingsCard
        kind={isPractice ? "firm" : "client"}
        recordId={isPractice ? firmId : ownerClientId}
        initial={marketBlob}
        loaded={regionReady}
        zarPlan={Boolean(zarPlan)}
      />

      {view === "owner" && hasPractice && (
        <SectionCard
          className="mb-6"
          description="This login also has a practice portal. Opening it leaves the business board."
        >
          <button
            type="button"
            className="settings-row mt-1"
            onClick={() => {
              setSettingsReturn("/dashboard");
              setPortalIntent("accountant");
              navigate({ to: "/dashboard" });
            }}
          >
            <Building2 className="h-4 w-4" />
            Open practice portal
          </button>
        </SectionCard>
      )}

      {isPractice && (
        <SectionCard
          id="firm-billing"
          className="settings-plan-card mb-6"
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Practice
            </span>
          }
        >
          <div className="space-y-2">
            <div className="mb-3">
              <span className="settings-label">Plan</span>
              {planLoading ? (
                <p className="settings-value">Loading plan…</p>
              ) : plan?.configured === false ? (
                <p className="settings-value">Plan status unavailable</p>
              ) : (
                <>
                  {plan?.phase === "trialing" ? (
                    trialLine ? (
                      <p className="settings-value" data-trial-status="">
                        {trialLine}
                      </p>
                    ) : null
                  ) : (
                    <>
                      <p className="settings-value">{plan?.headline ?? "No active plan"}</p>
                      {renewalLine ? (
                        <p className="settings-value" data-plan-renews="">
                          {renewalLine}
                        </p>
                      ) : null}
                    </>
                  )}
                  {plan?.starterTrial && !trialEnded ? (
                    firmStarterTrialCountdownCopy(plan.starterTrial) ? (
                      <p role="status" className="text-sm">
                        {firmStarterTrialCountdownCopy(plan.starterTrial)}
                      </p>
                    ) : null
                  ) : null}
                  {trialEnded ? null : (
                    <>
                      {plan?.detail ? (
                        <p className="text-xs text-[var(--ink-dim)]">{plan.detail}</p>
                      ) : null}
                      {plan?.usageLabel ? (
                        <p className="text-xs text-[var(--ink-dim)]">{plan.usageLabel}</p>
                      ) : null}
                      {overLimitNote ? (
                        <p role="status" className="text-sm font-semibold text-[var(--risk,#9b2c2c)]">
                          {overLimitNote}
                        </p>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </div>
            {trialEnded ? (
              <div className="mb-3">
                <TrialEndedPlanBlock
                  firmId={firmId}
                  upgrading={upgrading}
                  upgrade={{
                    band: plan.band,
                    interval: plan.interval ?? "month",
                    priceCurrency: plan.priceCurrency ?? "USD",
                    zarByBand: plan.zarByBand ?? {},
                    canUpgrade: plan.canUpgrade,
                    clientCount: plan.clientCount,
                    usageLabel: plan.usageLabel,
                    saDiscount: Boolean(plan.saDiscount) || zarPlan,
                    zaLabels: plan.zaLabels,
                    phase: plan.phase,
                  }}
                  onUpgrade={handlePlanUpgrade}
                />
              </div>
            ) : plan && plan.configured !== false && planPricesReady ? (
              <div className="mb-3">
                {overLimitNote ? (
                  <p className="mb-2 text-sm font-semibold">Upgrade</p>
                ) : null}
                <FirmBandUpgrade
                  currentBand={plan.band}
                  interval={plan.interval ?? "month"}
                  priceCurrency={plan.priceCurrency ?? "USD"}
                  zarByBand={plan.zarByBand ?? {}}
                  canUpgrade={plan.canUpgrade}
                  clientCount={plan.clientCount}
                  saDiscount={Boolean(plan.saDiscount) || zarPlan}
                  zaLabels={plan.zaLabels}
                  introTrialEligible={plan.introTrialEligible}
                  cardFree={
                    plan.phase === "none" &&
                    plan.starterTrial?.enforced === true &&
                    plan.starterTrial.expired !== true
                  }
                  upgrading={upgrading}
                  onValidateVoucher={onValidateVoucher}
                  onUpgrade={handlePlanUpgrade}
                />
              </div>
            ) : null}
            {upgradeError ? (
              <p role="alert" className="mt-2 text-xs text-[var(--risk,#9b2c2c)]">
                {upgradeError}
              </p>
            ) : null}
            <Link to="/settings/team" className="settings-row">
              <Users className="h-4 w-4" />
              Team & client access
            </Link>
            <Link to="/settings/brand" className="settings-row">
              <Palette className="h-4 w-4" />
              Brand & logo on reports
            </Link>
            <Link to="/dashboard" className="settings-row">
              <Building2 className="h-4 w-4" />
              Firm dashboard & clients
            </Link>
            {plan == null || plan.canUpgrade ? (
              <button
                type="button"
                className="settings-row"
                onClick={() => {
                  void startBillingPortal()
                    .then(({ url }) => {
                      window.location.href = url;
                    })
                    .catch((ex: unknown) => {
                      toast.error(
                        ex instanceof Error ? ex.message : "Could not open Stripe billing portal.",
                      );
                    });
                }}
              >
                <CreditCard className="h-4 w-4" />
                Manage billing
              </button>
            ) : null}
          </div>
        </SectionCard>
      )}

      <SectionCard
        className="mb-6"
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            Preferences
          </span>
        }
        description="Light or dark. The same control sits in the header on every page."
      >
        <div className="settings-theme-row">
          <span className="settings-label">Theme</span>
          <ThemeToggle />
        </div>
        <button type="button" className="settings-row" onClick={handleRestartTour}>
          <RotateCcw className="h-4 w-4" />
          Restart guided onboarding tour
        </button>
      </SectionCard>

      <SectionCard
        className="mb-6"
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Scale className="h-4 w-4" />
            Legal
          </span>
        }
        description={AI_MODEL_DISCLOSURE}
      >
        <div className="flex flex-col gap-2">
          <a href="/privacy" className="settings-row">
            Privacy
          </a>
          <a href="/terms" className="settings-row">
            Terms of use
          </a>
          <a href="/ai" className="settings-row">
            AI notice
          </a>
        </div>
      </SectionCard>

      <SectionCard className="mb-6">
        <button
          type="button"
          className="settings-row"
          onClick={() =>
            signOut().then(() => {
              window.location.href = "/";
            })
          }
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </SectionCard>

      <section id="danger-zone" className="settings-danger mb-6" aria-label="Danger zone">
        <p className="settings-danger-title">Danger zone</p>
        <p>
          {view === "practice"
            ? "Permanently deletes your practice login, firms you own, and practice clients you created. This cannot be undone."
            : view === "owner"
              ? "Permanently deletes your login and this business’s client data on Milōn (figures, budget, forecasts, action plan). This cannot be undone."
              : "Permanently deletes this login. This cannot be undone."}
        </p>
        <Button
          type="button"
          variant="destructive"
          className="mt-3"
          onClick={() => {
            setConfirmText("");
            setConfirmOpen(true);
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete my account
        </Button>
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="border-[var(--line)] bg-[var(--bg-2)] text-[var(--ink)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[var(--risk)]">
              Delete account permanently?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--ink-dim)]">
              Type <span className="font-semibold text-[var(--ink)]">DELETE</span> to confirm. All
              owned data will be removed and you will be signed out.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmText.trim().toUpperCase() !== "DELETE" || deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-[var(--risk)] text-white hover:opacity-90 disabled:opacity-40"
            >
              {deleting ? "Deleting…" : "Delete forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsShell>
  );
}
