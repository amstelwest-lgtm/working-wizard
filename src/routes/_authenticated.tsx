import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import { useAppChromeReady } from "@/contexts/app-chrome-ready";
import { authenticatedLayoutLinks } from "@/styles/app-route-styles";

function FirmShellLoading() {
  return (
    <div className="min-h-screen grid place-items-center bg-background text-foreground">Loading…</div>
  );
}

export const Route = createFileRoute("/_authenticated")({
  // Portal, finder, and settings sheets for every child. Preload plus
  // stylesheet so a client navigation into this layout does not paint unstyled.
  head: () => ({ links: authenticatedLayoutLinks }),
  // Keep this shell in the route module. A split component chunk suspends into
  // the parent Suspense (fallback null) and drops the loading node the server
  // already rendered (React #418, args HTML).
  codeSplitGroupings: [],
  pendingComponent: FirmShellLoading,
  pendingMs: 0,
  component: AuthenticatedShell,
});

function AuthenticatedShell() {
  const chromeReady = useAppChromeReady();
  const [Gate, setGate] = useState<ComponentType | null>(null);

  useEffect(() => {
    if (!chromeReady) return;
    let cancelled = false;
    void import("./_authenticated.gate").then((mod) => {
      if (!cancelled) setGate(() => mod.AuthGate);
    });
    return () => {
      cancelled = true;
    };
  }, [chromeReady]);

  if (!Gate) return <FirmShellLoading />;
  return <Gate />;
}
