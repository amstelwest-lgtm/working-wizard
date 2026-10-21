# Server-side checklist for the store shells

Steps a person configures on production, in Apple Developer, in Play Console, or in Supabase. This file records them. It does not change production, DNS, Vercel, Supabase, or either store.

The shell code under `mobile/` can ship without these steps. Links, Sign in with Apple, and push stay inert until the matching step below is done. Files under `src/`, `public/` (including `/.well-known`), `supabase/`, `vercel.json`, the root `package.json`, and root `scripts/` stay in held pull requests until the web app gate is green. Deploy the association file only after that held change is merged and the Team ID placeholder is replaced in git.

App id: `com.milonfinance.app`. Hosts: `https://www.milonfinance.com` and `https://milonfinance.com`.

## 1. Supabase redirect URLs

Supabase Dashboard → Authentication → URL Configuration.

- Site URL stays `https://www.milonfinance.com`.
- Redirect allowlist includes `https://www.milonfinance.com/auth/callback` and `https://www.milonfinance.com/**`.
- Apex entries (`https://milonfinance.com/auth/callback` and the rest) can stay. A `redirect_to` missing from this list is replaced by the Site URL.
- Add no new Google redirect URI. Google continues to return through the same Supabase callback as today.

`auth.milonfinance.com` is the custom auth hostname in [docs/AUTH_CUSTOM_DOMAIN.md](../AUTH_CUSTOM_DOMAIN.md). Treat it as the Apple return host only when that hostname is Active in Supabase. Until then the return host is `https://<project-ref>.supabase.co`.

## 2. Apple App Site Association

The association file is `public/.well-known/apple-app-site-association`. It is in a held web pull request, with a `Content-Type: application/json` and `Cache-Control: public, max-age=300` header on that path in `vercel.json`. The app id in that file is the placeholder `APPLE_TEAM_ID.com.milonfinance.app` in both places:

- `applinks.details[].appIDs`
- `webcredentials.apps`

`webcredentials` is required. On iOS 17.4 and later, `ASWebAuthenticationSession` with an https callback checks that entry, not only `applinks`.

Before a human deploys the file:

1. Replace `APPLE_TEAM_ID` with the Apple Team ID for Milon, Inc. in both entries. Leave the placeholder out of production.
2. On the Apple Developer App ID `com.milonfinance.app`, enable Associated Domains. The entitlement in the iOS project lists `applinks:` and `webcredentials:` for `www.milonfinance.com` and `milonfinance.com`.

After that deploy, confirm both of these URLs return HTTP 200, `Content-Type: application/json`, and no redirect:

- `https://www.milonfinance.com/.well-known/apple-app-site-association`
- `https://milonfinance.com/.well-known/apple-app-site-association`

The repo redirect in `vercel.json` already skips `/.well-known` (`/((?!\\.well-known(?:/|$)).*)`). A domain-level redirect in the Vercel project, if one still sits in front of the deployment, has to skip `/.well-known` as well. Otherwise those URLs answer 308 and iOS will not claim the paths.

Reinstall the iOS app after the file is live. iOS caches the association at install time.

Paths the file claims: `/talk` and `/talk/*` (firm-sent agent links), `/a` and `/a/*` (future `/a/:token` links), `/try` and `/try/*`, `/auth` and `/auth/*`, `/billing` and `/billing/*`, `/join/*`, `/access/*`, `/api/qbo/callback`, `/api/xero/callback`, `/app` and `/app/*`, `/settings` and `/settings/*`.

Auth-session return paths inside the shell: Stripe returns to `/billing/success` (Stripe cancel stays a Universal Link at `/billing/cancel`), Intuit to `/api/qbo/callback`, Xero to `/api/xero/callback`, and every other return to `/auth/callback`.

## 3. Digital Asset Links

These two files stay byte-identical:

- `public/.well-known/assetlinks.json`
- `mobile/well-known/assetlinks.json`

Package name: `com.milonfinance.app`. The fingerprint already in git is the upload key:

`53:72:E4:DA:D7:C3:B3:04:82:C1:93:2B:AE:AA:2A:B0:BC:56:46:4E:6D:6E:C4:84:86:49:F0:13:62:61:53:9E`

Play-installed builds verify against the Play app-signing certificate. After Play App Signing, add that certificate’s SHA-256 as a second fingerprint in both files and keep the upload fingerprint. `scripts/assetlinks-test.mjs` currently requires exactly one fingerprint and rejects a `REPLACE_WITH` placeholder. The change that adds the Play fingerprint updates that test in the same commit, then a human deploys `public/.well-known/assetlinks.json`.

Confirm both hosts return HTTP 200, `Content-Type: application/json`, and no redirect for `/.well-known/assetlinks.json`. The same apex-redirect rule as the Apple file applies. `vercel.json` already sets `Content-Type` for `assetlinks.json`.

The upload keystore stays on the signing machine. It is not in git.

## 4. Sign in with Apple

The web button is held with the rest of `src/`. Configure the provider before that pull request merges. Until the provider is on, the button returns “Apple sign-in is not enabled yet.”

This is Supabase web OAuth (`signInWithOAuth`, provider `apple`, scopes `name email`), through `/auth/callback`. It is the same hop as Google, so invites and firm creation still run. It is not the native Apple ID sheet.

1. In the Apple Developer account for Milon, Inc., create a Services ID for Sign in with Apple. Domain: `milonfinance.com`. Return URL: `https://<project-ref>.supabase.co/auth/v1/callback`, or `https://auth.milonfinance.com/auth/v1/callback` when the custom auth domain is Active.
2. Create a Sign in with Apple key. Keep the `.p8` on that machine. Note the Key ID and the Team ID. Commit neither the key nor those ids.
3. Supabase Dashboard → Authentication → Providers → Apple: turn the provider on and enter the Services ID, Team ID, Key ID, and the key contents there.
4. The redirect allowlist in section 1 already covers `https://www.milonfinance.com/auth/callback`. Add no new Google redirect URI.

The shell opens `appleid.apple.com` and `idmsa.apple.com` outside the WebView. The PKCE verifier stays in the WebView. That host list ships in `mobile/` and needs no production edit.

## 5. Push credentials

Push registration stays off until credentials exist. No credential is in git. The device token is not read and not sent.

1. Create a Firebase project for `com.milonfinance.app`. Download `google-services.json` onto the signing machine only. `npx cap sync android` on that machine is what turns Android registration on. A build without that file still launches: the Firebase init provider is removed, and `MilonApplication` initializes Firebase only when the `google_app_id` resource exists.
2. Create an APNs key in the Apple Developer account for Milon, Inc. Enable Push Notifications on the App ID `com.milonfinance.app`. In Xcode, add the Push capability so the profile receives `aps-environment`. Then set `MilonPushConfigured` to true in `mobile/ios/App/App/Info.plist`. It ships as false, and the push entitlement is absent, so an archive does not need the Push capability yet.
3. Choose where device tokens are stored. The shell does not post the token to Milōn. Until that store exists, a build can register with Apple or Firebase and still has nowhere to receive a message from.
4. Notification copy must not include client names or figures. A tap payload is a Milōn path such as `/app` or `/talk/advisor`, or a full `https://www.milonfinance.com/...` URL. Anything else is ignored.

## 6. Store consoles

These are console declarations, not a server deploy.

- App Store privacy nutrition: photos (a receipt, invoice, or statement the person attaches), linked to the user, for app functionality, not tracking. Leave payment info unticked. Biometrics stay on the device and are not collected data.
- Play Console data safety: camera access, and that a receipt photo is uploaded as the person chooses. Leave photo-library access undeclared. The shell does not request `READ_MEDIA_IMAGES` or `READ_EXTERNAL_STORAGE`.
- Privacy policy: `https://www.milonfinance.com/privacy`.
- Support URL in the listing drafts: `https://www.milonfinance.com/faq` until another public page is named.
- Account deletion is signed-in Settings (the person types DELETE). There is no public deletion URL.
- App Review and screenshots use a demo account with seeded books. Never a real client.
- Say whether production web builds set a Sentry DSN (yes or no). Leave the value out of git. The privacy manifest does not declare crash data.
- Apple Developer organisation enrolment for Milon, Inc., with D-U-N-S, plus a distribution certificate, before any TestFlight build. Play Console organisation enrolment with D-U-N-S before a production release. A signed iOS archive needs a Mac and Xcode. This repo’s iOS job only checks project structure.

The first binary’s listing stays inside what that binary does. Push, Face ID, and the native camera are claimed only on a build that actually ships them.

## 7. Order

1. Confirm the Supabase redirect allowlist in section 1. That needs no deploy.
2. Finish Apple and Play organisation enrolment if it is still open.
3. When the held association-file change merges, substitute the Team ID, deploy, verify both hosts, enable Associated Domains, and reinstall the iOS app.
4. After Play App Signing, add the second fingerprint in both asset-links files, update `scripts/assetlinks-test.mjs` in that same change, and deploy the public file.
5. Configure the Apple provider in section 4 before the held Sign in with Apple web change merges.
6. Add push credentials only when a token store exists, and only claim push on a listing for a build that registers.

Camera and Face ID checks are on a device. They need no production config beyond the console declarations in section 6.
