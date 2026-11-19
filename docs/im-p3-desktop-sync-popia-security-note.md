Status: approved by CoS 2026-11-19; desktop agent build PARKED pending Theo OK

# IM P3: Desktop folder-sync agent, POPIA and security note (draft v1, Eng3, 19 Nov 2026)

## 1. What it is
- It is an optional small agent the partner installs on a practice PC. It is never bundled and never auto-installed.
- It watches only the folders the partner names, one by one. It has no "whole disk", home-directory or drive-root option, and no background scan of anything else.
- It only uploads. It never writes, moves, renames or deletes local files, so there is no write-back.
- It uses the rung 1–4 paths: it uploads into the same client source-documents path that manual uploads already use (to be confirmed in code). The existing classify step then puts the file into the review queue. Nothing is auto-filed to a ledger.
- It is a candidate for Theo's VAT/EMP/provisional deadline folders, not a default.

## 2. Opt-in and consent (POPIA s11 consent / legitimate interest, s18 notice)
- It is off by default for every firm, and the server enforces this. A firm flag stays off until a named partner turns it on in Settings and accepts a plain-language notice of what is read, where it goes, how long it's kept and how to stop.
- The consent records the partner's user id, the time, the notice version and the folder list. It lives in existing audit/logging tables, with no new table; if one turns out to be needed, I'll flag it to CoS first.
- Each folder is mapped to exactly one client. A file is never routed across clients.
- The practice is the responsible party for its clients' data, and Milōn is the operator (s21). The notice says so.

## 3. What is read
- Read: files in the named folders, filtered to an allow-list of extensions (pdf, csv, xlsx, xls, png, jpg). The size cap matches the existing upload cap.
- Never read: anything outside the named folders, hidden or system files, .env, key or certificate files, browser profiles, email stores, password vaults, or anything matching secret patterns.
- Metadata sent: file name, size, hash, modified time and folder label. The full local path is not sent; it's replaced by the folder label.
- Hash-based dedupe means an unchanged file is never uploaded twice.

## 4. Where it is stored
- Files go to the existing Supabase storage for client source documents, under the existing RLS: firm members and the linked client's owners only (to be confirmed in code).
- Retention follows the source-docs rule Theo already approved: source files kept 5 years. Delete-on-request is supported per POPIA s24.
- Transfers use TLS. Storage is encrypted at rest by the provider.
- Cross-border (s72): Supabase/Vercel region per the existing Privacy page. No new processor is added.
- No file content goes to model providers beyond what the existing classify step already sends. Runs use Sonnet; Opus is never used for routine execution.

## 5. Auth and least privilege
- The device token is scoped to one firm with upload-only rights to its mapped clients, and is short-lived and refreshable. It cannot read back other documents, list clients or call agents.
- The token is stored in the OS keychain (macOS Keychain or Windows Credential Manager) and never in plain files. It's never logged, and Milōn staff can't see it.
- Pairing is done from the signed-in web app (a one-time code), with no password typed into the agent.
- Uploads are rate-limited per device, with hard caps on files and bytes per day.

## 6. Revoke and stop
- One click in Settings ("Disconnect this computer") revokes the device token server-side. The next upload attempt fails, and the agent stops watching and shows "Disconnected".
- Turning off the firm flag revokes all of the firm's devices.
- Uninstalling the agent removes the keychain entry and the local state. Already-uploaded files follow the normal retention and delete rules.
- Every connect, disconnect and upload is shown in an activity list the partner can see.

## 7. Hard limits (unchanged)
- No SARS login or filing.
- Nothing posted to Xero, QBO or Sage without a named human's logged approval.
- Drafts only, no sends.
- No internals shown to clients.
- No WhatsApp in accountant copy.
- Test on the Ben test firm e8f7a440 only.

## 8. Build plan (after OK), as HOLD PRs at 8/8
- **PR F (no agent binary yet):**
  - The server side: the firm opt-in flag with notice and consent logging, device pairing with the scoped upload-only token, revoke, the activity list, and Tax Specialist deadline-watch steps as draft workings (no SARS).
  - The cron #986 nits are folded in: count skipped_stub_signal before planning, trailing newlines, a true SAST day for the upload-since and daily-cap windows, filter listFirmIdsWithAcceptedRoutines on accepted (or paginate), and rename imRoutineCronKillSwitchOn to imRoutineCronEnabled.
- **PR G:** the minimal opt-in desktop agent (packaging approach to be proposed in PR F's body), using only the PR F endpoints.
- No SQL is expected. If the device token or consent needs a table or column, I'll stop and flag it to CoS first.

## Open questions for CoS
1. P2 PR E (read-only Drive/OneDrive plus the forwarding inbox, rungs 3–4) hasn't been built yet. Should it go before P3, or is P3 first OK? The plan says the desktop agent is "only if rungs 1–4 are not enough."
2. Does the desktop agent binary (PR G) need Theo's separate OK, given it's a new installable and new distribution?