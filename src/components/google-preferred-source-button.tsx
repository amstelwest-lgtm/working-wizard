/**
 * Google's Preferred Sources call-to-action.
 *
 * Renders the official button from
 * https://developers.google.com/search/docs/appearance/preferred-sources
 * (`publisher.js` + `[google-add-preferred-source-btn]`). This invites a
 * reader to add milonfinance.com. It does not claim the site is already a
 * preferred source or a Google partner.
 *
 * `publisher.js` scans the document once when it loads. TanStack Router
 * swaps pages without a full reload, so each mount calls `init()` again.
 * `init()` only attaches hosts that are not yet `data-initialized`, which
 * is how a newly rendered footer button survives client navigations.
 * Theme changes replace the host: the library bakes theme into a shadow
 * root and will not repaint an initialized button.
 *
 * If the library never attaches, the same spot falls back to Google's
 * source-preferences deeplink.
 */

import { useEffect, useRef, useState } from "react";

const PUBLISHER_SRC = "https://news.google.com/swg/js/v1/publisher.js";
export const PREFERRED_SOURCE_DOMAIN = "milonfinance.com";
export const PREFERRED_SOURCE_URL = `https://www.google.com/preferences/source?q=${PREFERRED_SOURCE_DOMAIN}`;
const FALLBACK_LABEL = "Add milonfinance.com as a Preferred Source in Google";
const ATTACH_TIMEOUT_MS = 4000;

type PreferredSourceTheme = "light" | "dark";

type PreferredSourceApi = {
  init: (options?: { theme?: PreferredSourceTheme | "auto"; lang?: string }) => void;
  addPreferredSource: () => void;
};

type PreferredSourceCallback = (api: PreferredSourceApi) => void;

type PreferredSourceQueue =
  | PreferredSourceCallback[]
  | { push: (...callbacks: PreferredSourceCallback[]) => void };

declare global {
  interface Window {
    PREFERRED_SOURCE?: PreferredSourceQueue;
  }
}

const scriptErrorListeners = new Set<() => void>();

function readPreferredSourceTheme(fallback: PreferredSourceTheme): PreferredSourceTheme {
  const root = document.documentElement;
  const explicit = root.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit;
  if (root.classList.contains("dark")) return "dark";
  return fallback;
}

function ensurePublisherScript() {
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${PUBLISHER_SRC}"]`);
  if (existing) {
    if (existing.dataset.preferredSourceFailed === "1") {
      scriptErrorListeners.forEach((listener) => listener());
    }
    return;
  }
  const script = document.createElement("script");
  script.src = PUBLISHER_SRC;
  script.async = true;
  script.addEventListener("error", () => {
    script.dataset.preferredSourceFailed = "1";
    scriptErrorListeners.forEach((listener) => listener());
  });
  document.head.appendChild(script);
}

function onPreferredSource(callback: PreferredSourceCallback) {
  const queue = (window.PREFERRED_SOURCE ??= []) as {
    push: (callback: PreferredSourceCallback) => void;
  };
  queue.push(callback);
}

export function GooglePreferredSourceButton({
  defaultTheme = "light",
  className = "",
}: {
  /** Theme used for the first paint, before the document theme is read. */
  defaultTheme?: PreferredSourceTheme;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<PreferredSourceTheme>(defaultTheme);
  const [useDeeplink, setUseDeeplink] = useState(false);

  useEffect(() => {
    const actual = readPreferredSourceTheme(defaultTheme);
    if (actual !== theme) {
      setTheme(actual);
      return;
    }

    let cancelled = false;
    const showDeeplink = () => {
      if (!cancelled) setUseDeeplink(true);
    };
    scriptErrorListeners.add(showDeeplink);
    ensurePublisherScript();

    const timer = window.setTimeout(() => {
      if (!hostRef.current?.shadowRoot) showDeeplink();
    }, ATTACH_TIMEOUT_MS);

    onPreferredSource((api) => {
      if (cancelled || !hostRef.current) return;
      api.init({ theme: actual });
      if (hostRef.current.shadowRoot) {
        window.clearTimeout(timer);
        setUseDeeplink(false);
      }
    });

    const observer = new MutationObserver(() => {
      const next = readPreferredSourceTheme(defaultTheme);
      if (next !== actual) setTheme(next);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });

    return () => {
      cancelled = true;
      scriptErrorListeners.delete(showDeeplink);
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [theme, defaultTheme]);

  const rootClass = ["preferred-source", className].filter(Boolean).join(" ");

  return (
    <div className={rootClass} data-preferred-source-theme={theme}>
      <div
        key={theme}
        ref={hostRef}
        hidden={useDeeplink}
        data-preferred-source-host="1"
        data-theme={theme}
        {...{ "google-add-preferred-source-btn": "" }}
      />
      {useDeeplink ? (
        <a className="preferred-source-link" href={PREFERRED_SOURCE_URL}>
          {FALLBACK_LABEL}
        </a>
      ) : null}
      <noscript>
        <a className="preferred-source-link" href={PREFERRED_SOURCE_URL}>
          {FALLBACK_LABEL}
        </a>
      </noscript>
    </div>
  );
}
