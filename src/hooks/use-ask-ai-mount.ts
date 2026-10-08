import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Mount the unified Milōn Bot widget into any #ask-ai-* containers present.
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

    const markStatus = (containers: HTMLElement[], status: "error", message: string) => {
      for (const el of containers) {
        el.dataset.askAiMounted = status;
        el.replaceChildren();
        const p = document.createElement("p");
        p.className = "px-3 py-3 text-xs text-slate-500";
        p.textContent = message;
        el.appendChild(p);
      }
    };

    const tryMount = () => {
      if (cancelled) return;
      const allContainers = ["ask-ai-overview", "ask-ai-waterfall"]
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => !!el);

      if (effectiveClientId) {
        (window as unknown as Record<string, unknown>).__askAiClientId = effectiveClientId;
        for (const el of allContainers) el.dataset.clientId = effectiveClientId;
      }

      // The widget mounts with or without figures — before them it carries a
      // small "more relevant once your figures are in" note. Remount when the
      // figures state flips so the note appears/disappears, and retry hard
      // errors once financials exist.
      const wantMode = hasRealFinancials ? "live" : "pre-figures";
      for (const el of allContainers) {
        const state = el.dataset.askAiMounted;
        if (state === "1" && el.dataset.askAiMode !== wantMode) {
          delete el.dataset.askAiMounted;
        } else if (state === "error" && hasRealFinancials) {
          delete el.dataset.askAiMounted;
        }
      }

      const containers = allContainers.filter((el) => el.dataset.askAiMounted !== "1");
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
          if (cancelled) return;
          if (typeof mod.mountAskAi !== "function") {
            markStatus(
              containers,
              "error",
              "Milōn Bot is unavailable right now. Refresh and try again.",
            );
            return;
          }
          for (const el of containers) {
            if (el.dataset.askAiMounted === "1") continue;
            if (effectiveClientId) el.dataset.clientId = effectiveClientId;
            el.dataset.askAiMounted = "1";
            el.dataset.askAiMode = wantMode;
            el.replaceChildren();
            const base = import.meta.env.VITE_SUPABASE_URL;
            mod.mountAskAi(el, {
              endpoint: `${base}/functions/v1/ask-ai`,
              botEndpoint: `${base}/functions/v1/milon-bot`,
              getToken: async () => {
                const { data } = await supabase.auth.getSession();
                return data.session?.access_token ?? null;
              },
              note: hasRealFinancials
                ? null
                : "Answers get more relevant once your figures are in — for now Milōn Bot can explain how the board works, what's outstanding, and what to bring in first.",
            });
          }
        })
        .catch((err: unknown) => {
          console.error("[ask-ai] mount failed", err);
          markStatus(
            containers,
            "error",
            "Milōn Bot could not load. If this keeps happening, the chat function may not be deployed yet.",
          );
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
