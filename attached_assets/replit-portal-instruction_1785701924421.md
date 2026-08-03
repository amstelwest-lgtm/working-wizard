# Replit Agent — Implement the new MILŌN accountant portal

I've uploaded **`accountant-portal.html`** — a complete, finished front end for the accountant/practice side. **All design, layout, CSS, components and interactions are done.** Do not redesign, restyle, or "improve" anything visual. Your job is ONLY to replace demo data with live Supabase data and connect buttons to the existing backend functions.

Open the file and search for **`// HOOK:`** — every integration point is marked. There are no others.

## What the file contains (already working)

- **Firm dashboard view** (`#view-dashboard`): stats strip, Reports-studio spotlight, upgraded clients table (health rings, trend sparklines, runway, status chips, per-row actions), playbook library grid, referral-link copy, sign out.
- **Client view** (`#view-client`): breadcrumb + Exit to firm dashboard, client header with health ring, a persistent gold **Deliverables bar** (Generate report / Export PDF / Email draft / WhatsApp — Reports no longer disappears inside a client), tabs (Ratios · 13-Week Cash Forecast ✦ · **Reports ✦** · Tasks · Advisory Drafter), **collapsible auto-saved Financials**, clickable ratio rows, an SVG 13-week forecast chart, and a 10-template report gallery.
- **Playbook drawer**: slides in from the right with the ratio's definition, formula, health band, and the 10-step repair plan (effort/impact tags). Opens from BOTH the dashboard library and the client ratio rows — this is the "ratios + fixes accessible outside reports" requirement.
- Theme toggle (dark default, light supported), reduced-motion support, keyboard Escape closes the drawer.

## Your tasks (in order)

1. **Serve the file** as the accountant portal route (replace the current portal page). Keep the URL the same as today's accountant dashboard.
2. **Wire data** at each `// HOOK:` marker:
   - `FIRM` → practice profile (name, tier, referral link, report counts).
   - `CLIENTS` → the practice's client list with latest health score, runway, op-profit, 8-point score trend, last forecast date, open queries, reports issued, and financial figures.
   - `PLAYBOOKS` → this object is the single source for the drawer, the library grid, and the client ratio rows. Keep its exact shape (`cat, score, band, def, formula, steps[[title, desc, effort, impact, tag]×10]`). Extend it to all 31 ratios using the existing content from the current Reports section; per-client `score`/`band` come from the computed ratios.
   - `weeks/inflow/outflow` in `drawForecast()` → the client's real 13-week forecast series.
3. **Connect buttons**: every `todo('…')` call names the existing backend function it should invoke (generate/preview report, export PDF, email draft, WhatsApp, invite client, add client, save snapshot, upload statement, autosave a financial field). Replace `todo(...)` with the real call — the existing report engine, drafter and tasks modules stay as they are.
4. **Mount existing modules**: the Tasks and Advisory Drafter tab panes contain a marked container — render the current tasks module and drafter into them unchanged.
5. **Sign out**: in `signOut()`, uncomment the `supabase.auth.signOut()` line before the redirect to `/`.
6. **Auth**: this page is accountant-only. Apply the existing `requireRole('accountant')` guard at the top.

## Hard rules

- Do not change any CSS, class names, colours, fonts, spacing, or animations.
- Do not add UI libraries or frameworks — it's intentionally vanilla to match the stack.
- If a data field doesn't exist in the database yet (e.g. trend series, reports-issued count), tell me instead of inventing schema.
- Financials must remain collapsible and open by default (already implemented — don't touch).

## Acceptance checklist

- [ ] Dashboard shows real clients; clicking a row opens that client
- [ ] Reports reachable from: top bar, spotlight, per-client row action, Deliverables bar, and the Reports tab
- [ ] Playbook drawer opens from the dashboard library AND from client ratio rows, showing definition + 10 steps
- [ ] Financials collapse/expand and autosave to Supabase per field
- [ ] Cash forecast chart renders the client's real 13 weeks
- [ ] Tasks + Advisory Drafter still fully work inside their tabs
- [ ] Sign out returns to the landing page; owners cannot open this route
