/**
 * Premium hideable section — same chrome as 13-week cash forecast.
 * Closed by default unless defaultOpen is set.
 */

import { useState, type ComponentType, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const COLLAPSIBLE_GOLD_SHELL =
  "relative overflow-hidden border border-amber-900/15 bg-[radial-gradient(circle_at_90%_0%,rgba(212,165,80,0.13),transparent_34%),linear-gradient(135deg,#fffdf8,#f8f5ed)] shadow-[0_20px_60px_rgba(109,79,22,0.10)] dark:border-slate-800 dark:bg-[radial-gradient(circle_at_90%_0%,rgba(212,165,80,0.12),transparent_34%),linear-gradient(135deg,#111827,#0b1220)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.25)]";
export const COLLAPSIBLE_GOLD_RULE =
  "pointer-events-none absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-[#b7872a] via-[#f1d28b] to-transparent";

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
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#d4a550]/15 text-[#b8860b] dark:text-[#d4a550]">
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
              className="p-1 text-[#d4a550]"
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
