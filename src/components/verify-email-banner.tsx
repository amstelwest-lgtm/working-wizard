import { useEffect, useState } from "react";
import { MailCheck, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/** Session-scoped so the banner never nags twice in one sitting. */
const DISMISS_KEY = "milon_verify_email_dismissed";
const RESEND_SECONDS = 45;

/**
 * Soft "verify later" — shown on the owner board when the account was
 * auto-confirmed at sign-up and the owner has not yet proved they own the
 * address. Sends a magic link to /auth/verified, which stamps the metadata
 * and comes straight back to the board. Nothing here blocks the app.
 */
export function VerifyEmailBanner({
  email,
  pending,
}: {
  email: string | null | undefined;
  /** user_metadata.email_verify_pending */
  pending: boolean;
}) {
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!pending || !email || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  const send = async () => {
    if (busy || cooldown > 0) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/verified`,
        },
      });
      if (error) throw error;
      setSentTo(email);
      setCooldown(RESEND_SECONDS);
      toast.success(`Verification link sent to ${email}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the link. Try again shortly.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-xl border border-slate-200 bg-white/80 px-3.5 py-2.5 text-sm dark:border-slate-700/80 dark:bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between print:hidden">
      <div className="flex min-w-0 items-start gap-2.5">
        <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#b8860b] dark:text-[#d4a550]" />
        <p className="min-w-0 text-slate-600 dark:text-slate-300">
          {sentTo ? (
            <>
              Link sent to{" "}
              <span className="font-medium text-slate-800 dark:text-slate-100">{sentTo}</span>. Open
              it whenever suits — your board keeps working meanwhile.
            </>
          ) : (
            <>
              You&apos;re in. When you have a moment, verify{" "}
              <span className="font-medium text-slate-800 dark:text-slate-100">{email}</span> so
              password resets and reports reach you.
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={busy || cooldown > 0}
          onClick={send}
          className="inline-flex items-center rounded-lg border border-[#b7872a]/50 px-3 py-1.5 text-xs font-semibold text-[#8a6508] transition-colors hover:bg-[#d4a550]/10 disabled:cursor-default disabled:opacity-60 dark:text-[#e1b85e]"
        >
          {busy
            ? "Sending…"
            : cooldown > 0
              ? `Sent · resend in ${cooldown}s`
              : sentTo
                ? "Resend link"
                : "Send verification link"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Later"
          title="Later"
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          Later <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
