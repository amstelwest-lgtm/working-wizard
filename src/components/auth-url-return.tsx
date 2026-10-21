import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { wakeAuth } from "@/hooks/use-auth";
import {
  AUTH_LINK_EXPIRED,
  clearEmailReturnCookie,
  hrefWithoutAuthReturn,
  parseAuthUrlReturn,
  pathAfterAuthReturn,
  readEmailReturnCookie,
  shouldConsumeAuthReturn,
  type AuthUrlSession,
} from "@/lib/auth-url-return";

let consumeStarted = false;

/**
 * Runs on every route, including `/`. Marketing pages do not start Supabase
 * on first paint, so a Site-URL magic-link hash would otherwise sit in the URL.
 */
export function AuthUrlReturn() {
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (consumeStarted) return;
    if (typeof window === "undefined") return;
    const stored = readEmailReturnCookie(document.cookie);
    const parsed = parseAuthUrlReturn(window.location.search, window.location.hash, stored);
    if (!parsed) return;
    if (!shouldConsumeAuthReturn(window.location.pathname)) return;
    consumeStarted = true;

    const nextHref = hrefWithoutAuthReturn(window.location.href);
    window.history.replaceState(null, "", nextHref);

    if (parsed.kind === "error") {
      clearEmailReturnCookie();
      setExpired(true);
      return;
    }

    wakeAuth();
    void establishAndRoute(parsed).then((failed) => {
      if (failed) setExpired(true);
    });
  }, []);

  if (!expired) return null;
  return (
    <div
      role="alert"
      data-auth-return="expired"
      className="fixed inset-x-0 top-0 z-[80] px-4 py-3"
      style={{ background: "#ffffff", color: "#102A43", borderBottom: "1px solid #DBEAFE" }}
    >
      <p className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span>{AUTH_LINK_EXPIRED}</span>
        <Link
          to="/auth"
          className="font-semibold underline"
          style={{ color: "#0B5FFF" }}
        >
          Send a new one
        </Link>
      </p>
    </div>
  );
}

async function establishAndRoute(parsed: Extract<AuthUrlSession, { kind: "session" }>): Promise<boolean> {
  const { restoreEmailCodeVerifier } = await import("@/lib/email-sign-in");
  const { supabase } = await import("@/integrations/supabase/client");
  if (parsed.method === "exchangeCodeForSession") restoreEmailCodeVerifier();

  const established =
    parsed.method === "setSession"
      ? await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
        })
      : await supabase.auth.exchangeCodeForSession(parsed.code);

  if (established.error || !established.data.session?.user) {
    clearEmailReturnCookie();
    return true;
  }

  const user = established.data.session.user;
  let roleDestination: "/practice" | "/app" = "/app";
  if (!parsed.next && parsed.type !== "recovery" && !parsed.door) {
    const { resolveSignedInDestination } = await import("@/lib/landing-sign-in-destination");
    roleDestination = await resolveSignedInDestination(user.id, {
      door: "landing",
      knownMeta: (user.user_metadata as Record<string, unknown> | undefined) ?? null,
    });
  }

  const path = pathAfterAuthReturn({
    type: parsed.type,
    door: parsed.door,
    next: parsed.next,
    roleDestination,
  });
  if (parsed.type !== "recovery") {
    const { forcePortal } = await import("@/lib/user-roles");
    forcePortal(path === "/app" ? "owner" : "accountant");
  }
  clearEmailReturnCookie();

  const here = window.location.pathname.replace(/\/$/, "") || "/";
  const there = path.split("?")[0].replace(/\/$/, "") || "/";
  if (here !== there) window.location.replace(path);
  return false;
}
