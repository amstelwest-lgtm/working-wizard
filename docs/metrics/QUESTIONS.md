# Questions for Theo (do not block the instrument)

Defaults already shipped are in brackets. Answer these when you have a minute — the SQL below still runs without the answers.

1. **Founding Practice firm IDs** — which `firms.id` rows are the personal / first-wave cohort that must stay out of headline PMF? `[none flagged; founder-owned firms are already is_internal]`
2. **Demo / sandbox client IDs** — which `clients.id` rows should be `is_demo = true`? `[none flagged; do not guess from the name “Demo”]`
3. **Extra internal firms** — any test practices not owned by `amstel.west@gmail.com`? `[founder-owned auto-flagged]`
4. **Extra digest recipients** — anyone besides `MILON_OWNER_EMAILS` / `analytics.founder_emails`? `[amstel.west@gmail.com]`
5. **Cron secret** — confirm `CRON_SECRET` or `MILON_DIGEST_SECRET` is set on Vercel so Monday 06:00 UTC can send. Without it, use **Send digest** on `/founder/metrics`.
6. **Owner-only SMEs** — keep them out of this practice-channel instrument? `[yes]`
7. **H5 (price)** — wait until unaffiliated `payment.recorded` exists before showing a conversion number? `[yes — H5 stays untested]`
8. **Referrals** — when should `referred_another_practice` become measurable? `[unmeasurable until a real referral event exists]`
9. **H3** — leave extraction correction blocked until we can tell AI-fill from a blank form? `[yes]`
10. **Privacy policy** — OK to add one sentence that we store product-event keys (not financial amounts, not employee emails) for 24 months? `[not written into the public page until you say so]`
11. **Purge** — run `analytics_purge_old_events(24)` later by hand, never on a schedule, until you have read the count? `[yes]`
12. **Practice access SQL** — has `20260901160000_practice_client_access.sql` already been pasted live?
