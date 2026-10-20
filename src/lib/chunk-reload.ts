/**
 * A deploy while a tab is open 404s the old hashed chunks
 * (benchmark-report-*, health-score-*, upload-*, app-chrome-*, …).
 * Reload once, then stop, so a missing file cannot spin the tab.
 */

export const CHUNK_RELOAD_KEY = "milon_chunk_reload";

const CHUNK_RE =
  /Failed to fetch dynamically imported module|Loading chunk \d+ failed|ChunkLoadError|error loading dynamically imported module|Importing a module script failed|\/assets\/[^/?#'"\s]+\.js/i;

export function isChunkLoadError(error: unknown): boolean {
  if (error == null || error === false) return false;
  if (typeof error === "string") return CHUNK_RE.test(error);
  if (error instanceof Error) return CHUNK_RE.test(`${error.name} ${error.message}`);
  if (typeof error === "object" && "message" in error) {
    const name = "name" in error ? String((error as { name: unknown }).name) : "";
    return CHUNK_RE.test(`${name} ${String((error as { message: unknown }).message)}`);
  }
  return CHUNK_RE.test(String(error));
}

function defaultStorage(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function chunkReloadPending(storage: Storage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(CHUNK_RELOAD_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearChunkReload(storage: Storage | null = defaultStorage()): void {
  try {
    storage?.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    /* private mode */
  }
}

/**
 * Hard-reload once per tab. Returns true when a reload was started.
 * A second failure leaves the flag set so the Reload screen can take over.
 */
export function reloadForChunkError(storage: Storage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(CHUNK_RELOAD_KEY) === "1") return false;
    storage.setItem(CHUNK_RELOAD_KEY, "1");
  } catch {
    return false;
  }
  if (typeof window !== "undefined") window.location.reload();
  return true;
}

/** Same key and matcher as the head boot script, for navigations after hydrate. */
export function installChunkReloadGuard(): void {
  if (typeof window === "undefined") return;
  const host = window as Window & { __milonChunkGuard?: boolean };
  if (host.__milonChunkGuard) return;
  host.__milonChunkGuard = true;

  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForChunkError()) event.preventDefault();
  });
  window.addEventListener("unhandledrejection", (event) => {
    if (!isChunkLoadError(event.reason)) return;
    if (reloadForChunkError()) event.preventDefault();
  });
  window.addEventListener(
    "error",
    (event) => {
      const src = event.target instanceof HTMLScriptElement ? event.target.src : "";
      if (src && isChunkLoadError(src)) {
        if (reloadForChunkError()) event.preventDefault();
        return;
      }
      if (isChunkLoadError(event.error ?? event.message) && reloadForChunkError()) {
        event.preventDefault();
      }
    },
    true,
  );
}

/** Runs before the app bundle so a 404 chunk can reload without painting a blank page. */
export const CHUNK_RELOAD_BOOT_SCRIPT = `(function(){if(window.__milonChunkGuard)return;window.__milonChunkGuard=1;var KEY=${JSON.stringify(CHUNK_RELOAD_KEY)};function chunk(msg){return ${CHUNK_RE.toString()}.test(String(msg||""));}function reload(){try{if(sessionStorage.getItem(KEY)==="1")return false;sessionStorage.setItem(KEY,"1");}catch(e){return false;}location.reload();return true;}window.addEventListener("vite:preloadError",function(e){if(reload())e.preventDefault();});window.addEventListener("unhandledrejection",function(e){var r=e.reason||{};if(chunk((r&&r.message)||r)&&reload())e.preventDefault();});window.addEventListener("error",function(e){var src=e.target&&e.target.src;if(src&&chunk(src)&&reload()){e.preventDefault();return;}if(chunk((e.error&&e.error.message)||e.message)&&reload())e.preventDefault();},true);})();`;
