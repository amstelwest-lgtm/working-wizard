import { useEffect, useLayoutEffect, useRef } from "react";
import {
  agentDocumentTitle,
  agentTitleBaseline,
  titleAfterAgentLeaves,
} from "@/lib/agent-document-title";

/** useLayoutEffect before paint in the browser. useEffect on the server, which does not warn. */
const useClientLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

/**
 * Set document.title to the open agent before the browser paints that shell.
 * Pass null while the agent is still unknown. Unmounting restores the title
 * this page had, unless that title was itself an agent (Tax does not stick).
 */
export function useAgentDocumentTitle(agentShortName: string | null | undefined): void {
  const baseline = useRef<string | null>(null);
  const active = useRef<string | null>(null);
  useClientLayoutEffect(() => {
    if (typeof document === "undefined") return;
    if (baseline.current == null) baseline.current = agentTitleBaseline(document.title);
    const next = agentDocumentTitle(agentShortName);
    active.current = next;
    document.title = next;
    return () => {
      const previous = active.current;
      active.current = null;
      if (previous == null || baseline.current == null) return;
      document.title = titleAfterAgentLeaves(previous, document.title, baseline.current);
    };
  }, [agentShortName]);
}
