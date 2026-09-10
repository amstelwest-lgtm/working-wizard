import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type MetricTileProps = {
  label: ReactNode;
  value: ReactNode;
  footnote?: ReactNode;
  footnoteClassName?: string;
  icon?: ReactNode;
  sparkline?: ReactNode;
  onClick?: () => void;
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
  valueClassName,
  className,
}: MetricTileProps) {
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "milon-metric-tile",
        onClick && "milon-metric-tile--interactive",
        className,
      )}
    >
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
    </Tag>
  );
}
