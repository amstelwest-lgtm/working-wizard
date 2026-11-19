# IM access ladder rungs 3–4 — minimal SQL (needs approval)

OAuth tokens must not live in `clients` jsonb (RLS). Service-role-only tables with RLS enabled and no policies. CoS option **(b)**: app-level AES-GCM in `*_enc` columns (`IM_CLOUD_TOKEN_KEY`).

## Tables

### `im_cloud_oauth_states`

Short-lived CSRF state (10-minute TTL), same shape as `qbo_oauth_states`.

- `state` text unique
- `client_id` uuid → `clients`
- `provider` text check in (`google`, `microsoft`)
- `return_path` text nullable

### `im_cloud_connections`

One row per client per provider (or separate rows with `unique(client_id, provider)`).

- `client_id` uuid
- `provider` text
- `folder_ids` text[] (picked roots, mirrored from UI)
- `access_token_enc` / `refresh_token_enc` text nullable — AES-GCM ciphertext (`IM_CLOUD_TOKEN_KEY`); NULL after disconnect when `revoked_at` is set
- CHECK: `revoked_at IS NOT NULL OR (access_token_enc IS NOT NULL AND refresh_token_enc IS NOT NULL)`
- `token_expiry` timestamptz
- `drive_id` text nullable (Microsoft)
- `connected_at`, `last_polled_at`, `revoked_at` timestamptz nullable

### `im_source_inbound_aliases` — skipped (CoS)

Keep the admin scan of `deliverable_inputs.imAccess` on inbound webhook; no alias table.

## RLS

`ALTER TABLE … ENABLE ROW LEVEL SECURITY` with **no** policies (service role only).

## Why jsonb is not enough

- Tokens must stay off owner-readable rows.
- Disconnect must delete/revoke tokens server-side and stop poll cron.
- Forwarding resolution at webhook scale needs an indexed `local_part` lookup.

## Migration file (prepared, not applied)

`supabase/migrations/20261119103000_im_cloud_oauth_connections.sql` — tables 1–2 only.

## After ops applies migration

1. Apply migration in Supabase (manual).
2. Set `IM_CLOUD_OAUTH_SQL_READY=1`.
3. Wire OAuth callbacks and `im-cloud-poll` to `im_cloud_connections`.
4. Redeploy edge `im-cloud-poll`.