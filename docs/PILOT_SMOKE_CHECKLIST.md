# First-pilot smoke checklist

Run this before a live customer / accountant session. Aim: ~10–15 minutes.

## 0. Ops prerequisites (Theo)
- [ ] Supabase migrations applied: `20260818120000_founder_pilot_roles_invites.sql`, `20260818130000_ensure_own_client_name_fallback.sql`
- [ ] Vercel has `ANTHROPIC_API_KEY`
- [ ] Supabase secrets has the **same** `ANTHROPIC_API_KEY` (Ask AI + PDF extract edge)
- [ ] Resend: `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (verified domain) + `SITE_URL`
- [ ] Hard-refresh production after deploy

## 1. Accountant path
- [ ] Sign in as accountant → `/dashboard` loads (greeting, KPI cards, scatter or empty state)
- [ ] Add client (or open an existing practice client)
- [ ] Click **Invite** on the client row → link copies (opaque token, not a raw UUID)
- [ ] Open client workspace → page loads (no blank/hooks crash)
- [ ] Optional: open a ratio playbook drawer — title/text readable

## 2. Founder invite claim
- [ ] Open invite link in a private window → landing register shows invite form
- [ ] Create account → lands on `/app`
- [ ] Complete operating profile (10 questions) if prompted

## 3. First data in
Pick one path (prefer bank or PDF for the demo story):
- [ ] Upload PDF financials **or** draft from bank statements **or** enter figures manually
- [ ] Confirm figures → board leaves empty state (`hasRealFinancials`)
- [ ] Health orb / score appears (not a fake peer %)
- [ ] Overview rail shows health band + “From your figures” (not invented cash trajectory)

## 4. Core board loop
- [ ] **Profit** tab — waterfall renders
- [ ] **Cash** — open forecast; if bank→cash used, published weeks show
- [ ] **Budget** — opens; seeds or empty plan is usable
- [ ] **Next moves** — ranked list appears when ratios exist
- [ ] Open a playbook / move → **Add to Action Plan**
- [ ] **Action Plan** — item visible; assign / copy task link if testing assignees
- [ ] **Ask AI** — visible after figures; answers a simple “what should I fix first?”

## 5. Trust / firm side again
- [ ] As accountant on the same client: sign-off financials (optional)
- [ ] Reports studio opens for the client (optional PDF)
- [ ] Dashboard **Needs attention** / table updates after score exists

## 6. Honesty / copy spot-checks
- [ ] Landing does **not** claim Gemini; says Claude where AI is mentioned
- [ ] Orbit/Constellation say not billed yet / waitlist
- [ ] No “better than X% of peers” on the founder overview

## If something fails
Note: route, role (accountant/founder), browser, and whether migrations/secrets were applied. Prefer fixing before the live call rather than demoing around it.
