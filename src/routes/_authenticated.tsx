import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";
import { BootSkeleton } from "@/components/primitives/skeleton-blocks";
import { useAppChromeReady } from "@/contexts/app-chrome-ready";
import { useAuth } from "@/hooks/use-auth";
import { shouldStayOnAccountantPortal } from "@/lib/user-roles";
import { authenticatedLayoutLinks } from "@/styles/app-route-styles";

function FirmShellLoading() {
  return <BootSkeleton />;
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
  const { user, loading } = useAuth();
  const [Gate, setGate] = useState<ComponentType | null>(null);

  // Roles and the firm row start with the session. They used to wait until
  // the app-chrome chunk had mounted the gate, so the stay check was serial
  // after the shell chunk.
  useEffect(() => {
    if (loading || !user?.id) return;
    void shouldStayOnAccountantPortal(user.id);
  }, [loading, user?.id]);

  useEffect(() => {
    let cancelled = false;
    void import("./_authenticated.gate").then((mod) => {
      if (!cancelled) setGate(() => mod.AuthGate);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The profile provider lives in app chrome. The skeleton stays up until
  // both that chunk and the gate module are here — never a blank outlet.
  if (!chromeReady || !Gate) return <FirmShellLoading />;
  return <Gate />;
}
