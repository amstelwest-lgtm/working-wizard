import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  dashed?: boolean;
  className?: string;
  id?: string;
};

export function EmptyState({
  title,
  description,
  icon,
  action,
  dashed = false,
  className,
  id,
}: EmptyStateProps) {
  return (
    <div
      id={id}
      className={cn("milon-empty-state", dashed && "milon-empty-state--dashed", className)}
      role="status"
    >
      {icon ? <div className="milon-empty-state__icon">{icon}</div> : null}
      <h3 className="milon-empty-state__title">{title}</h3>
      {description ? <p className="milon-empty-state__desc">{description}</p> : null}
      {action ? <div className="milon-empty-state__actions">{action}</div> : null}
    </div>
  );
}
