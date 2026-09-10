# Lighthouse Day-0 dry-run readiness

Use this before the first real cold sends from **Milōn Forge → Lighthouse — sales → Draft → Send now**
(`/ops`). Goal: prove the full path on **four test inboxes only**. Do not email firms. Do not remove
the recipient gate until Growth/Theo explicitly flip production send GO.

## Test inboxes (only valid recipients during dry-run)

| Inbox | Role |
|-------|------|
| `amstel.west@gmail.com` | Founder / default owner gate |
| `team@milon.co.za` | Milōn ZA ops |
| `team@milonfinance.com` | Milōn finance domain |
| `theoamstel123@gmail.com` | Secondary founder test |

During dry-run, **every other address fails closed** at send time.

## SHIPPED (this repo)

- **Recipient hard gate** — `sendLighthouseTouch` calls `assertLighthouseSendRecipientAllowed` before
  Resend. When `LIGHTHOUSE_DRY_RUN=true` or `LIGHTHOUSE_SEND_ALLOWLIST` is set, only allowlisted
  addresses receive mail.
- **Console banner** — `/ops` Lighthouse sales shows *Dry-run allowlist on* when the gate is active.
- **Default dry-run list** — `LIGHTHOUSE_DRY_RUN=true` without an explicit list uses the four inboxes
  above (`src/lib/lighthouse-send-allowlist.ts`).

## THEO MUST CLICK (Vercel Production)

1. **Enable dry-run gate** (keep until production GO):
   ```
   LIGHTHOUSE_DRY_RUN=true
   ```
   Or an explicit override:
   ```
   LIGHTHOUSE_SEND_ALLOWLIST=amstel.west@gmail.com,team@milon.co.za,team@milonfinance.com,theoamstel123@gmail.com
   ```
   Redeploy after setting. Confirm the amber banner on `/ops` → Lighthouse — sales.

2. **Resend API key** — `RESEND_API_KEY=re_...` in Vercel Production. Without it, drafts save as
   `approved` but nothing sends (implicit guard only — still set the key for dry-run).

3. **From domain** — `RESEND_FROM_EMAIL=Milōn <noreply@milonfinance.com>` (or verified domain in
   Resend). Domain must show **Verified** in Resend → Domains. SPF/DKIM/DMARC green.

4. **SITE_URL** — `SITE_URL=https://www.milonfinance.com` (or canonical production URL). Drives:
   - Trial links (`/?lh=<token>#register`)
   - Opt-out pages (`/unsubscribe?lh=…`, `/lh/unsubscribe?t=…`)
   - Asset links in drafted emails
   Also set `VITE_APP_URL` to the same value for client bundles.

5. **Resend webhook** — Resend → Webhooks → Add:
   - URL: `https://www.milonfinance.com/api/resend/webhook`
   - Events: `email.delivered`, `email.clicked`, `email.received`, `email.bounced`,
     `email.complained`, `email.failed`
   - Copy signing secret → Vercel `RESEND_WEBHOOK_SECRET=whsec_...`
   Redeploy. Without this, sends work but pipeline stages (delivered / replied / trial click) stay blind.

6. **Owner gate** — `MILON_OWNER_EMAILS` must include the Google account you sign into Forge with
   (default includes `amstel.west@gmail.com`). `/ops` also needs the landing passphrase
   (`MILON_OPS_PASSPHRASE` — change from default in production).

7. **Anthropic** — `ANTHROPIC_API_KEY` for *Draft with Claude*.

8. **Supabase migrations** (SQL editor, if not applied):
   - `20260820100000_milon_lighthouse.sql` — core Lighthouse tables + sequences
   - `20260820140000_lighthouse_optout_and_assets.sql` — opt-out tokens, `asset_fallback`, `accountant_v1`
   - `20260822100000_lighthouse_send_guards.sql` — idempotency / provider message id
   - `20260822210000_lighthouse_engagement.sql` — click / inbound tracking
   - `20260910190000_lighthouse_one_pager_assets_ready.sql` — one-pager PDF asset URLs
   - `20260910200000_lighthouse_teaser_videos.sql` — locked `teaser_owner` / `teaser_accountant` YouTube links

## Manual dry-run steps (Growth / Theo)

1. Sign in at `/ops` with an owner-allowlisted email + passphrase.
2. Open **Lighthouse — sales** → **Pipeline**.
3. For each test inbox, **Add lead** (or edit existing):
   - Persona **accountant** → sequence `accountant_v1`; persona **owner** → `owner_v1`
   - Email = one of the four test inboxes only
   - Stage **sourced** or **researched**, **Do not contact** off
4. Click the lead → **Draft with Claude** (step 1) → review subject/body.
5. **Send now** → confirm toast *Sent*; check the inbox (and spam).
6. Repeat for a second persona / step if you want to exercise `asset_fallback`.
7. **Day 3 (step 2) only** — draft/send a touch and confirm the body gifts **both** teaser links
   (owner: `https://youtu.be/k3aRM4toTvU`, practice: `https://youtu.be/J4vJki7HcIs`). **Day 0 (step 1)
   must still have no video link.**
8. Click opt-out link in a test email → lead should flip **Do not contact**; a second send must fail.
9. Reply to a test send → webhook `email.received` should surface in the lead drawer (needs webhook).

**Do not** import a CSV of firm emails during dry-run. **Do not** remove `LIGHTHOUSE_DRY_RUN` until GO.

## GAPS (code / env / ops)

| Area | Status | Notes |
|------|--------|-------|
| Recipient allowlist | **Guard shipped** | Set `LIGHTHOUSE_DRY_RUN=true` in Vercel |
| Resend key + from domain | **Env — Theo** | Verify domain in Resend dashboard |
| Webhook | **Env — Theo** | `RESEND_WEBHOOK_SECRET`; endpoint must match `SITE_URL` host |
| SITE_URL | **Env — Theo** | Trial + opt-out links wrong if missing / stale |
| `accountant_v1` sequence | **DB seed** | Applied via migration; 5 steps with `asset_fallback` on steps 2–3 |
| Opt-out | **Code + DB** | Per-lead `optout_token`; RFC 8058 headers at send; routes `/unsubscribe`, `/lh/unsubscribe` |
| `asset_fallback` | **Code + DB** | Drafter uses `[asset, asset_fallback]` via `firstReadyAsset()` — only `status=ready` assets link |
| Teaser videos | **Ready** | `teaser_owner` → `https://youtu.be/k3aRM4toTvU`; `teaser_accountant` → `https://youtu.be/J4vJki7HcIs`. Day 3 drafts gift **both** links (persona-first order). Day 0 has no video. |
| Assets default | **Manual — Theo** | Non-teaser slots (case study, 3-min demo) may still be `in_progress`; flip to **ready** in `/ops` → Assets after reading copy |
| One-pager PDFs | **Ready** | `/lighthouse/milon-one-pager-accountants.pdf` and `/lighthouse/milon-one-pager-owners.pdf` — each includes both teaser URLs in the video strip |
| Owner gate | **Env** | `MILON_OWNER_EMAILS` + passphrase; not auth/#140 |
| Daily cap | **Settings** | Default 25/day SAST in Lighthouse Settings — fine for dry-run |
| Auto-send | **Off by default** | `auto_send: false` in settings seed; sends are click-only |
| Inbound reply drafting | **Owner click** | Reply drafter is separate from sequence send — still respect allowlist on send |
| E2E test for Resend | **Gap** | No Playwright; static tests only (`pnpm test:lighthouse-send-allowlist`) |

## Production GO (later — not Day-0)

When ready for real firm outreach:

1. Remove `LIGHTHOUSE_DRY_RUN` and `LIGHTHOUSE_SEND_ALLOWLIST` from Vercel.
2. Redeploy; confirm dry-run banner is gone.
3. Raise daily cap if needed in Lighthouse Settings.
4. Mark required assets **ready** before sequences that link them.
5. Import leads deliberately — still manual **Send now** per touch.

## Quick verification commands

```bash
pnpm test:lighthouse-send-allowlist   # allowlist gate unit checks
pnpm test:lighthouse-it             # /ops routing + IT section
pnpm test:ci                        # full static CI suite
```
