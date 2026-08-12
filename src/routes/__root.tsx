import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "sonner";
import { AuthProvider } from "@/hooks/use-auth";
import { AccountantProfileProvider } from "@/contexts/accountant-profile";
import { ViewModeProvider } from "@/contexts/view-mode";
import { ShareButton } from "@/components/share";
import { AnalyticsProvider } from "@/contexts/analytics";
import { NotesProvider } from "@/contexts/notes";
import { FloatingNoteButton } from "@/components/floating-note-button";

import appCss from "../styles.css?url";

function NotFoundComponent() {
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
  console.error(error);
  const router = useRouter();

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
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Milōn · Operating Finance" },
      { name: "description", content: "Operating finance for owner-led businesses." },
      { name: "author", content: "Milōn" },
      { property: "og:title", content: "Milōn" },
      { property: "og:description", content: "Operating finance for owner-led businesses." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "theme-color", content: "#000000" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "Milōn" },

    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,500;1,600&family=DM+Sans:wght@300;400;500&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600;700&family=Noto+Sans:wght@300;400;500;600;700;800&display=swap" },
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: "/ask-ai.css" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "icon", href: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "icon", href: "/icon-512.png", type: "image/png", sizes: "512x512" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
    ],
    scripts: import.meta.env.DEV
      ? [
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
      : [],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          FOUC guard for `/`:
          1) Blocking script runs before <body> is parsed — sets dark + landing flags
             and paints html background inline (beats async stylesheets).
          2) Critical CSS uses !important so global styles.css white defaults cannot win.
          3) Text is temporarily the same color as the background until landing.css
             loads and sets the real ink color — no readable “white page text” flash.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=location.pathname;if(p==="/"||p===""){var d=document.documentElement;d.classList.add("dark");d.dataset.theme="dark";d.dataset.landing="1";d.style.backgroundColor="#050507";d.style.color="#050507";}}catch(e){}})();`,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: [
              'html[data-landing="1"],html[data-landing="1"] body{',
              'background:#050507!important;background-color:#050507!important;',
              'color:#050507!important;',
              '}',
              'html.dark,html.dark body,html[data-theme="dark"],html[data-theme="dark"] body{',
              'background:#050507!important;background-color:#050507!important;',
              '}',
              'html[data-landing="1"] body{color:#050507!important;}',
            ].join(""),
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AccountantProfileProvider>
          <AnalyticsProvider>
            <NotesProvider>
              <ViewModeProvider>
                <Outlet />
                <ShareButton />
                <FloatingNoteButton />
                <Toaster position="top-right" richColors />
              </ViewModeProvider>
            </NotesProvider>
          </AnalyticsProvider>
        </AccountantProfileProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
