import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  LogOut,
  Palette,
  RotateCcw,
  Trash2,
  User,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { deleteOwnAccount } from "@/lib/account.functions";
import { resetOnboardingTours } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export const Route = createFileRoute("/_authenticated/settings/")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings — Milōn" }] }),
});

function SettingsPage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const doDelete = useServerFn(deleteOwnAccount);

  const [role, setRole] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const isAccountant =
    role === "firm_admin" || role === "accountant";

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setRole(data?.role ?? null));
  }, [user]);

  const backTo = isAccountant ? "/dashboard" : "/app";

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
    resetOnboardingTours(isAccountant ? "accountant" : "owner");
    toast.success("Guided tour will show next time you open the board");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="mb-8 flex items-center justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={() => navigate({ to: backTo })}
              className="mb-3 inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#d4a550]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
              Settings
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Profile, practice preferences, and account controls
            </p>
          </div>
          <ThemeToggle />
        </div>

        {/* ── Profile ─────────────────────────────────────────────────────── */}
        <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <User className="h-4 w-4 text-[#d4a550]" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#d4a550]">
              Profile
            </h2>
          </div>

          <div className="space-y-4">
            <div>
              <Label className="text-xs text-slate-400">Signed in as</Label>
              <p className="mt-1 text-sm text-slate-100">{user?.email ?? "—"}</p>
            </div>

            {!isAccountant && (
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start border-slate-700 bg-slate-950/50 text-slate-200 hover:border-[#d4a550]/50 hover:bg-[#d4a550]/10"
                onClick={() => {
                  sessionStorage.setItem("milon_open_profile", "1");
                  navigate({ to: "/app" });
                }}
              >
                <Building2 className="mr-2 h-4 w-4 text-[#d4a550]" />
                Business profile (10 questions)
              </Button>
            )}

            {isAccountant && (
              <p className="text-xs text-slate-500">
                Client business profiles are edited inside each client workspace.
              </p>
            )}

            <div className="rounded-xl border border-rose-900/50 bg-rose-950/20 p-4">
              <p className="text-sm font-semibold text-rose-300">Delete account</p>
              <p className="mt-1 text-xs leading-relaxed text-rose-200/70">
                {isAccountant
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
        </section>

        {/* ── Practice (accountants) ──────────────────────────────────────── */}
        {isAccountant && (
          <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2">
              <Palette className="h-4 w-4 text-[#d4a550]" />
              <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#d4a550]">
                Practice
              </h2>
            </div>
            <div className="space-y-2">
              <Link
                to="/settings/brand"
                className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-sm text-slate-200 transition hover:border-[#d4a550]/50 hover:bg-[#d4a550]/10"
              >
                <Palette className="h-4 w-4 text-[#d4a550]" />
                Brand & logo (white-label reports)
              </Link>
              <Link
                to="/dashboard"
                className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-3 text-sm text-slate-200 transition hover:border-[#d4a550]/50 hover:bg-[#d4a550]/10"
              >
                <Building2 className="h-4 w-4 text-[#d4a550]" />
                Firm dashboard & clients
              </Link>
            </div>
          </section>
        )}

        {/* ── Preferences ─────────────────────────────────────────────────── */}
        <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-[#d4a550]" />
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#d4a550]">
              Preferences
            </h2>
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Theme lives in the header on every page. Use this to replay the guided tour on
            this device.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start border-slate-700 bg-slate-950/50 text-slate-200 hover:border-[#d4a550]/50 hover:bg-[#d4a550]/10"
            onClick={handleRestartTour}
          >
            <RotateCcw className="mr-2 h-4 w-4 text-[#d4a550]" />
            Restart guided onboarding tour
          </Button>
        </section>

        {/* ── Session ─────────────────────────────────────────────────────── */}
        <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start border-slate-700 bg-slate-950/50 text-slate-200"
            onClick={() => signOut().then(() => { window.location.href = "/"; })}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </section>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="border-slate-800 bg-slate-950 text-slate-50">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-rose-300">
              Delete account permanently?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              Type <span className="font-semibold text-slate-200">DELETE</span> to confirm.
              All owned data will be removed and you will be signed out.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="border-slate-700 bg-slate-900 text-slate-100"
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 bg-slate-900 text-slate-200">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmText.trim().toUpperCase() !== "DELETE" || deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-40"
            >
              {deleting ? "Deleting…" : "Delete forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
