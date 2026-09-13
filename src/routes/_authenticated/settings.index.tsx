import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Users, Building2, LogOut, Palette, RotateCcw, Scale, Trash2, User } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { deleteOwnAccount } from "@/lib/account.functions";
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
import { SettingsShell } from "@/components/settings-shell";

export const Route = createFileRoute("/_authenticated/settings/")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings — Milōn" }] }),
});

function SettingsPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const doDelete = useServerFn(deleteOwnAccount);
  const { firmId } = useAccountantProfile();

  const [view, setView] = useState<SettingsView>("owner");
  const [hasPractice, setHasPractice] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [ownerClientId, setOwnerClientId] = useState<string | null>(null);
  const [marketBlob, setMarketBlob] = useState<unknown>(null);

  const isPractice = view === "practice";

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
    if (!user) return;
    if (isPractice && firmId) {
      void supabase
        .from("firms")
        .select("market")
        .eq("id", firmId)
        .maybeSingle()
        .then(({ data }) => setMarketBlob((data as { market?: unknown } | null)?.market ?? null));
      return;
    }
    if (!isPractice) {
      void supabase
        .from("clients")
        .select("id, market, firm_id")
        .eq("owner_user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(10)
        .then(({ data }) => {
          const rows = (data ?? []) as Array<{
            id?: string;
            market?: unknown;
            firm_id?: string | null;
          }>;
          const preferred = rows.find((r) => !r.firm_id) ?? rows[0] ?? null;
          setOwnerClientId(preferred?.id ?? null);
          setMarketBlob(preferred?.market ?? null);
        });
    }
  }, [user, isPractice, firmId]);

  const backTo = settingsBackPath(view);

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

  const handleRestartTour = () => {
    resetOnboardingTours(isPractice ? "accountant" : "owner");
    toast.success("Guided tour will show next time you open the board");
  };

  return (
    <SettingsShell>
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
      <PageHeader
        compact
        className="mb-8"
        eyebrow="Account"
        title="Settings"
        subtitle={
          isPractice
            ? "Profile, practice preferences, and account controls"
            : "Profile, workspace, and account controls"
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

          {!isPractice && (
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

          {isPractice && (
            <p className="text-xs text-[var(--ink-dim)]">
              Client business profiles are edited inside each client workspace.
            </p>
          )}

          <div className="settings-danger">
            <p className="settings-danger-title">Delete account</p>
            <p>
              {isPractice
                ? "Permanently deletes your practice login, firms you own, and practice clients you created. This cannot be undone."
                : "Permanently deletes your login and this business’s client data on Milōn (figures, budget, forecasts, action plan). This cannot be undone."}
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
          </div>
        </div>
      </SectionCard>

      {!isPractice && ownerClientId ? (
        <div className="mb-6">
          <InviteAccountantCard clientId={ownerClientId} tone="settings" />
        </div>
      ) : null}

      <MarketSettingsCard
        kind={isPractice ? "firm" : "client"}
        recordId={isPractice ? firmId : ownerClientId}
        initial={marketBlob}
      />

      {!isPractice && hasPractice && (
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
          className="mb-6"
          eyebrow={
            <span className="inline-flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Practice
            </span>
          }
        >
          <div className="space-y-2">
            <Link to="/settings/team" className="settings-row">
              <Users className="h-4 w-4" />
              Team & client access
            </Link>
            <Link to="/settings/brand" className="settings-row">
              <Palette className="h-4 w-4" />
              Brand & logo (white-label reports)
            </Link>
            <Link to="/dashboard" className="settings-row">
              <Building2 className="h-4 w-4" />
              Firm dashboard & clients
            </Link>
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
        description="Theme lives in the header on every page. Use this to replay the guided tour on this device."
      >
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
        description="AI is powered by Claude. Financial information sent to the model is anonymised."
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
