# Auth reliability — live smoke checklist

Manual checks only. No production sends, no Lighthouse secrets, no firm emails.
Run against a preview or local dev after the relevant PR is deployed.

## Two-tab isolation (requires #140 on the branch under test)

Use **two separate tabs** (File → New Tab). Do **not** use Chrome “Duplicate tab” — it shares
`sessionStorage` and will false-pass or false-fail.

| Step | Action | Pass |
|------|--------|------|
| 1 | Tab A → milonfinance.com (or preview), sign in as **Account A** | A’s name/email visible |
| 2 | Tab B → same origin, sign in as **Account B** (different email) | B’s name/email visible |
| 3 | Switch to Tab A | Still **Account A** (not B) |
| 4 | Switch to Tab B | Still **Account B** (not A) |
| 5 | Tab A → Sign out | Tab A signed out |
| 6 | Tab B (no refresh) | Still **Account B** |
| 7 | Refresh Tab B | Still **Account B** |
| 8 | Refresh Tab A | Still signed out; no ghost session from B |

**Fail signals:** Tab A shows B after step 3; Tab B goes signed-out after step 5; either tab “flips”
account without you signing in again.

## Google owner invite → /app (requires #138; independent of #140)

Use a **firm-created client owner invite** (opaque token link, not staff member invite).

| Step | Action | Pass |
|------|--------|------|
| 1 | Open invite link `/?invite=<token>&mode=signup` while signed out | Invite form / Google CTA |
| 2 | Choose **Continue with Google** (same email as an existing **accountant** login is the regression case) | Google OAuth |
| 3 | Complete Google sign-in | Lands on **`/app`** founder board |
| 4 | Check role / workspace | **Business owner seat** on the **invited client** — not `/dashboard` practice console |
| 5 | Optional: Settings → verify return path | Owner settings, Back → `/app` |

**Fail signals:** `/dashboard` practice portal; wrong client; `firm_admin`-only profile on the owner
board; invite dropped (generic new workspace instead of invited client).

## After #140 merges — re-run both suites once

#140 changes storage only; #138 invite cookies and callback redeem are unchanged. A green two-tab
smoke plus green Google-invite smoke confirms both layers.
