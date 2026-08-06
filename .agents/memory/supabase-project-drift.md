---
name: Supabase project URL/key drift
description: How this app's Supabase target project can silently drift out of sync across env layers, and how to verify the true runtime value.
---

# Supabase project URL/key drift

This app resolves its Supabase project through several separate layers that are not
automatically kept in sync: the `.env` file, a fresh shell's `process.env` (as seen via
`ShellExec`/`printenv`), the actual long-running workflow process's env, Replit shared
secrets, `vite.config.ts`'s `define` block, and `supabase/config.toml`'s `project_id`
(CLI-only, not runtime).

**Confirmed root cause of one drift incident:** a fresh `ShellExec` shell's
`process.env.SUPABASE_URL` returned a *different* (stale/wrong) project than the value
actually loaded into the long-running "Start application" workflow process. Do not trust
`printenv`/`cat .env` in a new shell as ground truth for "what project does the app use" —
inspect the actual running process instead: `pgrep -f "vite dev"` then
`tr '\0' '\n' < /proc/$PID/environ | grep SUPABASE_URL`. Cross-check against
`mcpSupabase_listProjects()` — the project the Supabase MCP tool can actually reach is
usually the real one (e.g. project named "... real" if the account has a decoy/legacy
project too). If the user says "we've done this exercise before" / states the project
name directly, trust them over a fresh-shell env read.

**Why this matters:** `vite.config.ts` may have a `define` block that overrides
`import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` at dev/build time
with `process.env.SUPABASE_URL` / `process.env.SUPABASE_PUBLISHABLE_KEY` — the
non-`VITE_`-prefixed names are the actual source of truth for the client bundle, not the
`VITE_`-prefixed ones. But `VITE_SUPABASE_PROJECT_ID` may be passed through unmodified,
so it can legitimately point at a different project than `SUPABASE_URL` resolves to —
don't assume all the VITE_-prefixed vars agree with each other.

**How to apply:** Before trusting that a Supabase project switch/config change took
effect, or before concluding "the MCP tool doesn't have access to the right project",
verify the actual resolved runtime value directly from the live process (see above), not
from a fresh shell or `.env` file. Also note `.env` cannot be edited directly (blocked;
secrets must go through env var tooling), so it can silently show stale values no longer
used at runtime.
