import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

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

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4 gap-4">
      <img src="/milon-wordmark.png" alt="Milōn" className="h-8 w-auto" />
      {state === "expired" ? (
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center space-y-3">
          <h1 className="text-lg font-semibold">That link has expired</h1>
          <p className="text-sm text-muted-foreground">
            Verification links work once and for a short while. Sign in and use “Send verification
            link” on your board to get a fresh one.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2 text-sm">
            <Link to="/" className="text-primary underline">
              Back home
            </Link>
            <Link to="/app" className="text-primary underline">
              Open my board
            </Link>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {state === "done" ? "Verified — opening your board…" : "Verifying your email…"}
        </p>
      )}
    </div>
  );
}
