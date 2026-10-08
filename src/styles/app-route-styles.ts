/**
 * App-route stylesheets as URLs, linked from the routes that use them.
 * A side-effect `import "*.css"` in a route module stays in the entry CSS
 * because TanStack does not split that module. `?url` emits a separate file
 * that public pages never request.
 */
import accountantPortalHref from "./accountant-portal.css?url";
import featureFinderHref from "./feature-finder.css?url";
import founderMetricsHref from "./founder-metrics.css?url";
import founderPortalHref from "./founder-portal.css?url";
import opsConsoleHref from "./ops-console.css?url";
import settingsPortalHref from "./settings-portal.css?url";

type StylesheetLink = { rel: "stylesheet"; href: string };
type PreloadLink = { rel: "preload"; href: string; as: "style" };
type StyleLink = StylesheetLink | PreloadLink;

function sheet(href: string): StylesheetLink {
  return { rel: "stylesheet", href };
}

/** Download the sheet with the route, then apply it. The preload is in the
 * layout head so a client navigation does not paint the portal unstyled. */
function sheetWithPreload(href: string): StyleLink[] {
  return [
    { rel: "preload", href, as: "style" },
    { rel: "stylesheet", href },
  ];
}

/** Owner board. Trial-ended blocks use accountant-portal rules (the pin hide). */
export const founderPortalLinks: StylesheetLink[] = [
  sheet(founderPortalHref),
  sheet(featureFinderHref),
  sheet(accountantPortalHref),
];

export const founderMetricsLinks: StylesheetLink[] = [
  sheet(opsConsoleHref),
  sheet(founderMetricsHref),
];

export const opsConsoleLinks: StylesheetLink[] = [sheet(opsConsoleHref)];

/**
 * Every signed-in route. These classes used to ship in the global entry, so a
 * child that rendered them without its own import still looked right. The
 * layout link restores that for `/_authenticated/*` and stays off `/` and
 * `/for-accountants`.
 */
export const authenticatedLayoutLinks: StyleLink[] = [
  ...sheetWithPreload(accountantPortalHref),
  ...sheetWithPreload(featureFinderHref),
  ...sheetWithPreload(settingsPortalHref),
];
