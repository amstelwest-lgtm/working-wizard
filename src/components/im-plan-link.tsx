import type { MouseEvent, ReactNode } from "react";
import { Link } from "@tanstack/react-router";

type ClientSearch = {
  tab?: string;
  section?: string;
  agent?: "financial_manager" | "analyst" | "advisor" | "tax_specialist";
  report?: string;
  action?: "preview" | "download";
};

function clientSearch(params: URLSearchParams): ClientSearch {
  const search: ClientSearch = {};
  const tab = params.get("tab");
  const section = params.get("section");
  const report = params.get("report");
  const agent = params.get("agent");
  const action = params.get("action");
  if (tab) search.tab = tab;
  if (section) search.section = section;
  if (report) search.report = report;
  if (
    agent === "financial_manager" ||
    agent === "analyst" ||
    agent === "advisor" ||
    agent === "tax_specialist"
  ) {
    search.agent = agent;
  }
  if (action === "preview" || action === "download") search.action = action;
  return search;
}

/** Internal plan and next-step links. Query strings stay on the client route. */
export function ImPlanLink({
  href,
  className,
  children,
  onClick,
  ...rest
}: {
  href: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  "data-im-plan-action"?: string;
}) {
  const url = new URL(href, "https://milon.invalid");
  const client = /^\/clients\/([^/]+)$/.exec(url.pathname);
  const click = onClick
    ? (event: MouseEvent<HTMLAnchorElement>) => {
        onClick();
        void event;
      }
    : undefined;
  if (client) {
    return (
      <Link
        to="/clients/$clientId"
        params={{ clientId: decodeURIComponent(client[1]) }}
        search={clientSearch(url.searchParams)}
        className={className}
        onClick={click}
        {...rest}
      >
        {children}
      </Link>
    );
  }
  if (url.pathname === "/clients" || url.pathname === "/clients/") {
    return (
      <Link to="/clients" className={className} onClick={click} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <Link to="/clients" className={className} onClick={click} {...rest}>
      {children}
    </Link>
  );
}
