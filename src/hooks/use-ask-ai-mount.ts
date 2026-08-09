import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Mount the vanilla Ask AI widget into any #ask-ai-* containers present.
 * Retries briefly because Radix tab content / financials hydration can paint
 * the mount node one frame after the dependent state flips.
 */
export function useAskAiMount(deps: {
  effectiveClientId: string | null;
  activeTab: string;
  viewMode: string;
  hasRealFinancials: boolean;
}) {
  const { effectiveClientId, activeTab, viewMode, hasRealFinancials } = deps;

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const timers: number[] = [];

    const tryMount = () => {
      if (cancelled) return;
      const allContainers = ["ask-ai-overview", "ask-ai-waterfall"]
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => !!el);

      if (effectiveClientId) {
        (window as unknown as Record<string, unknown>).__askAiClientId = effectiveClientId;
        for (const el of allContainers) el.dataset.clientId = effectiveClientId;
      }

      const containers = allContainers.filter((el) => !el.dataset.askAiMounted);
      if (containers.length === 0) {
        if (allContainers.length === 0 && attempts < 8) {
          attempts += 1;
          timers.push(window.setTimeout(tryMount, 50 * attempts));
        }
        return;
      }

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — plain JS module without type declarations
      import("../lib/ask-ai.js")
        .then((mod: { mountAskAi?: (el: HTMLElement, opts: unknown) => void }) => {
          if (cancelled || typeof mod.mountAskAi !== "function") return;
          for (const el of containers) {
            if (el.dataset.askAiMounted) continue;
            if (effectiveClientId) el.dataset.clientId = effectiveClientId;
            el.dataset.askAiMounted = "1";
            mod.mountAskAi(el, {
              endpoint: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ask-ai`,
              getToken: async () => {
                const { data } = await supabase.auth.getSession();
                return data.session?.access_token ?? null;
              },
            });
          }
        })
        .catch(() => {
          /* Widget not yet deployed — silent fail */
        });
    };

    tryMount();
    timers.push(window.setTimeout(tryMount, 0));
    timers.push(window.setTimeout(tryMount, 100));
    timers.push(window.setTimeout(tryMount, 300));

    return () => {
      cancelled = true;
      for (const t of timers) window.clearTimeout(t);
    };
  }, [effectiveClientId, activeTab, viewMode, hasRealFinancials]);
}
