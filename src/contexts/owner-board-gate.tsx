import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";

type OwnerBoardGate = {
  /**
   * True only on /app until the owner board reports ready.
   * Practice routes stay false so brand and profile still load immediately.
   */
  deferSideReads: boolean;
  reportOwnerBoardReady: (ready: boolean) => void;
};

const OwnerBoardGateContext = createContext<OwnerBoardGate>({
  deferSideReads: false,
  reportOwnerBoardReady: () => {},
});

export function isOwnerAppPath(pathname: string): boolean {
  let path = pathname || "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path === "/app";
}

export function OwnerBoardGateProvider({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onOwnerApp = isOwnerAppPath(pathname);
  const [reportedReady, setReportedReady] = useState(false);
  const value = useMemo<OwnerBoardGate>(
    () => ({
      deferSideReads: onOwnerApp && !reportedReady,
      reportOwnerBoardReady: setReportedReady,
    }),
    [onOwnerApp, reportedReady],
  );
  return <OwnerBoardGateContext.Provider value={value}>{children}</OwnerBoardGateContext.Provider>;
}

export function useOwnerBoardGate(): OwnerBoardGate {
  return useContext(OwnerBoardGateContext);
}
