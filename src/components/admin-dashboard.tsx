import { useAnalytics } from "@/contexts/analytics";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

function countEvents(events: ReturnType<typeof useAnalytics>["events"], name: string) {
  return events.filter((e) => e.event === name).length;
}

function uniqueUsers(events: ReturnType<typeof useAnalytics>["events"]) {
  return new Set(events.map((e) => e.userId)).size;
}

function topFeatures(events: ReturnType<typeof useAnalytics>["events"]) {
  const counts: Record<string, number> = {};
  events.forEach((e) => { counts[e.event] = (counts[e.event] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
}

function tabUsage(events: ReturnType<typeof useAnalytics>["events"]) {
  return events
    .filter((e) => e.event === "tab_viewed")
    .reduce<Record<string, number>>((acc, e) => {
      const tab = (e.properties.tab as string) || "unknown";
      acc[tab] = (acc[tab] || 0) + 1;
      return acc;
    }, {});
}

export function AdminDashboard() {
  const { events } = useAnalytics();
  const features = topFeatures(events);
  const tabs = tabUsage(events);
  const maxFeatureCount = features[0]?.[1] || 1;

  function exportCSV() {
    const header = "timestamp,event,userId,properties\n";
    const rows = events
      .map(
        (e) =>
          `${e.timestamp},${e.event},${e.userId},"${JSON.stringify(e.properties).replace(/"/g, '""')}"`,
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `milon-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 p-1 text-slate-100">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-lg font-extrabold text-white">Activity Dashboard</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            All user actions this session · {events.length} events · {uniqueUsers(events)} user
            {uniqueUsers(events) !== 1 ? "s" : ""}. Lasting rankings are in Lighthouse → Usage.
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-[#d4a550]/30 bg-[#d4a550]/10 text-[10px] text-[#d4a550] hover:bg-[#d4a550]/20"
          onClick={exportCSV}
          disabled={events.length === 0}
        >
          <Download className="h-3 w-3" />
          Export CSV
        </Button>
      </div>

      {events.length === 0 && (
        <p className="py-4 text-center text-xs text-slate-500">
          No events recorded yet. Use the app to generate activity.
        </p>
      )}

      {/* Tab Usage */}
      {Object.keys(tabs).length > 0 && (
        <div>
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
            Tab Views
          </div>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(tabs).map(([tab, count]) => (
              <div
                key={tab}
                className="rounded-lg border border-white/8 bg-white/5 p-3 text-center"
              >
                <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
                  {tab}
                </div>
                <div className="text-xl font-extrabold text-[#d4a550]">{count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature Usage */}
      {features.length > 0 && (
        <div>
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
            Feature Usage (Top 10)
          </div>
          <div className="space-y-2.5">
            {features.map(([name, count]) => (
              <div key={name} className="flex items-center gap-3">
                <div className="w-40 shrink-0 text-xs capitalize text-slate-300">
                  {name.replace(/_/g, " ")}
                </div>
                <div className="h-2 flex-1 overflow-hidden rounded bg-white/6">
                  <div
                    className="h-full rounded bg-[#d4a550] transition-[width] duration-500"
                    style={{ width: `${(count / maxFeatureCount) * 100}%` }}
                  />
                </div>
                <div className="w-8 text-right text-xs font-bold text-slate-400">{count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Events */}
      {events.length > 0 && (
        <div>
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
            Recent Events
          </div>
          <div className="divide-y divide-white/4">
            {[...events]
              .reverse()
              .slice(0, 20)
              .map((e) => (
                <div key={e.id} className="flex gap-3 py-1.5 text-[11px]">
                  <span className="w-16 shrink-0 text-slate-500">
                    {new Date(e.timestamp).toLocaleTimeString("en-ZA", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span className="flex-1 capitalize text-white">
                    {e.event.replace(/_/g, " ")}
                  </span>
                  <span className="font-semibold text-[#d4a550]">{e.userId}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
