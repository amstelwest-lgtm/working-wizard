import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  featureFinderShortcutLabel,
  isFeatureFinderShortcut,
  isMacPlatform,
  searchFeatures,
  type FeatureAudience,
  type FeatureDestination,
  type FeatureResult,
} from "@/lib/feature-finder";
import { openOwnerSettings, openPracticeSettings } from "@/lib/user-roles";
import { cn } from "@/lib/utils";
import "@/styles/feature-finder.css";

type Props = {
  audience: FeatureAudience;
  clientId?: string | null;
  /** Portal pill in the accountant topbar, or the compact owner app-bar control. */
  chrome?: "portal" | "owner";
};

function groupResults(results: FeatureResult[]): { group: string; items: FeatureResult[] }[] {
  const order: string[] = [];
  const byGroup = new Map<string, FeatureResult[]>();
  for (const item of results) {
    const list = byGroup.get(item.group);
    if (list) list.push(item);
    else {
      order.push(item.group);
      byGroup.set(item.group, [item]);
    }
  }
  return order.map((group) => ({ group, items: byGroup.get(group) ?? [] }));
}

export function FeatureFinder({ audience, clientId = null, chrome = "portal" }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(isMacPlatform(navigator.platform, navigator.userAgent));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isFeatureFinderShortcut(event, navigator.platform, navigator.userAgent)) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const match = useMemo(
    () => searchFeatures(query, { audience, clientId }),
    [query, audience, clientId],
  );
  const groups = useMemo(() => groupResults(match.results), [match.results]);
  const shortcut = featureFinderShortcutLabel(mac);
  const showClientHint = audience === "accountant" && !clientId?.trim();

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  const go = (dest: FeatureDestination) => {
    onOpenChange(false);
    if (dest.kind === "client") {
      void navigate({
        to: "/clients/$clientId",
        params: { clientId: dest.clientId },
        search: dest.search,
      });
      return;
    }
    if (dest.kind === "owner") {
      void navigate({ to: "/app", search: { tab: dest.tab } });
      return;
    }
    if (dest.kind === "dashboard") {
      void navigate({ to: "/dashboard" });
      return;
    }
    if (audience === "owner") openOwnerSettings();
    else openPracticeSettings();
    void navigate({ to: "/settings" });
  };

  return (
    <>
      <button
        type="button"
        className={cn(
          chrome === "owner"
            ? "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 text-[11px] font-semibold text-slate-700 transition-colors hover:border-[#b7872a]/50 hover:bg-[#d4a550]/10 dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-200"
            : "feature-finder-trigger",
        )}
        aria-label={`Search features (${shortcut})`}
        aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Search
          className={chrome === "owner" ? "h-3 w-3 shrink-0" : undefined}
          aria-hidden="true"
        />
        <span className={chrome === "owner" ? "hidden sm:inline" : "feature-finder-trigger__label"}>
          Search…
        </span>
        <kbd
          className={
            chrome === "owner"
              ? "hidden font-medium text-slate-400 sm:inline"
              : "feature-finder-kbd"
          }
          aria-hidden="true"
        >
          {shortcut}
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="feature-finder feature-finder-dialog top-[14vh] w-[calc(100vw-1.5rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-[36rem] sm:rounded-2xl sm:p-0">
          <DialogTitle className="sr-only">Search features</DialogTitle>
          <DialogDescription className="sr-only">
            Jump to Health, Cash, Collections, and other product functions.
          </DialogDescription>
          <Command shouldFilter={false} className="bg-transparent text-inherit">
            <CommandInput
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Search features…"
              className="h-12 pr-8"
            />
            <CommandList className="max-h-[min(360px,50vh)] px-1 pb-1">
              <CommandEmpty className="feature-finder-empty">
                {match.needsClient
                  ? "Open a client to jump to Health, Cash, Collections, and the rest."
                  : "No matching features."}
              </CommandEmpty>
              {groups.map((group) => (
                <CommandGroup key={group.group} heading={group.group}>
                  {group.items.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onSelect={() => go(item.destination)}
                      className="gap-3 px-3 py-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="feature-finder-hint shrink-0">{item.hint}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
          <div className="feature-finder-foot">
            <span>{showClientHint ? "Open a client for the studio pages." : "Features"}</span>
            <span>↑↓ · Enter · Esc</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
