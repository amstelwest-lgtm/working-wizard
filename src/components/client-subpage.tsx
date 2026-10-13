import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/primitives/page-header";
import { accountantClientTabSearch } from "@/lib/client-route-search";

/** Header back control. The link pushes history, so browser back returns here. */
export function ClientBackLink({
  clientId,
  label,
  tab,
}: {
  clientId: string;
  label: string;
  tab: string;
}) {
  return (
    <Link
      to="/clients/$clientId"
      params={{ clientId }}
      search={(prev) => accountantClientTabSearch(prev, tab)}
      className="client-subpage-back"
    >
      <span aria-hidden="true">←</span>
      Back to {label}
    </Link>
  );
}

/** Big title, subtitle, and the section that belongs on this page alone. */
export function ClientSubpageFrame({
  id,
  eyebrow,
  title,
  subtitle,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="client-subpage" data-subpage={id}>
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      {children}
    </section>
  );
}

export type ClientSubpageLink = {
  id: string;
  label: string;
  detail: string;
  search: (prev: Record<string, unknown>) => Record<string, unknown>;
};

/** Parent page when every former section now has its own URL. */
export function ClientSectionOverview({
  clientId,
  eyebrow,
  title,
  subtitle,
  links,
}: {
  clientId: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  links: ClientSubpageLink[];
}) {
  return (
    <section className="client-subpage" data-subpage="overview">
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <ul className="client-subpage-links">
        {links.map((link) => (
          <li key={link.id}>
            <Link
              to="/clients/$clientId"
              params={{ clientId }}
              search={link.search}
              className="client-subpage-link"
              data-subpage-link={link.id}
            >
              <span className="client-subpage-link__label">{link.label}</span>
              <span className="client-subpage-link__detail">{link.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
