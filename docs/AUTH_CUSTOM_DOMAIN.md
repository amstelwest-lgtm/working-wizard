# Google OAuth: custom Supabase Auth domain

Runbook for replacing the default `*.supabase.co` hostname on Google’s “Continue to …” consent screen with a Milōn-owned auth subdomain.

**Custom auth hostname:** `auth.milonfinance.com` (default for all steps below).  
**Optional later override:** `auth.milon.co.za` — only if Milōn switches regional branding; repeat DNS, Google redirect URIs, and env cutover for the new host.

**Official references**

- [Supabase custom domains](https://supabase.com/docs/guides/platform/custom-domains)
- [Supabase CLI: `supabase domains`](https://supabase.com/docs/reference/cli/supabase-domains)
- [Supabase: Sign in with Google](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Google: OAuth brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Google Cloud: Manage OAuth app branding](https://support.google.com/cloud/answer/15549049)

---

## Problem

Google Sign-In shows **“Continue to `jxclnsbsqpixxqlbcapl.supabase.co`”** (or similar) on the OAuth consent screen.

The frontend **cannot** rename this. Google displays the **OAuth redirect / callback host** that Supabase Auth uses. Fixing it requires:

1. A **Supabase custom Auth domain** (paid add-on on Pro+), and  
2. Matching updates in **Google Cloud** (OAuth client redirect URIs + Auth Platform branding).

No app code changes are required. Env vars flip only after the custom hostname is **Active** (see [Eng after Active](#eng-after-active)).

### Repo wiring (unchanged by this runbook)

| What | Path / note |
|------|-------------|
| Client Supabase URL at build | [`vite.config.ts`](../vite.config.ts) — `define` maps `process.env.SUPABASE_URL` → `import.meta.env.VITE_SUPABASE_URL` |
| Supabase client | [`src/integrations/supabase/client.ts`](../src/integrations/supabase/client.ts) — reads `VITE_SUPABASE_URL` (client) or `SUPABASE_URL` (SSR fallback) |
| Google OAuth start | [`src/lib/google-auth.ts`](../src/lib/google-auth.ts) — `startGoogleSignIn()` → `signInWithOAuth({ redirectTo: …/auth/callback })` on **`milonfinance.com`**; **no change** for custom auth domain |
| Google provider credentials | **Supabase Dashboard** → Authentication → Providers → Google — **not** [`supabase/config.toml`](../supabase/config.toml) (repo file covers email templates only) |

Google’s consent screen shows the **Supabase Auth host** (`auth.milonfinance.com` after cutover), not the app’s `redirectTo`. The app callback stays `https://milonfinance.com/auth/callback`.

---

## Custom auth hostname

| Host | Use |
|------|-----|
| **`auth.milonfinance.com`** | Default — use for Supabase, DNS, Google, and env cutover |
| `auth.milon.co.za` | Optional later override only; not in scope for initial rollout |

Follow the `auth.example.com` pattern per [Supabase Google auth guidance](https://supabase.com/docs/guides/auth/social-login/auth-google).

---

## Theo-only checklist

Complete in order. **Do not** update Vercel env vars here — that is [Eng after Active](#eng-after-active) only.

### 1. Supabase Custom Domains (Pro+ add-on)

- Supabase Dashboard → **Project Settings → General → Custom Domains** (or follow [custom domains guide](https://supabase.com/docs/guides/platform/custom-domains)).
- Enable the **Custom Domains** paid add-on if not already on the project.
- Register **`auth.milonfinance.com`**.
- Google provider is already configured in **Dashboard → Authentication → Providers → Google** (not in repo `supabase/config.toml`).

### 2. DNS CNAME → wait until Active

- Add the **CNAME** (and any verification records) for **`auth.milonfinance.com`** exactly as Supabase instructs.
- Wait until status is **Active** in the dashboard / `supabase domains get`.
- Do not proceed to Google redirect updates or eng env cutover while pending.

### 3. Google Cloud OAuth client — redirect URIs

In [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Credentials** → the OAuth 2.0 Client used by Supabase Google provider:

**Authorized redirect URIs** — keep **both** during cutover:

```
https://auth.milonfinance.com/auth/v1/callback
https://jxclnsbsqpixxqlbcapl.supabase.co/auth/v1/callback
```

Supabase documents this dual-URI pattern in [Prepare to activate your domain](https://supabase.com/docs/guides/platform/custom-domains). Remove the `*.supabase.co` callback only after eng env cutover is stable.

### 4. Google Auth Platform branding

Google Cloud → **Google Auth Platform → Branding**:

| Field | Value |
|-------|--------|
| App name | **Milōn** |
| Logo | Milōn mark |
| Application home page | `https://milonfinance.com` |
| Privacy / Terms | Production URLs on `milonfinance.com` |

Submit **Verify branding** if prompted. Verification is **not** instant — plan for **days** ([brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)). Until verified, users may still see domain-only text on the consent screen.

### 5. Supabase Auth URL configuration

Supabase Dashboard → **Authentication → URL Configuration**:

- **Site URL:** `https://milonfinance.com`
- **Redirect URLs** (allowlist) — include production app paths, e.g.:
  - `https://milonfinance.com/auth/callback`
  - `https://milonfinance.com/auth/verified`
  - `https://milonfinance.com/app`
  - `https://milonfinance.com/dashboard`
  - `http://localhost:5000/**` (local dev)

Align with existing launch checklist in [`docs/PILOT_SMOKE_CHECKLIST.md`](./PILOT_SMOKE_CHECKLIST.md).

---

## Eng after Active

Once **`auth.milonfinance.com`** is **Active** in Supabase, update **Vercel** (Production + Preview if applicable). **Do not commit secrets** — dashboard / env only.

### Env vars this repo uses

| Variable | Where used |
|----------|------------|
| `SUPABASE_URL` | **Primary.** Build env → client bundle via [`vite.config.ts`](../vite.config.ts) `define` (`SUPABASE_URL` → `VITE_SUPABASE_URL`); SSR / server functions via `process.env` |
| `VITE_SUPABASE_URL` | Optional explicit client copy; also used by direct `import.meta.env` reads. Set to match `SUPABASE_URL` to avoid drift |
| `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Anon key — unchanged when only the URL host changes |
| Supabase client consumer | [`src/integrations/supabase/client.ts`](../src/integrations/supabase/client.ts) |

Set **both** URL vars in Vercel to the same value (see [`.agents/memory/supabase-project-drift.md`](../.agents/memory/supabase-project-drift.md)):

```
SUPABASE_URL=https://auth.milonfinance.com
VITE_SUPABASE_URL=https://auth.milonfinance.com
```

**Redeploy** after changing build env — `vite.config.ts` inlines the URL into the client bundle at build time.

**No change** to OAuth app callback: [`src/lib/google-auth.ts`](../src/lib/google-auth.ts) keeps `redirectTo` at `https://milonfinance.com/auth/callback`.

Supabase **Edge Functions** receive `SUPABASE_URL` from the Supabase runtime automatically; no separate secret for the public URL. Client-side calls use the Vercel-injected `VITE_SUPABASE_URL`.

### Cutover fallback

During rollout, keep the old project URL documented as rollback:

```
https://jxclnsbsqpixxqlbcapl.supabase.co
```

If Google OAuth fails after deploy, temporarily revert `VITE_SUPABASE_URL` and `SUPABASE_URL` to the `*.supabase.co` URL and redeploy while debugging DNS / Google redirect URIs.

### Smoke after cutover

- Owner Google sign-in on production — consent should show **`auth.milonfinance.com`**, not `*.supabase.co`.
- Magic link / email auth still delivers (SMTP unchanged).
- Re-run auth items in [`docs/PILOT_SMOKE_CHECKLIST.md`](./PILOT_SMOKE_CHECKLIST.md).

---

## Out of scope

- Application code or auth flow behavior changes  
- Committed credentials or `.env` updates in git  
- Calculator / magic-link architecture changes  
- Removing the legacy `*.supabase.co` Google redirect URI before cutover is proven stable  
- Initial setup of `auth.milon.co.za` (optional later override only)
