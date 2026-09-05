import { createFileRoute, Link, useNavigate, ClientOnly } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  destinationAfterConfirm,
  establishSessionFromEmailRedirect,
  marketFromSignupMeta,
  ownerDisplayName,
} from "@/lib/email-confirm";
import {
  readVisitorMarket,
  withMarketRpcFallback,
  writeVisitorMarket,
} from "@/lib/market";
import { forcePortal, isPracticeSignupMeta } from "@/lib/user-roles";

export const Route = createFileRoute("/confirm")({
  ssr: false,
  pendingComponent: ConfirmShell,
  component: function ConfirmRoute() {
    return (
      <ClientOnly fallback={<ConfirmShell />}>
        <ConfirmPage />
      </ClientOnly>
    );
  },
  head: () => ({
    meta: [{ title: "Confirming your email — Milōn" }],
  }),
});

function ConfirmShell({ children }: { children?: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#050507",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 16px",
      }}
    >
      {children ?? (
        <ConfirmCard>
          <StatusIcon kind="busy" />
          <h1 style={h1}>Opening Milōn…</h1>
          <p style={body}>One moment while we confirm your email.</p>
        </ConfirmCard>
      )}
    </div>
  );
}

function ConfirmCard({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 420,
        borderRadius: 28,
        padding: "44px 36px",
        background: "rgba(13,13,20,.96)",
        border: "1px solid rgba(212,175,55,.2)",
        boxShadow: "0 30px 80px rgba(0,0,0,.6)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          marginBottom: 32,
        }}
      >
        <img src="/milon-centaur.svg" alt="" width={21} height={30} />
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: "#d4af37",
          }}
        >
          MILŌN
        </span>
      </div>
      {children}
    </div>
  );
}

function StatusIcon({ kind }: { kind: "busy" | "ok" | "err" }) {
  const wrap: CSSProperties = {
    width: 52,
    height: 52,
    borderRadius: "50%",
    background: "rgba(212,175,55,.1)",
    display: "grid",
    placeItems: "center",
    margin: "0 auto 22px",
  };
  if (kind === "busy") {
    return (
      <div style={wrap} aria-hidden>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: "2px solid rgba(212,175,55,.25)",
            borderTopColor: "#d4af37",
            animation: "milon-spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes milon-spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }
  if (kind === "ok") {
    return (
      <div style={wrap} aria-hidden>
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#d4af37"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    );
  }
  return (
    <div style={wrap} aria-hidden>
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#d4af37"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    </div>
  );
}

const h1: CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: "#f2ecdc",
  margin: "0 0 10px",
};
const body: CSSProperties = {
  fontSize: 14,
  color: "#9b958a",
  lineHeight: 1.6,
  margin: 0,
};

function ConfirmPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const established = await establishSessionFromEmailRedirect();
      if (cancelled) return;
      if (established.error) {
        setError(established.error);
        return;
      }

      const { data } = await supabase.auth.getUser();
      const user = data.user;
      if (!user) {
        setError("We couldn't confirm this link. Sign in to open your workspace.");
        return;
      }

      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      const dest = destinationAfterConfirm(meta, established.type);

      if (dest === "/reset-password") {
        if (!cancelled) {
          void navigate({ to: "/reset-password", replace: true });
        }
        return;
      }

      if (isPracticeSignupMeta(meta)) {
        forcePortal("accountant");
      } else {
        forcePortal("owner");
        const market = marketFromSignupMeta(meta) ?? readVisitorMarket();
        if (market) writeVisitorMarket(market);
        const clientName = ownerDisplayName(meta, user.email);
        const { error: rpcErr } = await withMarketRpcFallback(
          () =>
            supabase.rpc("ensure_own_client", {
              p_name: clientName,
              p_market: market ?? { country: "ZA", regionCode: null },
            }),
          () => supabase.rpc("ensure_own_client", { p_name: clientName }),
        );
        if (rpcErr) console.error("[confirm] ensure_own_client failed:", rpcErr.message);
      }

      if (cancelled) return;
      setDone(true);
      window.setTimeout(() => {
        if (cancelled) return;
        if (dest === "/dashboard") void navigate({ to: "/dashboard", replace: true });
        else void navigate({ to: "/app", replace: true });
      }, 700);
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <ConfirmShell>
      <ConfirmCard>
        {error ? (
          <>
            <StatusIcon kind="err" />
            <h1 style={h1}>Couldn’t confirm your email</h1>
            <p style={body}>{error}</p>
            <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 26 }}>
              <Link to="/" style={{ color: "#d4af37", fontSize: 13, textDecoration: "none" }}>
                Back home
              </Link>
              <Link
                to="/auth"
                search={{}}
                style={{ color: "#d4af37", fontSize: 13, textDecoration: "none" }}
              >
                Sign in
              </Link>
            </div>
          </>
        ) : done ? (
          <>
            <StatusIcon kind="ok" />
            <h1 style={h1}>You’re in</h1>
            <p style={body}>Email confirmed. Opening your workspace…</p>
          </>
        ) : (
          <>
            <StatusIcon kind="busy" />
            <h1 style={h1}>Confirming your email</h1>
            <p style={body}>This takes a moment. Stay on this page — we’ll open your workspace next.</p>
          </>
        )}
      </ConfirmCard>
    </ConfirmShell>
  );
}
