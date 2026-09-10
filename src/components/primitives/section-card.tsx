import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SectionCardProps = {
  title?: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  pad?: boolean;
  className?: string;
  headClassName?: string;
};

export function SectionCard({
  title,
  eyebrow,
  description,
  children,
  pad = true,
  className,
  headClassName,
}: SectionCardProps) {
  const hasHead = eyebrow || title || description;

  return (
    <section className={cn("milon-section-card", pad && "milon-section-card--pad", className)}>
      {hasHead ? (
        <div className={cn("milon-section-card__head", headClassName)}>
          {eyebrow ? <span className="milon-section-card__eyebrow">{eyebrow}</span> : null}
          {title ? <h2 className="milon-section-card__title">{title}</h2> : null}
          {description ? <p className="milon-section-card__desc">{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
