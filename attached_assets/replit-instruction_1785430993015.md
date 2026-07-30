# Replit Agent — Wire up & deploy the MILŌN landing page

Paste the prompt below into Replit Agent. First, **upload `milon-landing.html` into the Repl** (the centaur logo is already embedded in the file, so you don't need to upload the PNG separately).

The page is already finished as plain HTML/CSS/JS. You are **not** rebuilding it and **not** converting it to React. The only two jobs are: (1) make the **Sign in** and **Register** buttons real using Supabase, and (2) connect the Repl to GitHub and deploy it.

---

## Prompt to paste

I have a finished marketing landing page for **MILŌN**, a financial-health platform for South African SMEs and their accountants. It's a single self-contained file, `milon-landing.html` — plain HTML, CSS, and vanilla JavaScript. **Do not convert it to React or any framework. Do not change the design, copy, layout, colours, or animations.** Keep it as vanilla HTML/JS.

There are only two things to do.

### 1. Wire up authentication with Supabase

Right now the **Sign in** button (in the nav and footer) and the **Register** button (in the register form near the bottom) just show placeholder `alert()` popups. Make them real using **Supabase Auth** via the official JS SDK loaded from CDN (`@supabase/supabase-js`) — no build step, just a `<script>` tag or ES module import.

**Sign-in modal** — it already has two options, "Business owner" and "Accountant / Practice". For each:
- Add email + password fields (and, if easy, a "Continue with Google" button using Supabase OAuth).
- On successful sign-in, remember which of the two the user chose (owner or accountant) and send them to a placeholder page `/app.html` for now. Owners and accountants can go to the same placeholder for the moment — just make sure the persona is saved so we can split them later.
- Keep the modal's existing behaviour: Escape to close, click-outside to close, scroll lock, and the "New here? Get your free health score" link that closes the modal and scrolls to the quiz.

**Register form** — it collects role (business owner / accountant), name, email, and business/firm name, plus a plan (Spark / Orbit / Constellation). On submit:
- Create the user in Supabase with email/password.
- Save their role, business name, and selected plan into their Supabase profile (create a simple `profiles` table if one doesn't exist: `id` (references auth user), `full_name`, `business_name`, `role`, `plan`).
- After signup, send them to the placeholder `/app.html`. We'll add payment later — for now the free diagnostic comes first, so no card is needed at signup.

Put the Supabase URL and anon key in **Replit Secrets** (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) and read them in the JS — never hardcode them into the HTML file that gets committed. Add a `.env.example` listing the secret names.

Handle the obvious error cases (wrong password, email already registered, network error) by showing a small inline message in the modal/form — no ugly browser alerts.

### 2. Connect to GitHub and deploy

- Connect this Repl to my **GitHub** account and push the project to a new repo (ask me for the repo name, or use `milon-landing`).
- Set it up so the site can be deployed as a static site (it's just HTML/CSS/JS). Use Replit's static deployment (or tell me the exact steps to deploy it from the GitHub repo to a static host).
- Make sure the Supabase secrets are configured in the deployment environment, not committed to the repo.

Start by getting the page running unchanged in the Repl so I can confirm it looks right, **then** wire up Supabase auth, **then** push to GitHub and deploy.

---

## Later (don't ask Replit for this yet)

When you're ready to take payments, the natural fit for your stack is **Supabase Edge Functions** — a small function that creates a Stripe Checkout Session for the chosen plan (Spark R299 / Orbit R699 / Constellation R1199, in ZAR), so you stay entirely inside Supabase and don't need a separate backend. The accountant practice model is a flat **R699/month** base fee plus per-client subscriptions — that logic can hang off the same function. Flag this to Replit only once auth is working and deployed.

## Quick checklist after it's done

- [ ] Page looks identical to the reference — nothing redesigned
- [ ] Both sign-in doors actually log in via Supabase and remember owner vs accountant
- [ ] Register creates a Supabase user and saves role + business + plan to `profiles`
- [ ] Errors show inline, not as browser alerts
- [ ] Supabase keys live in Secrets, not in the committed HTML
- [ ] Repl is pushed to your GitHub repo and the site is deployed
