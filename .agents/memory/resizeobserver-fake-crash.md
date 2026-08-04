---
name: ResizeObserver fake crash
description: Benign "ResizeObserver loop completed" warning gets flagged as an artifact runtime crash; how it was silenced.
---

The browser warning "ResizeObserver loop completed with undelivered notifications" (fired by animated chart/card containers, e.g. recharts ResponsiveContainer) is harmless, but the platform's preview error listener flags it as a runtime crash.

**Why:** Filtering it in our own `window.addEventListener("error")` handler is NOT enough — the platform's listener registers earlier and still sees the event. The only reliable fix is preventing the warning at the source.

**How to apply:** The dev-only inline script in `__root.tsx` wraps `window.ResizeObserver` so callbacks run inside `requestAnimationFrame` (prevents app-originated loop warnings) and filters/logs the event as `window.error.filtered`.

**Unfixable case:** The warning STILL fires from the user's LastPass extension (isolated content-script world, own native ResizeObserver — signature: source `:0:0`, error object null, shim confirmed served). No app-level fix exists; the "artifact crashed" popup for this signature is a false alarm from the user's browser extension. Don't keep attempting fixes — verify the beacon payload is this signature and explain instead.
