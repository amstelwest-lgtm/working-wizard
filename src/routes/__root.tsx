import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { AuthProvider } from "@/hooks/use-auth";
import { ChunkReloadNotice } from "@/components/chunk-reload-notice";
import { CHUNK_RELOAD_BOOT_SCRIPT, installChunkReloadGuard, isChunkLoadError } from "@/lib/chunk-reload";
import { reportClientError } from "@/lib/monitoring";
import { StaleBundleBar } from "@/components/stale-bundle-bar";
import { isBarePublicPath, isPublicMarketingPath, PUBLIC_MARKETING_PATHS } from "@/lib/public-marketing";
import { AppChromeReadyContext } from "@/contexts/app-chrome-ready";

import appCss from "../styles.css?url";
import { notFoundHead, organizationGraphJson } from "@/lib/seo";
import { applyPortalTheme, resolvePortalTheme, THEME_BOOT_SCRIPT } from "@/lib/portal-theme";

const PublicChrome = lazy(() =>
  import("@/components/app-chrome").then((mod) => ({ default: mod.PublicChrome })),
);

/**
 * Signed-in chrome is a separate chunk. Rendering the lazy component during
 * hydration suspends into fallback null and drops the shell the server painted
 * (React #418, args HTML). SSR and the first client render skip it; the effect
 * mounts the same tree after hydrate.
 */
function DeferredAppChrome({ children }: { children: ReactNode }) {
  const [Chrome, setChrome] = useState<ComponentType<{ children: ReactNode }> | null>(null);
  const [chunkFailed, setChunkFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void import("@/components/app-chrome")
      .then((mod) => {
        if (!cancelled) setChrome(() => mod.AppChrome);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[app-chrome] chunk failed", err);
        if (!isChunkLoadError(err)) return;
        setChrome(null);
        setChunkFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (chunkFailed) return <ChunkReloadNotice />;
  if (!Chrome) {
    return <AppChromeReadyContext.Provider value={false}>{children}</AppChromeReadyContext.Provider>;
  }
  return (
    <AppChromeReadyContext.Provider value={true}>
      <Chrome>{children}</Chrome>
    </AppChromeReadyContext.Provider>
  );
}

function NotFoundComponent() {
  useEffect(() => {
    applyPortalTheme(resolvePortalTheme());
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  console.error(error);
  reportClientError(error, { source: "root-boundary" });
  if (isChunkLoadError(error)) return <ChunkReloadNotice />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: ({ match, matches }) => {
    // Homepage title, description, canonical, and og:url live on `/` only.
    // Unmatched paths (including /blog and /pricing, which are not routes)
    // must not inherit that metadata — they are real 404s.
    const missing = match._notFound ? notFoundHead() : null;
    // `/` self-hosts Bebas, Cormorant italic, and Noto. The other public
    // marketing pages use the system stack in marketing.css. Skip the shared
    // Google Fonts sheet (Inter, Instrument Serif, Cormorant, Noto) and
    // Ask-AI's Inter stylesheet on those routes.
    const onLanding = matches.some(
      (entry) =>
        isPublicMarketingPath(String(entry.routeId)) || String(entry.routeId) === "/",
    );
    const jsonLd = {
      type: "application/ld+json",
      children: organizationGraphJson(),
    };
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "author", content: "Milōn" },
        ...(missing?.meta ?? []),
        { name: "theme-color", content: "#0A0A0A" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-status-bar-style", content: "default" },
        { name: "apple-mobile-web-app-title", content: "Milōn" },
      ],
      links: [
        ...(onLanding
          ? []
          : [
              { rel: "preconnect" as const, href: "https://fonts.googleapis.com" },
              {
                rel: "preconnect" as const,
                href: "https://fonts.gstatic.com",
                crossOrigin: "anonymous" as const,
              },
              {
                rel: "stylesheet" as const,
                href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,500;1,600&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=Noto+Sans:wght@300;400;500;600;700;800&display=swap",
              },
              { rel: "stylesheet" as const, href: "/ask-ai.css" },
            ]),
        // Public pages inline their own CSS. The app sheet is render-blocking
        // (~300ms on mobile); RootShell starts it with media=print instead.
        ...(onLanding ? [] : [{ rel: "stylesheet" as const, href: appCss }]),
        { rel: "manifest", href: "/manifest.json" },
        { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
        { rel: "icon", href: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
        { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
        ...(missing?.links ?? []),
      ],
      scripts: import.meta.env.DEV
        ? [
            jsonLd,
            { children: CHUNK_RELOAD_BOOT_SCRIPT },
            {
              // Dev-only: report FULL browser errors (console truncates them) to
              // the server so hydration failures can be diagnosed from logs.
              children: `
(function () {
  // Defer ResizeObserver callbacks to the next animation frame. This
  // prevents the benign "ResizeObserver loop completed with undelivered
  // notifications" browser warning (fired when observed elements resize
  // within the callback, e.g. animated chart containers) from ever being
  // raised — it is otherwise picked up by error overlays as a fake crash.
  if (typeof window.ResizeObserver === "function") {
    var NativeRO = window.ResizeObserver;
    window.ResizeObserver = function (cb) {
      return new NativeRO(function (entries, observer) {
        window.requestAnimationFrame(function () { cb(entries, observer); });
      });
    };
    window.ResizeObserver.prototype = NativeRO.prototype;
  }
  function send(kind, payload) {
    try {
      var body = JSON.stringify({ kind: kind, url: location.href, ua: navigator.userAgent, payload: payload }).slice(0, 20000);
      navigator.sendBeacon ? navigator.sendBeacon("/api/client-error", body) : fetch("/api/client-error", { method: "POST", body: body });
    } catch (e) {}
  }
  window.addEventListener("error", function (e) {
    var kind = "window.error";
    // Benign browser warning fired during layout animations (charts/cards
    // resizing) — not a real error, but still log it for diagnosis.
    if (String(e.message).indexOf("ResizeObserver loop") !== -1) { e.stopImmediatePropagation(); kind = "window.error.filtered"; }
    var errRepr;
    try { errRepr = e.error instanceof Error ? null : (typeof e.error) + ":" + JSON.stringify(e.error); } catch (x) { errRepr = String(e.error); }
    send(kind, { message: String(e.message), stack: e.error && e.error.stack ? String(e.error.stack) : null, errRepr: errRepr, source: e.filename + ":" + e.lineno + ":" + e.colno });
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason || {};
    send("unhandledrejection", { message: String(r.message || r), stack: r.stack ? String(r.stack) : null });
  });
  var origErr = console.error;
  console.error = function () {
    try {
      var args = Array.prototype.slice.call(arguments).map(function (a) {
        if (a instanceof Error) return a.message + "\\n" + a.stack;
        if (typeof a === "object") { try { return JSON.stringify(a); } catch (e) { return String(a); } }
        return String(a);
      });
      var joined = args.join(" | ");
      if (/hook|Hydration|hydrat|Minified React error/i.test(joined)) send("console.error", { args: args });
    } catch (e) {}
    return origErr.apply(console, arguments);
  };
})();`,
            },
          ]
        : [jsonLd, { children: CHUNK_RELOAD_BOOT_SCRIPT }],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  // SSR + hydrate must agree on `data-landing` so FOUC CSS can paint black
  // before body. Theme (`dark` class / data-theme / inline colors) is owned by
  // the blocking script + landing toggle — React must NOT bind those or it
  // resets light mode on every shell render.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLanding = pathname === "/" || pathname === "";

  useEffect(() => {
    if (!isPublicMarketingPath(pathname)) return;
    if (document.querySelector(`link[rel="stylesheet"][href="${appCss}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = appCss;
    link.media = "print";
    link.onload = () => {
      link.media = "all";
    };
    document.head.appendChild(link);
  }, [pathname]);

  return (
    <html lang="en-US" data-landing={isLanding ? "1" : undefined} suppressHydrationWarning>
      <head>
        {/*
          FOUC guard for `/`:
          1) data-landing is SSR'd on <html>.
          2) Blocking script applies saved/default theme before body paints.
          3) Critical CSS covers dark default + light override (!important so
             styles.css cannot flash a white unstyled body).
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_BOOT_SCRIPT,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=location.pathname||"/";if(p.length>1&&p.charAt(p.length-1)==="/")p=p.slice(0,-1);var ok=${JSON.stringify(PUBLIC_MARKETING_PATHS)};if(ok.indexOf(p)<0)return;var h=${JSON.stringify(appCss)};if(document.querySelector('link[rel="stylesheet"][href="'+h+'"]'))return;var l=document.createElement("link");l.rel="stylesheet";l.href=h;l.media="print";l.onload=function(){this.media="all";this.onload=null;};document.head.appendChild(l);}catch(e){}})();`,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: [
              "html,body{margin:0}",
              'html[data-landing="1"]:not([data-theme="light"]),html[data-landing="1"]:not([data-theme="light"]) body{',
              "background:#0b1b2b!important;background-color:#0b1b2b!important;",
              "color:#f4f7fb!important;color-scheme:dark;color-scheme:only dark;",
              "}",
              'html[data-landing="1"][data-theme="light"],html[data-landing="1"][data-theme="light"] body{',
              "background:#ffffff!important;background-color:#ffffff!important;",
              "color:#102a43!important;color-scheme:light;color-scheme:only light;",
              "}",
              'html.dark:not([data-theme="light"]),html.dark:not([data-theme="light"]) body{',
              "background:#0b1b2b!important;background-color:#0b1b2b!important;",
              "}",
              // Signed-in shell, before Tailwind and owner-door.css. The boot
              // skeleton keeps its canvas, and an avatar SVG cannot fall back
              // to the 300×150 browser default (the faint giant icon).
              "[data-shell-boot]{min-height:100vh;background:#f4f6fa;box-sizing:border-box}",
              "[data-shell-boot] .milon-skeleton{display:block;background:#e4eaf2;border-radius:8px;min-height:16px}",
              "[data-shell-boot] .milon-skeleton--tile{min-height:96px;border-radius:18px}",
              ".owner-presence{width:156px;height:156px;display:inline-grid;flex:none}",
              ".owner-presence-avatar,.owner-drift,.owner-breathe,.owner-micro{width:100%;height:100%;display:grid}",
              ".owner-presence-svg{width:100%;height:100%;display:block}",
            ].join(""),
          }}
        />
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function DeferredPublicChrome() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId = 0;
    let timeoutId = 0;
    const go = () => setReady(true);
    if (typeof win.requestIdleCallback === "function") {
      idleId = win.requestIdleCallback(go, { timeout: 1500 });
    } else {
      timeoutId = window.setTimeout(go, 1);
    }
    return () => {
      if (idleId && win.cancelIdleCallback) win.cancelIdleCallback(idleId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);
  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <PublicChrome />
    </Suspense>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const bare = isBarePublicPath(pathname);
  const onPublic = isPublicMarketingPath(pathname);

  useEffect(() => {
    installChunkReloadGuard();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {bare ? (
          <Outlet />
        ) : onPublic ? (
          <>
            <Outlet />
            <DeferredPublicChrome />
          </>
        ) : (
          <DeferredAppChrome>
            <Outlet />
          </DeferredAppChrome>
        )}
        <StaleBundleBar />
      </AuthProvider>
    </QueryClientProvider>
  );
}
