---
name: Hydration re-fires debounced autosave effects
description: Why a useEffect-based autosave can silently re-save on every page load with zero edits, and the guard pattern that prevents it.
---
A debounced autosave `useEffect` keyed on the form/state value plus a `loaded` flag
(e.g. `[value, loaded]`) fires the instant hydration completes, because the hydration
callback typically flips `loaded` to `true` in the same tick it also calls `setValue(...)`
with the freshly-fetched data — both land in one re-render, satisfying the effect's deps
with no real user edit in between.

**Why it matters:** if the write path also bumps a "last updated" / freshness timestamp
(for staleness checks, cache invalidation, audit trails, etc.), this false-positive
autosave silently invalidates that freshness signal just from opening the page — no edit
required. This is easy to miss because the bug only manifests as "why did X go stale by
itself", not a crash or visible error.

**How to apply:** any debounced/auto-persisting effect that depends on a hydration-loaded
flag needs an explicit one-shot guard: set a `useRef(false)` to `true` right when hydration
finishes, and check-then-clear it at the top of the autosave effect before doing any write.
Apply this to every autosave effect writing the same field, not just the first one you find
— duplicate/legacy components touching the same data can carry the same bug independently.
