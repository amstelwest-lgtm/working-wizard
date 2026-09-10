import type React from "react";
import { cn } from "@/lib/utils";

type BlockProps = React.HTMLAttributes<HTMLDivElement>;

export function SkeletonBlock({ className, ...props }: BlockProps) {
  return <div className={cn("milon-skeleton", className)} aria-hidden {...props} />;
}

export function SkeletonTile({ className }: BlockProps) {
  return <div className={cn("milon-skeleton milon-skeleton--tile", className)} aria-hidden />;
}

/** Accountant dashboard — stats strip + client table placeholder. */
export function DashboardSkeleton({ className }: BlockProps) {
  return (
    <div className={cn("milon-skeleton-panel space-y-6", className)} role="status" aria-live="polite">
      <span className="sr-only">Loading dashboard…</span>
      <div className="milon-skeleton-panel__head">
        <SkeletonBlock className="h-9 w-48 max-w-[60%]" />
        <SkeletonBlock className="h-4 w-28" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonTile key={i} />
        ))}
      </div>
      <SkeletonBlock className="h-64 w-full rounded-[20px]" />
    </div>
  );
}

/** Accountant client workspace — header card + tab content area. */
export function ClientWorkspaceSkeleton({ className }: BlockProps) {
  return (
    <div className={cn("accountant-portal milon-skeleton-panel", className)} role="status" aria-live="polite">
      <span className="sr-only">Loading client…</span>
      <div id="atmos" aria-hidden>
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="grid" />
      </div>
      <div className="shell milon-page-enter">
        <SkeletonBlock className="mb-6 h-12 w-full rounded-full" />
        <SkeletonBlock className="mb-4 h-4 w-56" />
        <div className="card client-head flex gap-4 p-6">
          <SkeletonBlock className="milon-skeleton--circle h-[74px] w-[74px] shrink-0" />
          <div className="flex flex-1 flex-col gap-3">
            <SkeletonBlock className="h-8 w-48 max-w-[70%]" />
            <SkeletonBlock className="h-4 w-32" />
            <SkeletonBlock className="h-4 w-full max-w-md" />
          </div>
        </div>
        <SkeletonBlock className="mt-6 h-10 w-full rounded-full" />
        <SkeletonBlock className="mt-6 h-[420px] w-full rounded-[20px]" />
      </div>
    </div>
  );
}

/** Owner app boot — centered orb + pillar row placeholder. */
export function OwnerBootSkeleton() {
  return (
    <div
      className="grid min-h-screen place-items-center bg-[#07090f] px-4"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading your board…</span>
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        <SkeletonBlock className="milon-skeleton--circle h-48 w-48" />
        <div className="grid w-full grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-16 rounded-xl" />
          ))}
        </div>
        <SkeletonBlock className="h-4 w-40" />
      </div>
    </div>
  );
}

/** Generic data-fetch panel (action plan, brain summary, etc.). */
export function PanelSkeleton({ rows = 4, className }: BlockProps & { rows?: number }) {
  return (
    <div className={cn("milon-skeleton-panel rounded-[20px] border border-[var(--brand-border,var(--line))] p-6", className)} role="status" aria-live="polite">
      <span className="sr-only">Loading panel…</span>
      <SkeletonBlock className="mb-4 h-3 w-24" />
      <SkeletonBlock className="mb-6 h-6 w-[40%] max-w-xs" />
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonBlock key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
