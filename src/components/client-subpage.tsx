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
  subtitle?: string | null;
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
  /** The action this page wants first. One link, drawn as the primary card. */
  primary?: boolean;
  search: (prev: Record<string, unknown>) => Record<string, unknown>;
};

/** Parent page when every former section now has its own URL. */
export function ClientSectionOverview({
  clientId,
  eyebrow,
  title,
  subtitle,
  links,
  variant = "cards",
}: {
  clientId: string;
  eyebrow: string;
  title: string;
  subtitle?: string | null;
  links: ClientSubpageLink[];
  /** `lines` is two plain rows. Health uses it so the parent is not a second profile. */
  variant?: "cards" | "lines";
}) {
  const lines = variant === "lines";
  return (
    <section
      className="client-subpage"
      data-subpage="overview"
      data-subpage-lines={lines ? "true" : undefined}
    >
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle || undefined} />
      <ul className={lines ? "client-subpage-links client-subpage-links--lines" : "client-subpage-links"}>
        {links.map((link) => (
          <li key={link.id}>
            <Link
              to="/clients/$clientId"
              params={{ clientId }}
              search={link.search}
              className={
                lines
                  ? "client-subpage-link client-subpage-link--line"
                  : link.primary
                    ? "client-subpage-link client-subpage-link--primary"
                    : "client-subpage-link"
              }
              data-subpage-link={link.id}
              data-primary={link.primary ? "true" : undefined}
            >
              <span className="client-subpage-link__label">{link.label}</span>
              {lines ? (
                <span className="client-subpage-link__chev" aria-hidden="true">
                  ›
                </span>
              ) : (
                <span className="client-subpage-link__detail">{link.detail}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
