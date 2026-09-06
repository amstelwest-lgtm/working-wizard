# Launch smoke checklist

Run this on **production** after every deploy that touches auth, upload, or the board — and once
on a phone. Aim: 15 minutes with a fresh owner email and a fresh practice email. If a step fails,
note route, role, browser, and whether the migrations below were applied. Fix before demoing.

## 0. One-time setup (Theo, dashboards)

**Supabase → SQL editor.** Apply, in order, anything not yet applied:
- `20260905120000_ensure_own_client_roles_restore.sql`
- `20260906090000_ensure_practice_firm_market_lock.sql` — one firm per practice, no firm for owners
- `20260906120000_statement_uploads_bucket.sql` — private bucket for PDFs over 3 MB
- `20260906130000_extraction_rate_limit.sql` — 20 document extractions / user / hour

**Supabase → Authentication.**
- Sign In / Providers → Email → **Confirm email OFF** (owners verify later via the banner)
- SMTP Settings → **custom SMTP (Resend)**. The built-in sender is capped at a few emails an hour
  and lands in spam; verification links die on this alone.
- URL Configuration → Site URL = production domain; Redirect URLs include
  `/auth/verified`, `/auth/callback`, `/app`, `/dashboard` (production + `http://localhost:5000`)
- Email Templates → paste `supabase/templates/magic_link.html` (subject: *Verify your Milōn
  email*), `recovery.html`, `confirmation.html`. The magic-link template is the one every new
  owner sees.

**Supabase → Edge Functions → Secrets:** `ANTHROPIC_API_KEY` (Ask AI runs there).

**Vercel → Environment Variables (Production):** `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
`ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (verified domain), `SITE_URL`,
`VITE_APP_URL`, `CRON_SECRET`, `SENTRY_DSN`, `VITE_SENTRY_DSN`. Redeploy after changes.

- [ ] Hard-refresh production after deploy; Sentry project shows the release receiving events
      (trigger one: open `/nope` → the 404 page is fine; a thrown error in any tab should appear)

## 1. Owner — ZA, then repeat as US

- [ ] Landing → pick market → **Business owner** → sign up → lands on `/app` immediately (no
      "check your inbox" wall)
- [ ] **4 profile questions** → board opens; a note beside the orb offers the remaining questions
- [ ] Empty board says the one thing to do next (bring in figures), not a broken dashboard
- [ ] **Load a demo business** → scored board appears; leaving demo returns to the empty board
- [ ] Verify-email banner → *Send verification link* → email arrives from Milōn (branded, not
      "Your Magic Link") → link lands on `/auth/verified` → banner gone
- [ ] Upload figures — one of: PDF · Excel/ODS/CSV · bank statements (ZA leads with banks, US
      with file upload). A **> 3 MB PDF** must work (goes via Storage, not the request body)
- [ ] Review modal → confirm → orb shows a **real score**; caption reads from the figures
- [ ] "Figures cover" shows the right number of months; DSO/DIO/DPO are days, not hundreds
- [ ] **Profit** waterfall reconciles to the EBIT entered; currency symbol matches market
- [ ] **Cash** — with nothing loaded says *No forecast yet*; after banks shows real weeks
- [ ] **Budget** — seeds from the figures at the right scale (a quarter of actuals does not
      seed a quarter-sized annual budget; EBITDA is not negative for a profitable business)
- [ ] **Ask AI** — before figures: note says answers improve once figures are in; after figures:
      answers "what should I fix first?" from the numbers
- [ ] Tour on an empty board has two honest steps; the full tour appears once a score exists

## 2. Practice (accountant)

- [ ] Landing → **Accountant** → `/auth` → Create firm (pick market) → `/dashboard`
- [ ] **Refresh `/dashboard`** — loads (this was the reload deadlock). Sign out, sign in — loads.
- [ ] Only **one** firm exists for the user (Supabase → `firms` where `owner_user_id`)
- [ ] First-client dialog leads with a **real client name**; sandbox is a small link
- [ ] Add client → `?onboard=1` → upload the Windward P&L/BS PDF (or any real statement)
- [ ] Empty studio opens on **Health & Ratios** with the *Bring in this client's figures* card;
      Ask AI carries the "more relevant once figures are in" note; no deliverables bar
- [ ] Review → confirm → studio now opens on **Ask AI**; deliverables bar appears
- [ ] Health / Profit / Cash / Budget all read from the same figures; sales-per-employee is
      money per head, not a percentage
- [ ] 21st upload within an hour is refused with the friendly limit message (optional)

## 3. Same client, both sides

- [ ] From the studio: **Invite** the owner → open the link in a private window → owner signs up
- [ ] Owner sees a **one-step** profile ("your score is waiting behind this"), not "Step 1 of 2
      · bring in your numbers"
- [ ] Owner orb score, caption, waterfall and cash **match** the studio for the same client

## 4. Phone (390 px wide)

- [ ] Landing, market picker, sign-up card, profile questions: no horizontal scroll, buttons
      reachable
- [ ] Board: orb visible above the fold; tabs scroll; upload button opens the file picker
- [ ] Studio: Financials card and period selector usable

## 5. Honesty spot-checks

- [ ] Landing says **Claude** where AI is mentioned; no Gemini
- [ ] Orbit / Constellation say not billed yet / waitlist
- [ ] No "better than X% of peers" on the owner overview; nothing invented before figures exist

## If something fails

Route · role (owner / accountant) · browser · market · whether §0 was completed. Check Sentry
first — server-function throws are reported with the function name. Fix before the live call
rather than demoing around it.
