# Send an agent

Planning only. This document does not change the product. Nothing here is a reason to deploy, apply a migration, or send mail.

## Quickest path for Nicola physio

There is no usable link today.

`/talk/tax-specialist` is a public sample. It is not tied to a firm, a client, or Nicola. The repo has no client named Nicola. Sending her that URL opens a labelled SAMPLE company-tax chat (IRP6 / ITR14). It does not ask for an IRP5, a medical aid tax certificate, an RA contribution certificate, an IT3(b), or physio practice income and expenses. It does not accept a file. It does not write to a client file.

What already works, if the accountant is signed in on her client file:

- Upload a PDF or photo on the source-documents panel in her client brain (`SourceDocumentsPanel` in `src/components/client-brain-summary.tsx`). The file is stored against that `client_id`. The accountant should not run extraction or approve a ledger proposal. Upload itself does not post to Xero, QuickBooks, or Sage.
- That path is the accountant uploading. It is not a chat, not a checklist, and not her consent.

What does not reach her without a password:

- A data-request email goes to the portal owner's profile address and links to `/app?tab=today`, which needs a sign-in. If the sender is that owner, the send is refused (`reason: "self"` in `sendDataRequestEmail`). The kinds are bank statement, management accounts, aged debtors, aged creditors, bank balance, payroll, accounting connection, and a free-text "other". The five tax items are not kinds.
- An owner invite (`/join/$token`) creates an account.

Under the deploy freeze, do not build or ship the slice below. It needs a production migration and an app deploy, both of which need Chief of Staff approval. Until that approval, the accountant collects Nicola's documents outside this link and files them on her client while signed in.

The smallest later slice that makes a link usable is PRs 1–4 below. Even then, this plan's mail goes only to `amstel.west@gmail.com`. It does not email Nicola. The firm owner forwards the link.

## 1. Current `/talk/<agent>` links

Another engineer shipped a public sample chat, not a firm-sent client link.

### Routes

| Route | File | What it is |
| --- | --- | --- |
| `/talk/$agent` | `src/routes/talk.$agent.tsx` | One agent. No account. |
| `/talk/` | `src/routes/talk.index.tsx` | Picker. Optional `?ref=` marketing code. |

Both are `noindex`. The page is server-rendered. The first message is posted only after React hydrates (`docs/rootcause/talk-first-message.md`). A click before hydration used to reload the page and drop the text. That is fixed on main.

`src/lib/public-marketing.ts` treats `/talk` as a public marketing path.

### Agents

`src/lib/prospect-talk.ts` lists four public slugs:

- `financial-manager` — Financial Manager
- `analyst` — Analyst
- `advisor` — Advisor
- `tax-specialist` — Tax Specialist

The Tax Specialist exists. She is a sample persona, not a document collector.

- Copy and the filing refusal: `src/lib/prospect-tax-copy.ts`. Greeting: she prepares a labelled SAMPLE company worksheet and does not log into SARS or file.
- Prompt, used only by the prospect function: `supabase/functions/_shared/agent-prompts/tax-specialist.ts`. IRP6 and ITR14 for a standard resident company. No ledger write. No SARS login. Under 80 words.
- There is no Tax Specialist runner. `supabase/functions/agent-dispatch` starts the Financial Manager, Analyst, and Advisor only. `supabase/functions/_shared/agent-prompts/tax-specialist.ts` says so.
- Her face is the existing silent clip in `public/avatars/tax` (`AVATAR_FOLDERS.tax_specialist` in `src/lib/fm-avatar-state.ts`).
- A visitor who is not resolved as South Africa does not get her. The route returns a note (`resolveTalkSlug` in `src/lib/prospect-talk.ts`, `closedTaxTalk` in `src/lib/prospect-talk-handler.ts`). ZA copy is loaded with a dynamic import so the US bundle does not contain it.

`AGENT_DISPLAY_NAME` in `src/lib/milon-team-names.ts` still names only the Financial Manager, Analyst, and Advisor. The Tax Specialist's display name is local to the talk copy.

### How a link is minted

The URL is not minted. Anyone can open `/talk/tax-specialist`.

A session token is created on the first chat turn, inside `handleProspectRequest` (`src/lib/prospect-talk-handler.ts`). `newProspectToken()` is 32 random bytes, base64url (`src/lib/prospect-talk.ts`). The browser keeps the raw token. The database stores only `token_hash` (SHA-256).

`?ref=` is an optional marketing code (`sanitizeRef`: 1–80 characters, letters, digits, `.`, `_`, `-`). It is copied onto the lead. It is not a client id and not a firm id.

### Storage, scope, expiry, revocation

Migration `supabase/migrations/20261020120000_prospect_talk.sql`:

- `prospect_talk_sessions`: `token_hash`, `agent` (the four slugs), `ip_hash`, `country` (`US` or `ZA`), `ref`, `visitor_turns`, `lead_email`, `sample_nonce`, `created_at`, `expires_at`.
- `prospect_talk_turns`: `session_id`, `ip_hash`, `created_at`. Used for rate limits. The message text is not stored on the turn row.
- `trial_leads.sample_nonce` proves a lead was saved before the sample board opens.
- Row level security is on. `anon` and `authenticated` have no grants. The edge function writes with the service role.
- No `firm_id`. No `client_id`. No `revoked_at`.

`supabase/migrations/20261020203000_prospect_talk_pending.sql` adds `pending_message` so the turn that opened the name form can be answered after the lead is saved.

Expiry is one day from creation (`DAY_MS` in `src/lib/prospect-talk-handler.ts`). `getSession` returns a row only when `expires_at` is still in the future. There is no revoke. A leaked token works until that timestamp, from any IP, for that agent only.

Caps, in `src/lib/prospect-talk.ts`: 500 characters a message, 3 visitor turns before the name form, 4 more after it (7 total), 20 turns per IP per hour, 8 sessions per IP per day, 400 turns globally per day, 2 leads per email.

### Chat execution

`supabase/functions/prospect-talk/index.ts`. `verify_jwt = false` in `supabase/config.toml`. The handler refuses SARS filing and ledger writes, and it will not quote figures before the lead. The model default is `claude-haiku-4-5`.

The lead form (`src/components/prospect-talk.tsx`) says "No password. This continues the sample." The tick box says "I agree Milōn may email me about this sample." That is marketing consent. It is not POPIA consent to collect tax documents for a named client.

On lead, `trialStartMail` in `src/lib/trial-lead-alert.ts` emails `amstel.west@gmail.com` that a sample started. The visitor is not emailed a coded link.

### Uploads

The talk page has no file input. Nothing from a talk session is written to `source_documents` or to any client file.

Client files already accept documents from a signed-in user:

- Table `source_documents` (`supabase/migrations/20261013170000_source_documents_to_ledger.sql`). `client_id`, `uploaded_by` (an `auth.users` id, required), channel `upload` | `camera` | `email`, private bucket path, sha256, PDF or photo, 20 MB.
- `register_source_document` refuses a caller with no `auth.uid()`, and `source_doc_can_upload` allows only the client owner or a firm member of that client's `firm_id`.
- The accountant sees the files on the client brain. The owner door has the same panel.
- Extraction (`extract-source-document`) writes a proposal. It does not post. A person still approves. This plan must not call that function for tax certificates. The statement quality gate in `src/lib/upload-quality.ts` looks for income-statement and balance-sheet anchors. An IRP5 would fail that gate. Do not reuse it.

### Email that exists (Resend)

Resend is the sender. Relevant paths:

- `sendAccessEmail` in `src/lib/practice-access-email.ts`. Uses `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (fallback `noreply@milonfinance.com`). Used by data-request mail and access mail.
- `sendTeamMail` in `src/lib/trial-lead-alert.ts`. Talk and `/try` alerts. Hard-coded to `amstel.west@gmail.com`.
- Data-request mail: `sendDataRequestEmail` in `src/lib/data-requests.functions.ts`. Needs a portal owner. See the Nicola section.
- Owner-invite mail: `src/lib/client-invite-email.ts` and `src/lib/client-invite.functions.ts`. The address is `clients.contact_email`. The link is a join link, not an agent.
- Lighthouse has a separate allowlist (`src/lib/lighthouse-send-allowlist.ts`). It is env-gated, and the dry-run list includes more than one inbox. Do not reuse that switch for this feature. A missing env var would let a client address through.
- `emails/try-outreach.tsx` still points every agent at `https://www.milonfinance.com/try`. The comment says the one-agent URL was not wired. That file does not send mail.

Passwordless links that already exist, and that this feature should not overload:

- `/t/$token` — one action-plan task. `action_tokens` stores a hash, `expires_at`, and `revoked_at`. `supabase/functions/task-link` checks both. No documents.
- `/access/$token` — staff or access approval.
- `/join/$token` — owner account.

### Recent talk work on main

| PR | Merged | What landed |
| --- | --- | --- |
| [#670](https://github.com/amstelwest-lgtm/working-wizard/pull/670) | 2026-10-20 | Public one-agent links, lead before the sample, session table. |
| [#693](https://github.com/amstelwest-lgtm/working-wizard/pull/693) | 2026-10-20 | Three turns before the name form. Tax Specialist added. |
| [#697](https://github.com/amstelwest-lgtm/working-wizard/pull/697) | 2026-10-20 | Tax Specialist hidden outside South Africa. |
| [#701](https://github.com/amstelwest-lgtm/working-wizard/pull/701) | 2026-10-20 | Method answers, pricing, first-send fix. |
| [#705](https://github.com/amstelwest-lgtm/working-wizard/pull/705) | 2026-10-21 | First message kept. Public pricing answered. |
| [#708](https://github.com/amstelwest-lgtm/working-wizard/pull/708) | 2026-10-21 | Thread kept when the signed-in shell arrives. Browser test waits for hydration. |

Open and not part of this feature: [#719](https://github.com/amstelwest-lgtm/working-wizard/pull/719) (Analyst method note), [#723](https://github.com/amstelwest-lgtm/working-wizard/pull/723) (method answers from the scoring registry).

The migrations say they do not apply themselves. This plan did not inspect the production database or the live deploy. If main is what is deployed, the sample page is live. The client feature is not.

### Avatars, navigation, WhatsApp

- Talk already uses `SilentAgentPortrait` (`src/components/silent-agent-portrait.tsx`): poster first, then a muted idle loop, volume 0, no audio. Reduced motion stays on the poster. Keep that. Do not add a speaking clip.
- The accountant portal rail is vertical (`flex-direction: column` on `.deliverable-rail` in `src/styles/accountant-portal.css`, `src/components/accountant-nav.tsx`). The client page for this feature uses a vertical checklist. No horizontal tab bar.
- WhatsApp is already a share action on the accountant client page (`src/routes/_authenticated/clients.$clientId.tsx`, `src/components/accountant-ratios.tsx`, `src/components/advisory-drafter.tsx`). Accountant-facing copy for Send an agent does not mention WhatsApp. Do not add a WhatsApp button on this flow.

## 2. What is missing, and the smallest change

An existing `/talk` link cannot be tied to Nicola. The session row has nowhere to put her client id.

Missing for a usable link:

| Need | Today |
| --- | --- |
| Firm and client scope | Absent. `ref` is a marketing string. |
| Coded link minted by the accountant | The URL is public. The token is created by the visitor's first message. |
| Email only when the accountant clicks Send | Talk emails the team when a stranger leaves a name. It does not email the client. |
| Tax Specialist mission for this job | She discusses a SAMPLE company worksheet. The five documents are not in her questions or her prompt. |
| Checklist | None. Data-request kinds do not include these documents. |
| POPIA consent before collection | The tick box is permission to email about the sample. |
| Medical totals only | No medical handling. |
| Upload onto that client's file | No upload on the page. `register_source_document` requires a signed-in owner or firm member. |
| Quality bar, with an incomplete flag | The statement gate rejects a file that is not a set of accounts. There is no "client says this is all they have" state. |
| Send-back with extra asks, same link | No. A new visit is a new sample session. |
| Accountant review | No review view for a talk. Source documents are a different pipeline and can propose a ledger draft. |
| Revocation | No `revoked_at`. One-day expiry only. |
| Stay off SARS, completed forms, and ledgers | The sample prompt already refuses SARS login and ledger writes. A new mission prompt has to repeat that, because the sample prompt is the wrong mission. |

Do not add `client_id` to `prospect_talk_sessions`. That table is an anonymous marketing log with IP hashes, a 7-turn cap, and a lead form. A client tax file does not belong on it.

Smallest change that makes Nicola's link usable. All four steps need Chief of Staff approval before they are applied or deployed. None of them belong in this docs change.

1. New tables, service role only, no grants to `anon` or `authenticated`. Suggested names: `client_agent_sends` and `client_agent_send_items`. Do not reuse the name `agent-dispatch` (that cron starts the other three agents). Columns on the send: `firm_id`, `client_id`, `agent` (`tax-specialist` for this job), `token_hash`, `sent_by`, `expires_at`, `revoked_at`, `consent_at`, `checklist_key`, `extra_asks`. Items: the five keys below, status, quality (`usable`, `incomplete`, `poor`), client explanation, `source_documents.id`. Store the hash only, same as `action_tokens`.
2. A "Send an agent" control on the client file the accountant already opens. It picks the Tax Specialist and inserts the row. It shows the link. It does not send mail. The public URL is a new route, `/a/$token`, which loads the agent from the row. Do not hang the client file off `/talk/$agent`. That route is the sample, and a non-ZA network is refused before any token is read.
3. The public page, in order: POPIA consent stored on the send, then the checklist, then the chat. Uploads go in with the service role. `uploaded_by` is the accountant who clicked Send (a real `auth.users` id). Channel stays `upload`. Do not call `register_source_document` as the visitor, and do not call `extract-source-document` or `decide_ledger_post_proposal`. Quality is "workable and understandable with some explanation": a PDF or photo that opens and matches the item is enough. If she says that is all she has, keep the file, store her explanation, and mark the item `incomplete` or `poor`. Do not reject it for failing the statement-anchor gate.
4. Mail on the Send click only, through Resend, recipient hard-coded to `amstel.west@gmail.com` in this feature's own check. Not the Lighthouse env allowlist. No mail on mint, on page load, or on her replies.

Physio checklist for that first template:

- IRP5
- Medical aid tax certificate, totals only. Do not ask for diagnoses, dependants' conditions, or line-item claims.
- RA contribution certificate
- IT3(b)
- Physio practice income and expenses (a simple income-and-expense summary is enough)

Prompt rules for that page, in addition to the checklist: do not send her a completed return or a filled form; do not log into SARS; do not submit anything; do not post to Xero, QuickBooks, or Sage; do not mention WhatsApp. Avatar stays `SilentAgentPortrait`. Navigation is the vertical checklist.

Deploy notes, when approval exists:

- The migration has to be applied before the app that reads it.
- The app deploy is a normal Vercel deploy of those PRs.
- Do not redeploy `prospect-talk` for this work, and do not change `verify_jwt` on it.
- This docs PR needs no deploy.

## 3. PR sequence

Each PR is independent enough to review on its own. Later PRs assume the earlier tables and the token format. No PR emails anyone except `amstel.west@gmail.com`, and only PR 4 sends at all. No PR deploys itself.

Leave these files alone. There is no file named gate-blocker. The billing gate already wraps the client file. Put the button on the file, not in the gate.

- `src/routes/_authenticated.gate.tsx`
- `src/components/firm-billing-gate-view.tsx`
- `src/lib/billing-check-failure.ts`
- `src/lib/firm-client-gate.ts`
- `src/lib/firm-client-create-gate.ts`
- `src/lib/firm-gate-access.ts`
- `supabase/functions/_shared/precard-cap-gate.ts`
- `supabase/functions/_shared/starter-trial-gate.ts`

### PR 1 — Tables

Scope: `client_agent_sends` and `client_agent_send_items` only. Service role grants. RLS on, no policies for `anon` or `authenticated`. No change to `prospect_talk_sessions`, `source_documents`, or the gate files.

Acceptance:

- A test database applies the migration.
- `anon` and `authenticated` cannot read or write the tables.
- A send row requires `firm_id` and `client_id`. The token column is a hash. `revoked_at` exists.
- The five physio item keys can be inserted. Medical is marked totals-only in the checklist definition, not as a free-text medical history.

### PR 2 — Mint, no mail

Scope: firm member with access to that client can open "Send an agent", pick Tax Specialist, and create one send plus the five items. The screen shows `/a/$token`. Copy is vertical, silent-avatar language is unchanged, and the words WhatsApp do not appear.

Acceptance:

- A firm member of that client's firm can mint. Another firm cannot.
- The raw token is not stored. A second lookup by hash finds the row.
- Revoked or expired tokens do not resolve.
- The action writes no email row and calls no mail function.
- `/talk/tax-specialist` still opens the sample and still refuses a non-ZA visitor.

### PR 3 — Client page

Scope: `/a/$token` renders the Tax Specialist for that send. POPIA tick is required before chat or upload. Checklist, chat, and upload. Files land on that `client_id` in `source_documents` with `uploaded_by` set to the sending accountant. Quality and the client's explanation are stored on the item. No extraction, no proposal, no SARS, no completed form in the reply.

Acceptance:

- Opening the link does not ask for a password and does not show the sample lead form.
- Chat and upload stay blocked until consent is stored.
- A usable PDF appears on her client brain source-documents list.
- "This is all I have" keeps the file, stores the explanation, and sets `incomplete` or `poor`.
- A medical item's stored note has totals only. A prompt that asks for a diagnosis is a test failure.
- Replies do not contain a filled form, a SARS login step, or a ledger post.
- The portrait is muted. The checklist is a vertical list. Accountant strings in this PR do not say WhatsApp.
- Tests use a fixture client. They do not call Resend.

### PR 4 — Email on Send

Scope: the Send click from PR 2 now sends one mail via Resend. Recipient check is hard-coded to `amstel.west@gmail.com` and fails closed for every other address, including `clients.contact_email`.

Acceptance:

- No mail when the row is minted without the Send click, and no mail when the client replies.
- A test that passes any other address fails the send and writes nothing to Resend.
- The message body is the coded link and the firm name. It does not include a document, a form, or WhatsApp.
- Idempotency: a double click does not send two mails.
- Tests do not use a live API key.

### PR 5 — Send back

Scope: on the same send, the accountant adds extra asks and clicks Send again. The same token opens with those asks. Earlier files stay.

Acceptance:

- Old items and their files are unchanged.
- The new asks show on the next open of `/a/$token`.
- The second mail still goes only to `amstel.west@gmail.com`, and only because the accountant clicked Send.
- A revoked send stays closed.

### PR 6 — Accountant review

Scope: a read-only view on that client's file. One row per item: file, quality, explanation, incomplete or poor flag, extra asks. No extract button, no approve button, no post button.

Acceptance:

- The view lists the five items and any send-back asks.
- It does not call Xero, QuickBooks, Sage, SARS, or `extract-source-document`.
- A firm member without access to that client cannot open it.
- The owner portal is unchanged in this PR.

## Out of scope

- Emailing Nicola, or any address other than `amstel.west@gmail.com`.
- Individuals' returns beyond this checklist, SBC rates, and the company worksheet in `docs/tax-specialist-plan.md`.
- Posting journals, tax codes, invoices, or payments.
- A Tax Specialist background runner under `agent-dispatch`.
- Changing the public sample at `/talk`.
