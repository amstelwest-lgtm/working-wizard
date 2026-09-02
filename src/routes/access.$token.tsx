import { createFileRoute, Link } from "@tanstack/react-router";
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0c0b] px-5 text-[#e8ede9]">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#10130f] p-8 text-center">
        <p className="text-sm font-black tracking-[0.35em] text-[#d4a550]">MILŌN</p>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">
          {status === "loading" ? "Working…" : status === "done" ? "Done" : "Access"}
        </h1>
        <p className={`mt-3 text-sm leading-relaxed ${status === "error" ? "text-rose-300" : "text-[#8a938c]"}`}>
          {message}
        </p>
        {detail ? <p className="mt-2 text-xs text-[#c5b48a]">{detail}</p> : null}
        {status === "ready" && needsSignIn ? (
          <Link
            to="/auth"
            search={{ next: `/access/${token}` }}
            className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-6 text-xs font-bold uppercase tracking-wider text-[#1b1300]"
          >
            Sign in to accept
          </Link>
        ) : null}
        {status === "ready" && !needsSignIn ? (
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => void act("approve")}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-gradient-to-r from-[#ac8400] via-[#d4af37] to-[#fdee79] px-5 text-xs font-bold uppercase tracking-wider text-[#1b1300]"
            >
              {purpose === "firm_invite" ? "Accept" : "Approve"}
            </button>
            <button
              type="button"
              onClick={() => void act("decline")}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-white/15 px-5 text-xs font-bold uppercase tracking-wider text-[#c9d0cb]"
            >
              Decline
            </button>
          </div>
        ) : null}
        {status === "done" ? (
          <Link to="/" className="mt-6 inline-block text-xs text-[#d4a550] underline">
            Back to Milōn
          </Link>
        ) : null}
      </div>
    </main>
  );
}
