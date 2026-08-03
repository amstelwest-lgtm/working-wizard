# Milōn — Operating Finance Platform

## Overview
Milōn is an operating-finance platform for owner-led businesses and the accounting firms that advise them. It has two audiences:
- **Client side** (`/app`): business owners manage financials, cash forecasts, tasks, and advisory drafts.
- **Accountant side** (`/dashboard`, `/clients/:clientId`, `/reports`): accounting-firm staff manage a portfolio of clients, review health scores/ratios, run 13-week cash forecasts, generate white-label reports, and draft client communications.

Stack: TanStack Start (React, file-based routes under `src/routes`), Supabase (Postgres + Auth), Tailwind CSS v4, `@react-pdf/renderer` for report PDFs.

## Accountant portal design system
`src/styles/accountant-portal.css` is the single source of truth for the dark/gold "MILŌN Practice Portal" visual language used by `dashboard.tsx` and `clients.$clientId.tsx`. Wrap any page using it in `className="accountant-portal"` and import the stylesheet. Do not change its existing selectors without design sign-off — extend by appending new rules instead.

Health scores and 8-point sparkline trends are computed via `src/lib/health-score.ts` (wraps `src/lib/ratios.ts`'s `computeRatios`/`scoreTier`, canonical thresholds 65/40). `buildTrend()` pads thin history and flags padded points `isEstimated: true`.

A table `client_score_history` and a `clients.reports_issued_count` column (migration `supabase/migrations/20260802000000_score_history_and_reports_count.sql`) back the trend sparkline and reports-issued stat. This migration is applied on the live Supabase project. Code still queries them defensively (catches "relation/column does not exist") as a safety net, falling back to a single-point trend / zero count only if that ever regresses.

## User preferences
- Deliverable buttons that don't have a real send/integration path use lightweight share links rather than fake backend calls: "WhatsApp" → `wa.me` share link, "Email draft" → `mailto:` link. No real WhatsApp/email-send integration is wired for these.
- When porting a finished visual design (HTML/CSS mockup) into the app, preserve the CSS/markup/classes exactly — do not redesign while wiring in real data.
- If a UI needs a data field the database doesn't have yet, ask/flag it rather than inventing schema silently (migrations still need explicit user sign-off/application via the Supabase SQL editor since this environment has no direct DB credentials for the app's Supabase project).
