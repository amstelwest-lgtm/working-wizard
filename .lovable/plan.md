## Goal

Make the first impression and Today tab feel like a modern, premium finance product (think Ramp / Brex / Mercury / Pilot) instead of a "strategy game" dashboard.

## 1. App identity & title

Current: "Working Capital Compass" / "Business Health Command Center" / "strategy game" wording. Too playful for finance.

Change to a calmer, more credible identity:
- **App name:** `Ledgerline` (working name — confirm or swap)
- **Tagline:** "Operating finance for owner-led businesses."
- Update:
  - `<title>` in `src/routes/index.tsx` head → `"Ledgerline · Operating Finance"`
  - `public/manifest.webmanifest` name/short_name/description
  - Meta description in `__root.tsx`
  - Remove all "strategy game", "command center", "moves" gamified language

## 2. Top header (first thing the user sees)

Replace the current bordered header with a clean app bar:

```text
┌──────────────────────────────────────────────────────────┐
│  ◆ Ledgerline    Acme Pty Ltd  ▾        ⌘K   ☾  Export  │
├──────────────────────────────────────────────────────────┤
│  Today  ·  Ratios  ·  Cash  ·  Tasks  ·  Inputs         │
└──────────────────────────────────────────────────────────┘
```

- Small monogram mark (gold diamond on ink) + wordmark in a serif display face (Instrument Serif or Fraunces) — single touch of editorial finance feel.
- Client switcher pill replaces the giant H1.
- Risk + business-type move OUT of the hero into a compact "Profile" strip under the tab bar (one line, two chips with a "Change" affordance) — no more two big cards above the fold.
- ThemeToggle and Export become small icon buttons, not pill buttons.

## 3. Today tab redesign (`src/components/today-panel.tsx`)

New structure, top to bottom:

```text
HERO STRIP  (single row, 3 KPI tiles — flat white cards, hairline border, gold left accent on the lead metric)
  Cash runway · Operating margin · Debtor days
    big number, tiny delta vs last period, sparkline

NEXT BEST ACTION  (single wide card, serif headline, 1 primary CTA)

ALERTS  (compact list, severity dot + one-line title, click to expand)
  - red/amber/blue dots only, no filled tinted backgrounds
  - max 3 visible, "View all" link

OPEN TASKS  (compact list, 3 rows max, avatar-less, due date right-aligned)

ASK YOUR NUMBERS  (collapsed by default into a single search-style input
  at the bottom: "Ask anything about your numbers…" — expands on focus)
```

Visual rules for Today:
- Kill all `bg-gradient-to-br from-*-950` hero buttons. Use white cards with a 1px `#e6ebf2` border and a subtle `0 1px 2px rgba(15,23,42,0.04)` shadow.
- One accent color per tile (gold for cash, blue for performance, green for growth, red for risk). No tinted backgrounds — accents live in a 2px left border + the metric color only.
- Numbers in a tabular-figures sans (Inter / Söhne-like), headlines in a serif display.
- Remove emoji icons from next-step rows; use `lucide` icons sized 14px in muted ink.
- Replace badge pills (`bg-slate-700/50`) with plain `text-xs text-slate-500` counts.

## 4. Typography & color tokens (`src/styles.css`)

Add and standardize:
- `--font-display: "Instrument Serif", "Fraunces", Georgia, serif;`
- `--font-sans: "Inter", system-ui, sans-serif;` with `font-feature-settings: "tnum","cv11";`
- Tokens:
  - `--ink: #0B1220` (headings)
  - `--ink-2: #475569` (body)
  - `--ink-3: #94A3B8` (meta)
  - `--surface: #FFFFFF`
  - `--surface-2: #F7F8FA` (page bg in light mode — soft, not pure white)
  - `--hairline: #E6EBF2`
  - `--accent-gold: #B7872A`
  - `--accent-blue: #2A5BD7`
  - `--accent-green: #0F8A5F`
  - `--accent-red: #C0392B`
- Page background switches from pure white to `--surface-2` so white cards float.

## 5. Tabs

- Underline-style tabs (no filled blue pill). Active tab = ink text + 2px gold underline. Inactive = `--ink-3`.
- Order: Today · Ratios · Cash · Tasks · Inputs.

## Out of scope

- No business-logic changes (calculations, server functions, schema).
- Dark mode kept working; only light mode is retuned.
- Other tabs (Ratios, Cash, Tasks, Inputs) are not redesigned in this pass beyond inheriting the new tokens.

## Open question

Confirm the app name. Options:
1. **Ledgerline** (recommended)
2. **Northline**
3. **Keep "Compass"** but drop "Working Capital" and "Command Center"
