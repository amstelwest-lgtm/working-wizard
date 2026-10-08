import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { resolveSmartLanding } from "@/lib/smart-landing.functions";
import {
  isSafeSmartLandingHref,
  SMART_LANDING_PATH,
  decideSmartLanding,
} from "@/lib/smart-landing";

export const Route = createFileRoute("/open")({
  component: OpenLanding,
  head: () => ({
    meta: [{ title: "Opening Milōn" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function go(href: string) {
  const next = isSafeSmartLandingHref(href) ? href : "/dashboard";
  window.location.replace(next);
}

function OpenLanding() {
  const { user, loading } = useAuth();
  const resolve = useServerFn(resolveSmartLanding);
  const started = useRef(false);

  useEffect(() => {
    if (loading || started.current) return;
    started.current = true;
    if (!user) {
      go(decideSmartLanding({ signedIn: false, entitled: false }).href);
      return;
    }
    void resolve()
      .then((decision) => {
        go(decision.href);
      })
      .catch(() => {
        go(`/auth?next=${SMART_LANDING_PATH}`);
      });
  }, [loading, user, resolve]);

  return (
    <div className="grid min-h-screen place-items-center bg-background text-foreground">
      Opening Milōn…
    </div>
  );
}
