# Accountant E2E smoke checklist

Short manual pass for the practice portal path: **invite → Client Brain → propose → sign-off**.
Run on staging or production after deploys touching `/dashboard`, `/clients/*`, Client Brain, or
review sign-offs. ~20 minutes with one test firm and one sandbox client.

Automated coverage today is static only (`pnpm test:client-brain`, `pnpm test:review-signoff`,
`pnpm test:invite-onboarding`) — this checklist is the human E2E layer.

## 0. Preconditions

- [ ] Signed in as **Accountant** (not owner-only).
- [ ] Firm exists; `/dashboard` loads after hard refresh (no reload deadlock).
- [ ] At least one client with figures loaded (upload + confirm review modal) — Brain propose needs
      financial context.
- [ ] Supabase migration `20260907140000_client_brain.sql` applied.
- [ ] Edge functions deployed: `brain-propose`, `brain-deliverable-draft` (Anthropic secret set).

## 1. Invite owner

Route: `/dashboard` → client row → **Invite owner**

- [ ] Dialog opens with client name; owner email field editable.
- [ ] **Copy message** includes an invite link (`/?invite=<token>…`).
- [ ] Optional: send to a **test inbox you control** (not a real firm owner during dry-run).
- [ ] Open invite link in a private window → owner sign-up / Google → lands on owner board for
      that client (`pnpm test:invite-onboarding` documents expected handoff).
- [ ] Owner orb score matches studio for the same client (see `docs/PILOT_SMOKE_CHECKLIST.md` §3).

## 2. Client Brain — Summary tab

Route: `/clients/<clientId>` → **Summary** (Client Brain)

- [ ] Summary tab renders: business map, GAP/competitors sections, outstanding questions.
- [ ] **Propose from brain** (or equivalent CTA) runs without error when figures exist.
- [ ] At least one **proposed next step** appears with status *Proposed*.
- [ ] Approve / Edit / Reject on a proposed step updates status (not stuck loading).
- [ ] Milōn bot panel answers **Invite status?** from live data (no invented token).

## 3. Propose → deliverable draft

Still on **Summary** tab:

- [ ] **Draft advisory from brain** (deliverable draft) produces subject + body.
- [ ] Assumption checklist renders when the draft includes assumptions.
- [ ] Draft can be marked ready / discarded per UI rules (`canMarkReady`, `canSend` in code).

## 4. Sign-off

Routes: same client — **Health & Ratios**, **Profit**, **Cash**, **Budget**, **Advisory** tabs

- [ ] Gold **Sign off** CTA visible on a tab with reviewed content.
- [ ] Sign-off records name, firm, timestamp; optional handwritten signature saves.
- [ ] Stale sign-off badge appears if figures change after sign-off (upload newer period).
- [ ] PDF / report export shows sign-off stamp when applicable (`pnpm test:review-signoff`).

## 5. Failure notes

If a step fails, capture: route, client id, browser, market (ZA/US), migration status, and Sentry
event (server function or edge function name). Fix hard breaks before demoing; do not work around
with manual SQL unless documented.

## Related automated tests

```bash
pnpm test:client-brain
pnpm test:review-signoff
pnpm test:invite-onboarding   # needs Supabase env
pnpm test:milon-bot
pnpm test:accountant-ask-ai-tab
```
