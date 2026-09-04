# Ten phases — status

The original brief has 0–3. This list is the full instrument through live use.

| # | Phase | Status |
|---|---|---|
| 0 | Inventory + taxonomy | Done. Approved. |
| 1 | Event spine | Done and live. Do not re-run SQL 1–2. |
| 2 | Derived views, ladder, stall queue | Done if SQL 3–4 pasted. |
| 3 | Founder dashboard `/founder/metrics` | Needs SQL 7 (`analytics_founder_bundle`) so PostgREST does not need the analytics schema. |
| 4 | Weekly digest (plain text, bad news first) | Code on this branch. Cron GET+secret or Send digest. |
| 5 | Experiment registry (prediction required) | Code + SQL 5. |
| 6 | 24-month raw-event purge (manual RPC) | SQL 5. Do not auto-delete. |
| 7 | Flag founding / demo / extra-internal rows | **You run the UPDATE SQL.** |
| 8 | H5 payments + referrals | Wait for real paid/referral events. H5 untested. |
| 9 | Privacy-policy sentence | Question only — not shipped to the public page. |
| 10 | Live verification | Paste SQL 7 if `/founder/metrics` says Invalid schema (3–6 already applied). Snapshot, send one digest. |
