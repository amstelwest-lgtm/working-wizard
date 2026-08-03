---
name: Vite stale dep cache crash
description: Intermittent "Invalid hook call" + hydration failure in the preview that fresh browser contexts can't reproduce
---
Rule: when the user's preview crashes with "Invalid hook call" + "Hydration failed" on every load but fresh browser contexts (screenshots, testers) load cleanly, suspect a stale Vite dependency cache in the user's browser, not app code.

**Why:** After task merges install new packages, Vite re-optimizes `node_modules/.vite` deps. A browser holding cached old chunks mixes two React copies → invalid hook call + hydration failure + slow struggling loads. Happened Aug 2026 on the MILŌN landing page; days were spent chasing app-level hydration causes first.

**How to apply:** `rm -rf node_modules/.vite`, restart the workflow, then ask the user to hard-refresh (Ctrl/Cmd+Shift+R). Only chase code-level hydration mismatches (e.g. `window.location.origin` read during render — one real case existed in the dashboard) if the error reproduces in a fresh browser context too.
