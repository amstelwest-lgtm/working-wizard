import { createFileRoute, Link } from "@tanstack/react-router";
import { BackLink } from "@/components/back-link";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { previewAccessToken, redeemAccessToken } from "@/lib/practice-access.functions";

export const Route = createFileRoute("/access/$token")({
  component: AccessApprovePage,
  head: () => ({ meta: [{ title: "Approve access — Milōn" }] }),
});

function AccessApprovePage() {
  const { token } = Route.useParams();
  const preview = useServerFn(previewAccessToken);
  const redeem = useServerFn(redeemAccessToken);
  const [status, setStatus] = useState<"loading" | "ready" | "done" | "error">("loading");
  const [message, setMessage] = useState("Opening…");
  const [purpose, setPurpose] = useState("");
  const [detail, setDetail] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const p = await preview({ data: { token } });
        if (!alive) return;
        if (!p.purpose) {
          setStatus("error");
          setMessage("This link is invalid.");
          return;
        }
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
        setPurpose(p.purpose);
        const bits = [p.memberName, p.memberEmail, p.classification, p.clientName, p.firmName].filter(
          Boolean,
        );
        setDetail(bits.join(" · "));
        if (p.purpose === "firm_invite") {
          const { data } = await supabase.auth.getUser();
          if (!data.user) {
            setNeedsSignIn(true);
            setStatus("ready");
            setMessage("Sign in with the invited email, then approve this invitation.");
            return;
          }
        }
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
  }, [preview, token]);

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

  const title =
    status === "loading"
      ? "Verifying access"
      : status === "done"
        ? "Complete"
        : purpose === "firm_invite"
          ? "Practice invitation"
          : "Client access";

  return (
    <main className="flex min-h-screen flex-col bg-[#0a0c0b] px-5 pb-10 pt-8 text-[#e8ede9]">
      <div className="mx-auto w-full max-w-md flex-1">
        <header className="mb-8">
          <span className="text-sm font-black tracking-[0.35em] text-[var(--brand-gold-ui)]">MILŌN</span>
        </header>
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a938c]">
          {purpose === "firm_invite" ? "Firm access" : "Client file"}
        </p>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight">{title}</h1>
        <div className="mt-6 rounded-2xl border border-white/10 bg-[#10130f] p-7 text-center shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
          {status === "loading" ? (
            <div className="flex flex-col items-center gap-4 py-6">
              <div
                className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--brand-gold-ui)]/25 border-t-[var(--brand-gold-ui)]"
                aria-hidden
              />
              <p className="text-sm text-[#8a938c]">{message}</p>
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
              {status === "ready" && needsSignIn ? (
                <Link
                  to="/auth"
                  search={{ next: `/access/${token}` }}
                  className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-6 text-xs font-bold uppercase tracking-[0.14em] text-[#1b1300]"
                >
                  Sign in to accept
                </Link>
              ) : null}
              {status === "ready" && !needsSignIn ? (
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                  <button
                    type="button"
                    onClick={() => void act("approve")}
                    className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-5 text-xs font-bold uppercase tracking-[0.14em] text-[#1b1300] sm:max-w-[160px]"
                  >
                    {purpose === "firm_invite" ? "Accept" : "Approve"}
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
