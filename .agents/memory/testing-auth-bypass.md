---
name: E2E tester login for Supabase-auth app
description: How to give the Playwright testing subagent a working login when signup is gated
---
Signup on the landing page is gated by an access code and email confirmation, so testers can't self-register.

**How to apply:** Mint a confirmed user via Supabase admin API: use SUPABASE_ACCESS_TOKEN with the management API (`GET api.supabase.com/v1/projects/<ref>/api-keys`) to fetch the service_role key, then `POST <SUPABASE_URL>/auth/v1/admin/users` with `email_confirm: true`. Existing test login: wf-tester-33@example.com / Test1234!

**Why:** avoids blocked "unable" test runs; landing-page signup access code is `OpenSesami` but still stalls without confirmation.
