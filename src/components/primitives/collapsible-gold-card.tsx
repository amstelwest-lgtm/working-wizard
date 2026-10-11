/**
 * Premium hideable section — same chrome as 13-week cash forecast.
 * Closed by default unless defaultOpen is set.
 */

import { useState, type ComponentType, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const COLLAPSIBLE_GOLD_SHELL =
  "relative overflow-hidden border border-[#DBEAFE] bg-white shadow-[0_8px_24px_rgba(16,42,67,0.06)] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:shadow-none";
export const COLLAPSIBLE_GOLD_RULE =
  "pointer-events-none absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-[#2563EB] via-[#38BDF8] to-transparent";

export function CollapsibleGoldCard({
  id,
  icon: Icon,
  title,
  subtitle,
  defaultOpen = false,
  headerRight,
  children,
}: {
  id?: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card id={id} className={`${COLLAPSIBLE_GOLD_SHELL} collapsible-gold-card`}>
      <div className={COLLAPSIBLE_GOLD_RULE} />
      <CardHeader className="border-b border-amber-900/10 pb-4 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="flex flex-1 items-center gap-3 text-left"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0B5FFF]/15 text-[#102A43] dark:text-[#0B5FFF]">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <CardTitle className="text-base font-semibold tracking-tight text-slate-950 dark:text-slate-100">
                {title}
              </CardTitle>
              {subtitle && (
                <span className="mt-0.5 block text-xs text-slate-600 dark:text-slate-400">
                  {subtitle}
                </span>
              )}
            </span>
          </button>
          <div className="flex items-center gap-2">
            {headerRight}
            <button
              type="button"
              className="p-1 text-[#0B5FFF]"
              onClick={() => setOpen((o) => !o)}
              aria-label={open ? "Collapse" : "Expand"}
              aria-expanded={open}
            >
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </CardHeader>
      {open && <CardContent className="pt-5">{children}</CardContent>}
    </Card>
  );
}
