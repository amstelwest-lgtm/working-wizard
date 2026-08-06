---
name: Impersonation-scope check must tolerate multiple open audit rows
description: Why the firm-user impersonation guard threw false 403s, and the fix pattern for "at most one active X" checks backed by a non-unique constraint.
---
The central impersonation-scope middleware validated an accountant/firm-admin's
"acting as client" session by querying `impersonation_audit` for a row matching
`(firm_user_id, client_id, ended_at IS NULL)` via `.maybeSingle()`. `.maybeSingle()`
throws/errors when more than one row matches — and more than one still-open
(`ended_at IS NULL`) row easily accumulates for the same pair, since sessions are only
closed via an explicit "exit impersonation" action (closing the tab, navigating away, or
re-entering the same client without exiting first all leave the previous row open).

**Why it matters:** once a second open row exists, every server function gated by that
middleware starts rejecting an otherwise-valid, currently-active impersonation session
with a 403 ("Invalid or expired impersonation scope") — a silent, hard-to-diagnose
production breakage that looks like an auth bug in whatever feature you're testing, not in
the shared middleware. It reproduces reliably after a firm user has entered the same
client's view more than once.

**How to apply:** any "check at least one row matches" existence query should use
`.select(...).eq(...).limit(1)` and check `data.length > 0`, not `.maybeSingle()`, unless a
DB constraint truly guarantees at most one matching row. Prefer ordering by recency
(`order(...).limit(1)`) so the check is also correct if duplicates exist. This applies to
any other "is there an active session/lock/lease for X" check in this codebase, not just
impersonation.
