import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const VARIANTS = {
  default:
    "inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-[var(--brand-gold-ui)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm",
  subtle:
    "inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm",
  portal:
    "btn ghost inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-focus-ring)] focus-visible:ring-offset-2 rounded-sm",
  inline:
    "inline-flex items-center gap-1.5 text-xs font-medium text-[var(--brand-gold-ui)] underline underline-offset-2 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-focus-ring)] rounded-sm",
} as const;

type Variant = keyof typeof VARIANTS;

type BackLinkBase = {
  children: ReactNode;
  className?: string;
  variant?: Variant;
};

type BackLinkProps = BackLinkBase &
  (
    | { to: string; href?: never; onClick?: never }
    | { href: string; to?: never; onClick?: never }
    | { onClick: () => void; to?: never; href?: never }
  );

function BackLinkContent({ children }: { children: ReactNode }) {
  return (
    <>
      <ChevronLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {children}
    </>
  );
}

export function BackLink({
  children,
  className,
  variant = "default",
  ...props
}: BackLinkProps) {
  const cls = cn(VARIANTS[variant], className);

  if ("to" in props && props.to) {
    return (
      <Link to={props.to} className={cls}>
        <BackLinkContent>{children}</BackLinkContent>
      </Link>
    );
  }

  if ("href" in props && props.href) {
    return (
      <a href={props.href} className={cls}>
        <BackLinkContent>{children}</BackLinkContent>
      </a>
    );
  }

  return (
    <button type="button" onClick={props.onClick} className={cls}>
      <BackLinkContent>{children}</BackLinkContent>
    </button>
  );
}
