# MILŌN app — 4 fixes for Replit Agent

Paste this whole file into Replit Agent. Most of the code is written for you — your job is mostly to **find the right file/element and paste**, adapting the selector/route/table names to match what already exists. Don't redesign anything; only change what each fix describes.

**A few names I've assumed — check these against the real project and swap if they differ:**
- The theme switch uses `data-theme="light"` / `data-theme="dark"` on `<html>` (same as the landing page). If the app uses a `.light`/`.dark` class or Tailwind dark mode instead, translate the selectors accordingly.
- The signed-in user's role lives in a Supabase table `profiles` with columns `id` (= auth user id) and `role` (`'owner'` or `'accountant'`).
- Business-owner app lives at route `/app`; accountant app lives at route `/accountant`; the public landing page is `/`.
- The Supabase client is already initialised and importable as `supabase`.

If any of those are different in the real code, keep my logic and just rename to match. **Tell me if a name doesn't exist rather than inventing a new one.**

---

## FIX 1 — Health Score orb looks broken in light mode

**Problem:** the health-score orb is a dark sphere. That reads fine on the dark theme but looks like a heavy black blob on the light (cream) theme.

**Fix:** keep the dark sphere for dark mode, and give light mode a luminous gold/pearl sphere with a dark bronze number. Find the element that renders the Business Health Score circle (the one showing e.g. "63 / FAIR"). Give it these class hooks if it doesn't already have them, then paste the CSS below.

**Expected markup** (adapt to whatever wrapper already exists — the key is the outer `.health-orb` and the three text spans):

```html
<div class="health-orb">
  <div class="orb-inner">
    <div class="orb-caption">Business Health Score</div>
    <div class="orb-score">63</div>
    <div class="orb-band">Fair</div>
  </div>
</div>
```

**CSS to paste** (into the app's global stylesheet — this is the whole fix):

```css
/* ===== Health Score Orb — theme-aware ===== */
.health-orb{
  position:relative;width:300px;height:300px;border-radius:50%;
  display:grid;place-items:center;text-align:center;margin:0 auto;
  /* DARK MODE (default): dark sphere with warm gold rim-light */
  background:radial-gradient(circle at 50% 38%, #2a2410 0%, #141006 46%, #0b0805 100%);
  box-shadow:
    0 0 90px 10px rgba(212,175,55,.28),
    inset 0 2px 30px rgba(253,238,121,.12),
    inset 0 -20px 60px rgba(0,0,0,.6);
  transition:background .45s, box-shadow .45s;
}
.health-orb::before{ /* soft top "shine" */
  content:"";position:absolute;inset:0;border-radius:50%;pointer-events:none;
  background:radial-gradient(circle at 42% 26%, rgba(253,238,121,.35), transparent 46%);
}
.health-orb::after{ /* crisp 1px gold rim */
  content:"";position:absolute;inset:-1px;border-radius:50%;padding:1px;pointer-events:none;
  background:linear-gradient(160deg, rgba(253,238,121,.7), rgba(212,175,55,.15) 40%, rgba(253,238,121,.45));
  -webkit-mask:linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite:xor; mask-composite:exclude;
}
.orb-inner{position:relative;z-index:1}
.orb-caption{font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:rgba(242,236,220,.6);margin-bottom:6px}
.orb-score{font-size:82px;font-weight:800;line-height:1;color:#fdee79}
.orb-band{font-size:14px;letter-spacing:.28em;text-transform:uppercase;color:#d4af37;font-weight:700;margin-top:8px}

/* LIGHT MODE override: luminous gold/pearl sphere, dark ink number */
html[data-theme="light"] .health-orb{
  background:radial-gradient(circle at 50% 34%, #fffdf3 0%, #f6e6ad 40%, #ecce78 70%, #dcb046 100%);
  box-shadow:
    0 22px 60px rgba(170,130,20,.28),
    0 0 70px 6px rgba(212,175,55,.30),
    inset 0 3px 26px rgba(255,255,255,.9),
    inset 0 -24px 55px rgba(150,110,10,.28);
}
html[data-theme="light"] .health-orb::before{
  background:radial-gradient(circle at 40% 24%, rgba(255,255,255,.95), transparent 48%);
}
html[data-theme="light"] .health-orb::after{
  background:linear-gradient(160deg, rgba(255,255,255,.95), rgba(212,175,55,.4) 45%, rgba(170,130,20,.55));
}
html[data-theme="light"] .orb-caption{color:#7a6a4a}
html[data-theme="light"] .orb-score{color:#3f2f06}
html[data-theme="light"] .orb-band{color:#a8791a}
```

If the theme is toggled by a `.dark`/`.light` class or Tailwind `dark:` instead of `data-theme`, make **light the base styles** and wrap the dark sphere rules in your dark selector — the colours above stay the same, only the selector wrapping flips.

Do not change the number, the band text, or the pillar cards below the orb — only the orb's look.

---

## FIX 2 — Replace the outdated onboarding tour

**Problem:** the first-run walkthrough (the "RATIOS 4/12" style coach-marks) is outdated and too long.

**Fix:** find the array/list of tour steps in the code (search for the existing step text, e.g. "recalculates every ratio", or for the tour library setup — it may be Driver.js, Shepherd, Intro.js, or a custom popover). **Replace the entire existing step list** with the arrays below. Keep the existing popover component/rendering; only swap the data and make it role-aware.

Each step: `target` is a CSS selector for the element to point at (adapt these selectors to the real elements), `title` and `body` are the copy. Show the **owner** tour to users whose role is `owner`, and the **accountant** tour to users whose role is `accountant`.

```js
// Business-OWNER first-run tour (6 steps)
const OWNER_TOUR = [
  {
    target: '.health-orb',
    title: 'This is your health score',
    body: 'One number for your whole business, updated live from your figures. Higher is healthier. Everything else on this page explains what’s behind it.'
  },
  {
    target: '.pillars, .pillar-cards',
    title: 'Four things drive that score',
    body: 'Profit, Assets, Financing and Cash. Tap any pillar to see exactly what’s pushing it up or dragging it down — in plain English.'
  },
  {
    target: '.view-toggle, [data-toggle="simplified-complex"]',
    title: 'Start simple',
    body: 'Stay on Simplified for the big picture. Switch to Complex only when you want the full detail behind every ratio.'
  },
  {
    target: '.priority-action, .top-priority',
    title: 'Your priority this week',
    body: 'We rank what to fix first for the biggest impact. Each week, start here — it’s the fastest way to move your score.'
  },
  {
    target: '.figures-input, [data-tour="figures"]',
    title: 'Keep your figures current',
    body: 'Enter your latest revenue, costs and balance sheet figures. Every ratio and benchmark recalculates instantly as you type. Update these whenever things change — the rest is automatic.'
  },
  {
    target: '.cash-forecast, [data-tour="cash-forecast"]',
    title: 'See cash before it bites',
    body: 'Your 13-week cash forecast shows the crunch weeks early — so you can act while there’s still time. That’s it, you’re ready. Your accountant sees this view too.'
  }
];

// ACCOUNTANT first-run tour (5 steps)
const ACCOUNTANT_TOUR = [
  {
    target: '.practice-dashboard, [data-tour="book"]',
    title: 'Your whole book, one view',
    body: 'Every client’s health score in a single dashboard, live. Sort by risk to see who needs you first — before they call in a panic.'
  },
  {
    target: '.client-card, .client-row',
    title: 'Open any client',
    body: 'Tap a client to drop into their full dashboard: score, pillars, ratios and cash forecast — the same view they see, so you’re always on the same page.'
  },
  {
    target: '.risk-flags, [data-tour="flags"]',
    title: 'Early-warning flags',
    body: 'When a client’s numbers move the wrong way, you get flagged here first. This is the advisory moment clients pay for.'
  },
  {
    target: '.reports, [data-tour="reports"]',
    title: 'Branded reports in a click',
    body: 'Generate white-label reports with your practice’s branding. Turn the analysis into a deliverable you can charge for.'
  },
  {
    target: '.comment-thread, [data-tour="comment"]',
    title: 'Advise in context',
    body: 'Comment straight on a client’s live figures — they’re notified instantly. That’s your recurring advisory layer, running. You’re ready to go.'
  }
];
```

Wiring: after login, read the user's role and pass the right array into the existing tour:

```js
const tourSteps = (profile.role === 'accountant') ? ACCOUNTANT_TOUR : OWNER_TOUR;
// ...feed tourSteps into whatever tour component already renders the popovers
```

Also make sure the tour only auto-runs **once** per user — gate it on a flag so it doesn't replay every login:

```js
// after the tour finishes or is skipped:
await supabase.from('profiles').update({ onboarded: true }).eq('id', user.id);
// on app load, only start the tour if profile.onboarded !== true
```

(Add an `onboarded boolean default false` column to `profiles` if it doesn't exist.)

---

## FIX 3 — Add a Sign out button (both owner and accountant)

**Problem:** there's no way to sign out and return to the landing page.

**Fix:** add a "Sign out" control to the app's top bar / user menu — visible on **both** the owner app and the accountant app. Here's the handler and a button:

```js
async function signOut() {
  try {
    await supabase.auth.signOut();
  } finally {
    window.location.href = '/';   // always return to the public landing page
  }
}
```

```html
<button class="signout-btn" onclick="signOut()">Sign out</button>
```

Minimal styling so it fits the header (adapt to the existing design system):

```css
.signout-btn{
  padding:8px 16px;border-radius:99px;border:1px solid rgba(212,175,55,.35);
  background:transparent;color:inherit;font:inherit;font-weight:600;font-size:13px;
  letter-spacing:.04em;cursor:pointer;transition:border-color .25s,color .25s;
}
.signout-btn:hover{border-color:#d4af37;color:#d4af37}
```

Place it in the existing header/nav or user dropdown — wherever the account/profile control already sits. It must appear for both roles.

---

## FIX 4 — Unlink the owner and accountant sign-ins (the "Portal" leak)

**Problem:** there's a link (labelled **"Portal"**) that lets a signed-in **business owner** jump straight into the **accountant** side with one click. Owner and accountant access must be completely separate — your account role decides which side you see, and you cannot cross over by clicking a link.

Do all of the following:

**4a. Remove the cross-link.** Find the element/link labelled "Portal" (search the codebase for `Portal`) that navigates an owner into the accountant view. Delete it, or hide it so it never appears for owners. Owners should have no UI path into `/accountant`, and accountants should have no stray path into an owner-only view.

**4b. Gate every route by role.** Add this guard and call it at the top of each side's pages. It sends anyone to *their own* side, never the side they tried to open:

```js
// returns the signed-in user's profile, or bounces to landing if not logged in
async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { window.location.href = '/'; return null; }
  const { data, error } = await supabase
    .from('profiles').select('role').eq('id', user.id).single();
  if (error || !data) { window.location.href = '/'; return null; }
  return { user, role: data.role };
}

// call requireRole('owner') on owner pages, requireRole('accountant') on accountant pages
async function requireRole(required) {
  const p = await getProfile();
  if (!p) return;                      // already redirected
  if (p.role !== required) {
    // send them to THEIR side, not the one they tried to reach
    window.location.href = (p.role === 'accountant') ? '/accountant' : '/app';
  }
}
```

Usage:
```js
// top of every owner page:
requireRole('owner');
// top of every accountant page:
requireRole('accountant');
```

**4c. Route login by role, not by which button/URL was used.** After a successful sign-in from *either* door, look up the role and send them to the matching app — don't let the choice of sign-in button decide the destination:

```js
async function afterLogin() {
  const p = await getProfile();
  if (!p) return;
  window.location.href = (p.role === 'accountant') ? '/accountant' : '/app';
}
```

**4d. Lock it down at the database, not just the UI (important).** Hiding the link is cosmetic — a determined owner could still type the accountant URL or hit the API. Enforce it with Supabase **Row Level Security** so an owner literally cannot read accountant-only data even if they force the URL. Enable RLS on the relevant tables and add role checks. Example pattern for an accountant-only table (adapt table/column names):

```sql
-- enable RLS on the table that holds accountant/practice data
alter table practice_clients enable row level security;

-- only users whose profile role is 'accountant' can read practice data
create policy "accountants read practice data"
on practice_clients for select
using (
  exists (
    select 1 from profiles
    where profiles.id = auth.uid()
      and profiles.role = 'accountant'
  )
);
```

Apply the equivalent so owner data is only readable by that owner (and their linked accountant, if that relationship exists). If you're unsure which tables hold accountant-only vs owner-only data, **list them for me before writing policies** rather than guessing.

---

## Order of work (cheapest → safest)

1. **Fix 1 (orb)** — pure CSS, no logic risk. Do first, show me the light-mode page.
2. **Fix 3 (sign out)** — small, self-contained.
3. **Fix 4 (auth separation)** — remove the Portal link, add the role guards, then the RLS policies. Show me the list of tables before writing RLS.
4. **Fix 2 (tour)** — swap the step data and add the `onboarded` gate last.

## Final checklist

- [ ] Orb looks like a glowing gold sphere in light mode, dark sphere in dark mode
- [ ] Sign out appears for both roles and returns to `/`
- [ ] No "Portal" link anywhere; owners can't reach `/accountant`, accountants can't reach owner-only views
- [ ] Login sends each user to their own side based on their saved role
- [ ] RLS blocks cross-role data access at the database level (not just hidden UI)
- [ ] New tour runs once per user, correct version per role, then never auto-replays
