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
| `SAGE_SA_API_KEY` | API key issued by Sage South Africa for this app. Required for connect and for the password cipher when the dedicated key is unset. |
| `SAGE_SA_PASSWORD_KEY` | Optional. When set, this is the only key for `password_enc`. When unset, the cipher uses `SAGE_SA_API_KEY`. |

`password_enc` is `enc:v1:` plus AES-256-GCM (12-byte iv, 16-byte tag, ciphertext, base64url). Connect writes it with `encryptSagePassword` in `src/lib/sage-password.ts`. Sync decrypts with the same module. The key is SHA-256 of `SAGE_SA_PASSWORD_KEY` if that is set, otherwise SHA-256 of `SAGE_SA_API_KEY`. Rotating the cipher key means each Sage company must be connected again.

If `SAGE_SA_API_KEY` is missing, the connect card says Sage is not switched on
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
3. Optional: set `SAGE_SA_PASSWORD_KEY` on the same project if the password
   cipher should not be the API key. Leave it unset to use `SAGE_SA_API_KEY`.
4. Apply the migration above on the Milon Supabase project.
5. Redeploy working-wizard2.

No redirect URI to register. No Sage OAuth app. No client id or client secret.

A user then opens Connect Sage, enters the Sage login email, password, and
Company ID, and Milōn stores the connection after Sage accepts
`Company/Get`. Sync stays empty until Eng1 maps the statements.
