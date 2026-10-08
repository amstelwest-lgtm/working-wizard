import { useEffect, useMemo, useRef, useState } from "react";
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
import { useFirmClients } from "@/hooks/use-firm-clients";
import {
  featureFinderShortcutLabel,
  isFeatureFinderShortcut,
  isMacPlatform,
  searchFeatures,
  type FeatureAudience,
  type FeatureDestination,
  type FeatureResult,
} from "@/lib/feature-finder";
import {
  CLIENTS_GROUP,
  includeClientGroup,
  paletteEmptyCopy,
  searchClientSectionJumps,
  searchClients,
} from "@/lib/feature-finder-clients";
import { subscribeFeatureFinderHotkey, toggleFinderOpen } from "@/lib/feature-finder-hotkey";
import { openOwnerSettings, openPracticeSettings } from "@/lib/user-roles";
import { cn } from "@/lib/utils";

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
  const [listEpoch, setListEpoch] = useState(0);
  const openRef = useRef(false);
  /** Cmdk can select the first row as the palette mounts. Ignore that until a real gesture. */
  const allowSelect = useRef(false);
  const showClients = includeClientGroup(audience);
  // Warm the firm list on mount, then refresh when the palette opens.
  // Typing filters that list in memory.
  const { clients, loading: clientsLoading } = useFirmClients(showClients, listEpoch);

  useEffect(() => {
    if (open) setListEpoch((n) => n + 1);
  }, [open]);

  useEffect(() => {
    setMac(isMacPlatform(navigator.platform, navigator.userAgent));
  }, []);

  useEffect(() => {
    return subscribeFeatureFinderHotkey(() => {
      const next = toggleFinderOpen(openRef);
      setOpen(next);
      if (!next) setQuery("");
      allowSelect.current = false;
    });
  }, []);

  const match = useMemo(
    () => searchFeatures(query, { audience, clientId }),
    [query, audience, clientId],
  );
  const onFirmDashboard = showClients && !clientId?.trim();
  const sectionJumps = useMemo(
    () => (onFirmDashboard ? searchClientSectionJumps(query, clients) : []),
    [onFirmDashboard, query, clients],
  );
  const groups = useMemo(
    () => groupResults([...match.results, ...sectionJumps]),
    [match.results, sectionJumps],
  );
  const clientHits = useMemo(
    () => (showClients ? searchClients(query, clients) : []),
    [showClients, query, clients],
  );
  const shortcut = featureFinderShortcutLabel(mac);
  const showClientHint = audience === "accountant" && !clientId?.trim();
  const emptyCopy = paletteEmptyCopy({
    needsClient: match.needsClient && sectionJumps.length === 0,
    featureCount: match.results.length + sectionJumps.length,
    clientCount: clientHits.length,
    clientsLoading: showClients && clientsLoading,
  });
  const searchLabel = showClients ? "features and clients" : "features";

  const onOpenChange = (next: boolean) => {
    openRef.current = next;
    setOpen(next);
    allowSelect.current = false;
    if (!next) setQuery("");
  };

  const armSelect = () => {
    allowSelect.current = true;
  };

  const runSelection = (action: () => void) => {
    if (!allowSelect.current) return;
    allowSelect.current = false;
    action();
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

  const openClientFile = (id: string) => {
    onOpenChange(false);
    void navigate({
      to: "/clients/$clientId",
      params: { clientId: id },
      search: {},
    });
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
        aria-label={`Search ${searchLabel} (${shortcut})`}
        aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => onOpenChange(true)}
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
          <DialogTitle className="sr-only">Search {searchLabel}</DialogTitle>
          <DialogDescription className="sr-only">
            {showClients
              ? "Jump to a client, or to Health, Cash, Budget, Collections, and other product functions."
              : "Jump to Health, Cash, Budget, and other product functions."}
          </DialogDescription>
          <Command
            shouldFilter={false}
            className="bg-transparent text-inherit"
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") {
                armSelect();
              }
            }}
          >
            <CommandInput
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder={showClients ? "Search features and clients…" : "Search features…"}
              className="h-12 pr-8"
            />
            <CommandList className="max-h-[min(360px,50vh)] px-1 pb-1" onPointerDown={armSelect}>
              <CommandEmpty className="feature-finder-empty">{emptyCopy}</CommandEmpty>
              {groups.map((group) => (
                <CommandGroup key={group.group} heading={group.group}>
                  {group.items.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onSelect={() => runSelection(() => go(item.destination))}
                      className="gap-3 px-3 py-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="feature-finder-hint shrink-0">{item.hint}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
              {clientHits.length > 0 ? (
                <CommandGroup heading={CLIENTS_GROUP}>
                  {clientHits.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      onSelect={() => runSelection(() => openClientFile(item.clientId))}
                      className="gap-3 px-3 py-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="feature-finder-hint shrink-0">{item.hint}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
          <div className="feature-finder-foot">
            <span>
              {showClientHint
                ? "Search a client, or Cash, Budget, and other sections."
                : showClients
                  ? "Features and clients"
                  : "Features"}
            </span>
            <span>↑↓ · Enter · Esc</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
