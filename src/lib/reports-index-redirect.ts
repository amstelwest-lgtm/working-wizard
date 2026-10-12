/**
 * `/reports` is not a page. A client id opens that client's Reports tab.
 * Anything else goes back to practice Home. The redirect is one hop:
 * the search written here is already canonical, and undefined keys are
 * omitted so validateSearch does not rewrite the URL again.
 */

export type ReportsIndexSearch = {
  client?: string;
  clientId?: string;
  report?: string;
  action?: "download" | "preview";
};

export function reportsIndexSearch(search: Record<string, unknown>): ReportsIndexSearch {
  const out: ReportsIndexSearch = {};
  if (typeof search.client === "string" && search.client) out.client = search.client;
  else if ("client" in search) out.client = undefined;
  if (typeof search.clientId === "string" && search.clientId) out.clientId = search.clientId;
  else if ("clientId" in search) out.clientId = undefined;
  if (typeof search.report === "string" && search.report.length > 0 && search.report.length <= 64) {
    out.report = search.report;
  } else if ("report" in search) out.report = undefined;
  if (search.action === "download" || search.action === "preview") out.action = search.action;
  else if ("action" in search) out.action = undefined;
  return out;
}

export type ReportsIndexRedirect =
  | { to: "/dashboard" }
  | {
      to: "/clients/$clientId";
      params: { clientId: string };
      search: { tab: "reports"; report?: string; action?: "preview" | "download" };
    };

export function reportsIndexRedirect(search: ReportsIndexSearch): ReportsIndexRedirect {
  const clientId = (search.clientId || search.client || "").trim();
  if (!clientId) return { to: "/dashboard" };
  const next: { tab: "reports"; report?: string; action?: "preview" | "download" } = {
    tab: "reports",
  };
  if (search.report) next.report = search.report;
  if (search.action === "preview" || search.action === "download") next.action = search.action;
  return {
    to: "/clients/$clientId",
    params: { clientId },
    search: next,
  };
}
