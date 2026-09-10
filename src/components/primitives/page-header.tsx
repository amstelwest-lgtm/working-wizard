import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PageHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  meta,
  compact = false,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn("milon-page-header", compact && "milon-page-header--compact", className)}
    >
      <div className="milon-page-header__main">
        {eyebrow ? <span className="milon-page-header__eyebrow">{eyebrow}</span> : null}
        <h1 className="milon-page-header__title">{title}</h1>
        {subtitle ? <p className="milon-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {meta ? <div className="milon-page-header__meta">{meta}</div> : null}
    </header>
  );
}
