import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusPillVariant = "ok" | "warn" | "risk" | "neutral" | "live" | "sample";

export type StatusPillProps = {
  variant: StatusPillVariant;
  children: ReactNode;
  pulse?: boolean;
  dot?: boolean;
  className?: string;
};

const VARIANT_CLASS: Record<StatusPillVariant, string> = {
  ok: "milon-status-pill--ok",
  warn: "milon-status-pill--warn",
  risk: "milon-status-pill--risk",
  neutral: "milon-status-pill--neutral",
  live: "milon-status-pill--live",
  sample: "milon-status-pill--sample",
};

export function StatusPill({
  variant,
  children,
  pulse = false,
  dot = true,
  className,
}: StatusPillProps) {
  return (
    <span
      className={cn(
        "milon-status-pill",
        VARIANT_CLASS[variant],
        pulse && "milon-status-pill--pulse",
        className,
      )}
    >
      {dot ? <i aria-hidden /> : null}
      {children}
    </span>
  );
}

/** Map health display tiers to StatusPill variants (accountant chips). */
export function statusPillFromHealth(
  status: "healthy" | "at_risk" | "critical" | null | undefined,
): StatusPillVariant {
  if (status === "healthy") return "ok";
  if (status === "at_risk") return "warn";
  if (status === "critical") return "risk";
  return "neutral";
}
