import type { ReactNode } from "react";
import type { VisitorCopyPack } from "@/lib/market/marketing";

/** Landing / stateful surfaces — only the active region's copy is rendered. */
export function RegionCopy({
  pack,
  za,
  us,
}: {
  pack: VisitorCopyPack;
  za: ReactNode;
  us: ReactNode;
}) {
  return <>{pack === "us" ? us : za}</>;
}
