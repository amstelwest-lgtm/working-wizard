import { useEffect, useState } from "react";
import { reloadForChunkError } from "@/lib/chunk-reload";

/**
 * Shown when a stale chunk survived the one automatic reload.
 * Reload is a full navigation, not a router retry of the old files.
 */
export function ChunkReloadNotice({ compact = false }: { compact?: boolean }) {
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (!reloadForChunkError()) setGaveUp(true);
  }, []);

  if (!gaveUp) {
    return (
      <p role="status" className={compact ? "p-6 text-sm text-muted-foreground" : "p-8 text-center text-sm text-muted-foreground"}>
        Reloading…
      </p>
    );
  }

  const reload = () => {
    window.location.reload();
  };

  if (compact) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-500/40 bg-rose-50 p-6 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-100"
      >
        <p>This part of the page is from an older version.</p>
        <button type="button" className="mt-3 underline" onClick={reload}>
          Reload
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center" role="alert">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page needs a reload</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A new version of Milōn was published while this tab was open. Reload to pick it up.
        </p>
        <button
          type="button"
          className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          onClick={reload}
        >
          Reload
        </button>
      </div>
    </div>
  );
}
