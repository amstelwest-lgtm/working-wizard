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

function sheet(href: string): StylesheetLink {
  return { rel: "stylesheet", href };
}

export const accountantPortalLinks: StylesheetLink[] = [
  sheet(accountantPortalHref),
  sheet(featureFinderHref),
];

export const reportsPortalLinks: StylesheetLink[] = [sheet(accountantPortalHref)];

export const settingsPortalLinks: StylesheetLink[] = [
  sheet(accountantPortalHref),
  sheet(settingsPortalHref),
];

export const founderPortalLinks: StylesheetLink[] = [
  sheet(founderPortalHref),
  sheet(featureFinderHref),
];

export const founderMetricsLinks: StylesheetLink[] = [
  sheet(opsConsoleHref),
  sheet(founderMetricsHref),
];

export const opsConsoleLinks: StylesheetLink[] = [sheet(opsConsoleHref)];
