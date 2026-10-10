# Sage Business Cloud Accounting (South Africa)

Sage One / Sage Business Cloud Accounting **South Africa** only. This is not
the UK, US, or EU Sage Accounting OAuth API, and it is not an OAuth redirect.

Connect stores an email, an encrypted password, and a Company ID on the
client. Sync is a stub: it does not pull a P&L or balance sheet and it does
not change Health or ratios. Eng1 owns that populate path.

## How login works

| Piece | Value |
| --- | --- |
| Product | Sage Business Cloud Accounting SA (Sage One) |
| API | `https://accounting.sageone.co.za/api/2.0.0` |
| Auth | `Authorization: Basic` of the user's email and password |
| App key | `SAGE_SA_API_KEY`, sent as the `apikey` query parameter |

Sage SA API 2.0.0 reads the application key on the query string (`apikey`),
together with `companyid`. It does not use an OAuth authorization code, a
redirect URI, or a bearer token.

Validate calls `GET /Company/Get/{companyId}` only. That confirms the login
and the company. It does not request a profit and loss or a balance sheet.

## Env

Set these on the Vercel project **working-wizard2**, Production and Preview.
Do not prefix `VITE_`. Do not commit the values. Redeploy after saving.

| Name | Value |
| --- | --- |
| `SAGE_SA_API_KEY` | API key issued by Sage South Africa for this app. Required for connect. Sandbox and live keys differ. |
| `SAGE_SA_PASSWORD_KEY` | Required for connect. The only key used to write `password_enc` (e.g. `openssl rand -base64 32`). Independent of the API key, so a sandbox → live key swap keeps stored connections working. |
| `SAGE_SA_BASE_URL` | Optional. API host. Unset means live `https://accounting.sageone.co.za/api/2.0.0`. Preview uses the sandbox `https://resellers.accounting.sageone.co.za/api/2.0.0`. Only https `*.sageone.co.za` URLs are accepted; anything else falls back to live. |

`password_enc` is `enc:v1:` plus AES-256-GCM (12-byte iv, 16-byte tag, ciphertext, base64url). Connect writes it with `encryptSagePassword` in `src/lib/sage-password.ts`. Sync decrypts with the same module. The key is SHA-256 of `SAGE_SA_PASSWORD_KEY`. Legacy rows written with SHA-256 of `SAGE_SA_API_KEY` (before the dedicated key) still decrypt, and sync re-encrypts them with `SAGE_SA_PASSWORD_KEY` after the next successful Sage call. Rotating `SAGE_SA_PASSWORD_KEY` itself means each Sage company must be connected again.

If `SAGE_SA_API_KEY` or `SAGE_SA_PASSWORD_KEY` is missing, the connect card says Sage is not switched on
and does not call Sage.

## Database

Apply `supabase/migrations/20261007170000_sage_sa_connections.sql` on Supabase
project `jxclnsbsqpixxqlbcapl` (Milon real) before the first connect.

Tables: `sage_connections`, `sage_sync_data`. Row level security is on and
there are no policies (service role only). There is no `sage_oauth_states`
table.

## What Theo does

1. In the Sage South Africa developer programme
   ([accounting.sageone.co.za](https://accounting.sageone.co.za/Marketing/DeveloperProgram.aspx)),
   request an API key for Milōn. Support is `api@accounting.sageone.co.za`.
   Sage quotes about two days.
2. When the key arrives, paste it into Vercel → working-wizard2 → Settings →
   Environment Variables as `SAGE_SA_API_KEY` (Production and Preview).
   Do not put it in git.
3. Set `SAGE_SA_PASSWORD_KEY` on the same project (a random 32-byte base64
   value). For sandbox testing on Preview also set `SAGE_SA_BASE_URL` to the
   reseller host.
4. Apply the migration above on the Milon Supabase project.
5. Redeploy working-wizard2.

No redirect URI to register. No Sage OAuth app. No client id or client secret.

A user then opens Connect Sage, enters the Sage login email, password, and
Company ID, and Milōn stores the connection after Sage accepts
`Company/Get`. Sync stays empty until Eng1 maps the statements.
