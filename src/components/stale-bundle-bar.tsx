import { useEffect, useState } from "react";
import {
  STALE_BUNDLE_POLL_MS,
  STALE_BUNDLE_READY,
  STALE_BUNDLE_RELOAD,
  remoteBuildIsNewer,
} from "@/lib/stale-bundle";

const BUILD_ID = import.meta.env.VITE_BUILD_ID ?? "";

/**
 * Soft notice when a deploy has shipped a newer bundle.
 * Checks on window focus and about every 10 minutes. The Reload button is
 * the only way the page reloads — an open form is left as it is.
 */
export function StaleBundleBar({ forceVisible = false }: { forceVisible?: boolean }) {
  const [stale, setStale] = useState(forceVisible);

  useEffect(() => {
    if (forceVisible || !BUILD_ID) return;
    let cancelled = false;
    const check = () => {
      void fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" })
        .then(async (res) => (res.ok ? ((await res.json()) as unknown) : null))
        .then((body) => {
          if (cancelled || body == null) return;
          if (remoteBuildIsNewer(BUILD_ID, body)) setStale(true);
        })
        .catch(() => {
          // Offline, or the file is not on this server. Keep the current bundle.
        });
    };
    check();
    window.addEventListener("focus", check);
    const timer = window.setInterval(check, STALE_BUNDLE_POLL_MS);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", check);
      window.clearInterval(timer);
    };
  }, [forceVisible]);

  if (!stale) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex justify-center px-4">
      <div
        role="status"
        data-stale-bundle="bar"
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-800 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <span>{STALE_BUNDLE_READY}</span>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          className="font-semibold text-[#8a6a12] underline-offset-2 hover:underline dark:text-[#e4c56a]"
          onClick={() => window.location.reload()}
        >
          {STALE_BUNDLE_RELOAD}
        </button>
      </div>
    </div>
  );
}
