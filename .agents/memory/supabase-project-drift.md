---
name: Supabase project URL/key drift
description: How this app's Supabase target project can silently drift out of sync across env layers, and how to verify the true runtime value.
---

# Supabase project URL/key drift

This app resolves its Supabase project through **four separate layers** that are not
automatically kept in sync: the `.env` file, Replit shared secrets/env vars, and
`vite.config.ts`'s `define` block, plus `supabase/config.toml`'s `project_id` (used only
for CLI tooling, not runtime).

**Why this matters:** `vite.config.ts` has a `define` block that overrides
`import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` at dev/build time
with `process.env.SUPABASE_URL` / `process.env.SUPABASE_PUBLISHABLE_KEY` — note the
**different, non-`VITE_`-prefixed** env var names are the actual source of truth, not the
`VITE_`-prefixed ones. Updating the `VITE_`-prefixed secrets/env vars alone does nothing;
you must update `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`. This caused a long, confusing
loop where a Supabase-project switch appeared to fail even after the user repeatedly
re-pasted the "right" key — because the values being changed weren't the ones actually
read by the running app.

**How to apply:** Before trusting that a Supabase project switch/config change took
effect, always verify the *actual resolved* runtime value directly — e.g. `curl`/`fetch`
the project's REST endpoint with the current `SUPABASE_URL`/key from a fresh shell
(`exec bash -lc 'echo $SUPABASE_URL'`) and check which project host responds, rather than
trusting that a secrets-form submission or a `.env`-looking value took effect. Also note:
`.env` cannot be edited directly (blocked, secrets must go through env var tooling), so
`.env` can silently show stale values that are no longer what's actually used at runtime
— always check `vite.config.ts` (or equivalent) for any `define`/override step that maps
different env var names into the client bundle.
