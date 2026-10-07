import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/** Firm-home Open queries destination. A real href, not only an onClick. */
export type MetricTileLink = {
  to: "/clients/$clientId";
  params: { clientId: string };
  search: { queries: "open" };
};

export type MetricTileProps = {
  label: ReactNode;
  value: ReactNode;
  footnote?: ReactNode;
  footnoteClassName?: string;
  icon?: ReactNode;
  sparkline?: ReactNode;
  onClick?: () => void;
  /** When set, the tile navigates here. Takes precedence over onClick. */
  link?: MetricTileLink;
  id?: string;
  valueClassName?: string;
  className?: string;
};

export function MetricTile({
  label,
  value,
  footnote,
  footnoteClassName,
  icon,
  sparkline,
  onClick,
  link,
  id,
  valueClassName,
  className,
}: MetricTileProps) {
  const interactive = Boolean(onClick || link);
  const classes = cn("milon-metric-tile", interactive && "milon-metric-tile--interactive", className);
  const body = (
    <>
      <div className="milon-metric-tile__label">
        {icon}
        {label}
      </div>
      <div className={cn("milon-metric-tile__value", valueClassName)}>{value}</div>
      {footnote || sparkline ? (
        <div className="milon-metric-tile__foot">
          {footnote ? <div className={footnoteClassName}>{footnote}</div> : <span />}
          {sparkline}
        </div>
      ) : null}
    </>
  );

  if (link) {
    return (
      <Link id={id} to={link.to} params={link.params} search={link.search} className={classes}>
        {body}
      </Link>
    );
  }

  const Tag = onClick ? "button" : "div";
  return (
    <Tag id={id} type={onClick ? "button" : undefined} onClick={onClick} className={classes}>
      {body}
    </Tag>
  );
}
