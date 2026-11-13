import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { BootSkeleton } from "@/components/primitives/skeleton-blocks";
import { useAppChromeReady } from "@/contexts/app-chrome-ready";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";
import { authenticatedLayoutLinks } from "@/styles/app-route-styles";

function FirmShellLoading() {
  return <BootSkeleton />;
}

type GateModule = { AuthGate: ComponentType };
let gateLoaderForTests: (() => Promise<GateModule>) | null = null;

/** Tests substitute the gate chunk so the shell timer can be observed. */
export function setAuthenticatedGateLoaderForTests(loader: (() => Promise<GateModule>) | null): void {
  gateLoaderForTests = loader;
}

function ShellLoadRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-background px-6 py-8 text-foreground" data-shell-retry="" role="alert">
      <h1 className="text-xl font-semibold">This page is still loading</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        The practice shell did not finish opening. Retry, or refresh the page.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex h-10 items-center rounded-full bg-foreground px-4 text-xs font-bold uppercase tracking-wider text-background"
      >
        Retry
      </button>
    </div>
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

export function AuthenticatedShell() {
  const chromeReady = useAppChromeReady();
  const [Gate, setGate] = useState<ComponentType | null>(null);
  const [shellRetry, setShellRetry] = useState(false);
  const [gateAttempt, setGateAttempt] = useState(0);
  const shellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Starts with the shell, before the chrome chunk or the gate chunk settles.
  useEffect(() => {
    shellTimer.current = window.setTimeout(() => setShellRetry(true), SHELL_GATE_TIMEOUT_MS);
    return () => {
      if (shellTimer.current) window.clearTimeout(shellTimer.current);
      shellTimer.current = null;
    };
  }, [gateAttempt]);

  useEffect(() => {
    if (!chromeReady) return;
    let cancelled = false;
    const load = gateLoaderForTests ?? (() => import("./_authenticated.gate"));
    void load().then((mod) => {
      if (cancelled) return;
      if (shellTimer.current) {
        window.clearTimeout(shellTimer.current);
        shellTimer.current = null;
      }
      setShellRetry(false);
      setGate(() => mod.AuthGate);
    });
    return () => {
      cancelled = true;
    };
  }, [chromeReady, gateAttempt]);

  if (!Gate) {
    if (shellRetry) {
      return (
        <ShellLoadRetry
          onRetry={() => {
            setShellRetry(false);
            setGate(null);
            if (!chromeReady) {
              window.location.reload();
              return;
            }
            setGateAttempt((n) => n + 1);
          }}
        />
      );
    }
    return <FirmShellLoading />;
  }
  return <Gate />;
}
