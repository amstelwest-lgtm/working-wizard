# IM access ladder rungs 3–4 — minimal SQL (needs approval)

OAuth tokens must not live in `clients` jsonb (RLS). Follow the Xero/QBO pattern: service-role-only tables with RLS enabled and no policies.

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
- `access_token` text encrypted at rest
- `refresh_token` text encrypted at rest
- `token_expiry` timestamptz
- `drive_id` text nullable (Microsoft)
- `connected_at`, `last_polled_at`, `revoked_at` timestamptz nullable

### Optional: `im_source_inbound_aliases`

If scanning all `clients.deliverable_inputs` on each webhook is too heavy:

- `client_id` uuid primary key
- `firm_id` uuid nullable
- `local_part` text unique (derived from client id)
- `allowed_senders` text[]

## RLS

`ALTER TABLE … ENABLE ROW LEVEL SECURITY` with **no** policies (service role only).

## Why jsonb is not enough

- Tokens must stay off owner-readable rows.
- Disconnect must delete/revoke tokens server-side and stop poll cron.
- Forwarding resolution at webhook scale needs an indexed `local_part` lookup.

## After approval

1. Apply migration in Supabase.
2. Set `IM_CLOUD_OAUTH_SQL_READY=1`.
3. Wire OAuth callbacks and `im-cloud-poll` to `im_cloud_connections`.
4. Redeploy edge `im-cloud-poll`.