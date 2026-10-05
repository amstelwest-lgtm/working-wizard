/**
 * One window listener for Ctrl/Cmd+K, shared by every feature finder.
 *
 * Each mounted palette used to register its own capture listener and toggle
 * on every keydown, including repeats. Two listeners (or one key-repeat)
 * opened the palette and immediately closed it. The opening key could also
 * reach cmdk, which selects the first row — on a client page that row can
 * be the practice list and navigates to /dashboard.
 */
import { isFeatureFinderShortcut } from "@/lib/feature-finder";

export type FeatureFinderHotkeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
};

type HotkeyTarget = {
  addEventListener(
    type: "keydown",
    listener: (event: FeatureFinderHotkeyEvent) => void,
    capture?: boolean,
  ): void;
  removeEventListener(
    type: "keydown",
    listener: (event: FeatureFinderHotkeyEvent) => void,
    capture?: boolean,
  ): void;
};

export function createFeatureFinderHotkeyBus(
  target: HotkeyTarget,
  platform: () => string,
  userAgent: () => string,
) {
  let attached: ((event: FeatureFinderHotkeyEvent) => void) | null = null;
  const subscribers = new Set<() => void>();
  let listenerCount = 0;

  const onKey = (event: FeatureFinderHotkeyEvent) => {
    if (event.repeat) return;
    if (!isFeatureFinderShortcut(event, platform(), userAgent())) return;
    event.preventDefault();
    event.stopPropagation();
    const handlers = [...subscribers];
    handlers[handlers.length - 1]?.();
  };

  return {
    get listenerCount() {
      return listenerCount;
    },
    subscribe(handler: () => void) {
      subscribers.add(handler);
      if (!attached) {
        attached = onKey;
        target.addEventListener("keydown", attached, true);
        listenerCount += 1;
      }
      return () => {
        subscribers.delete(handler);
        if (subscribers.size === 0 && attached) {
          target.removeEventListener("keydown", attached, true);
          attached = null;
          listenerCount = 0;
        }
      };
    },
    dispatch(event: FeatureFinderHotkeyEvent) {
      attached?.(event);
    },
  };
}

type HotkeyBus = ReturnType<typeof createFeatureFinderHotkeyBus>;

let browserBus: HotkeyBus | null = null;

/** Subscribe the visible palette. Returns cleanup. No-op during SSR. */
export function subscribeFeatureFinderHotkey(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (!browserBus) {
    browserBus = createFeatureFinderHotkeyBus(
      window as unknown as HotkeyTarget,
      () => navigator.platform,
      () => navigator.userAgent,
    );
  }
  return browserBus.subscribe(handler);
}

/**
 * Toggle from the open state we already committed, once per keypress.
 * A second call in the same turn (duplicate listener) sees the updated value
 * and does not flip back.
 */
export function toggleFinderOpen(openRef: { current: boolean }): boolean {
  openRef.current = !openRef.current;
  return openRef.current;
}
