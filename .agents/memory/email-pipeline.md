---
name: Email pipeline
description: How transactional email is sent (Resend, queue, env vars)
---

Transactional email flows: client `sendTransactionalEmail` → `/lovable/email/transactional/send` (renders React Email template, suppression check, enqueues via Supabase pgmq) → `/lovable/email/queue/process` which now sends through the **Resend API** (previously the Lovable gateway, which was never configured).

**Env:** `RESEND_API_KEY` (secret) + `RESEND_FROM_EMAIL` (shared env var). The processor overrides the queued `from` address with `RESEND_FROM_EMAIL` but keeps the display name.

**Why:** user declined the Lovable key and Resend connector, later supplied a Resend API key directly (Aug 2026). Verified working with a live send.

**How to apply:** any new email feature should go through `sendTransactionalEmail` + a template in the registry; don't call Resend directly from other routes. If sends fail with 403, the from address's domain probably isn't verified in Resend. The action-plan UI has a copy-link fallback when email fails — keep it.
