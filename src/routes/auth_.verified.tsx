import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AuthEntryCard,
  AuthEntryEyebrow,
  AuthEntryLead,
  AuthEntryShell,
  AuthEntryTitle,
} from "@/components/auth-entry-shell";

export const Route = createFileRoute("/auth_/verified")({
  component: EmailVerifiedPage,
  head: () => ({
    meta: [{ title: "Email verified — Milōn" }],
  }),
});

/**
 * Landing for the soft "verify later" magic link. The Supabase client picks
 * the session out of the URL; we stamp the metadata and go back to the board.
 * Works whether the link is opened in the original tab or on another device
 * (the link signs that device in too).
 */
function EmailVerifiedPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<"working" | "done" | "expired">("working");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let session = null as Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"];
      for (let i = 0; i < 15 && !session; i++) {
        const { data } = await supabase.auth.getSession();
        session = data.session;
        if (!session) await new Promise((r) => setTimeout(r, 100));
      }
      if (cancelled) return;
      if (!session) {
        setState("expired");
        return;
      }
      await supabase.auth
        .updateUser({
          data: { email_verify_pending: false, email_verified_at: new Date().toISOString() },
        })
        .catch(() => undefined);
      if (cancelled) return;
      setState("done");
      toast.success("Email verified — thanks.");
      void navigate({ to: "/app", replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (state === "expired") {
    return (
      <AuthEntryShell>
        <AuthEntryEyebrow>Verification</AuthEntryEyebrow>
        <AuthEntryTitle>That link has expired</AuthEntryTitle>
        <AuthEntryLead>
          Verification links work once and for a short while. Sign in and use “Send verification
          link” on your board to get a fresh one.
        </AuthEntryLead>
        <AuthEntryCard className="mt-6 text-center">
          <div className="flex flex-col gap-3">
            <Link
              to="/"
              className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-5 text-xs font-bold uppercase tracking-[0.14em] text-[#1b1300]"
            >
              Back home
            </Link>
            <Link
              to="/app"
              className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-white/15 px-5 text-xs font-bold uppercase tracking-[0.14em] text-[#c9d0cb] hover:border-white/25 hover:text-[#e8ede9]"
            >
              Open my board
            </Link>
          </div>
        </AuthEntryCard>
      </AuthEntryShell>
    );
  }

  return (
    <AuthEntryShell loading={state === "working"} loadingMessage="Verifying your email…">
      {state === "done" ? (
        <p className="text-center text-sm text-[#8a938c]">Verified — opening your board…</p>
      ) : null}
    </AuthEntryShell>
  );
}
