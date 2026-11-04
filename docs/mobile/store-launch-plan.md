# Milōn store launch plan

Investigation only. This document does not change the app, the billing gates, or any store listing that is already checked in. Nothing here is a submission, a deploy, or a message to Apple, Google, or a customer.

The public product is https://www.milonfinance.com. The seller on both stores is the legal entity already on the privacy notice: **Milon, Inc.** (`LEGAL_ENTITY` in `src/lib/legal.ts`). The product name stays Milōn. Gold is reserved for the MILŌN wordmark.

Guidelines cited below were read from Apple’s [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) on 21 October 2026. Confirm the live page again the week a binary is uploaded. Apple revises 3.1.1 storefront rules without a product release.

## Fastest honest route

Ship one Capacitor shell, package `mobile/`, app id `com.milonfinance.app`, that loads the live site. Android already is that shell. iOS is the same package with an iOS target added. Play internal testing can start once a human has a Play organisation account, an upload key, and a verified Digital Asset Links file. App Store review waits until the native features in the 4.2 section exist and Chief of Staff has decided how the paywall behaves inside the shell.

A Trusted Web Activity is the wrong second Android app. Chrome’s TWA install checks need a service worker that controls the manifest `start_url`. This repo has a web manifest and no service worker. Adding one would put a cache in front of live books. The Capacitor shell already opens Google, Stripe, Xero, QuickBooks, and Sage hosts in Custom Tabs and claims `https://www.milonfinance.com` plus the apex host as App Links. Replacing that with Bubblewrap would throw the working return path away.

Expo and React Native are a rewrite. The UI is TanStack Start. There is no React Native app. A transitive `react-native-b4a` entry in `mobile/package-lock.json` is not a mobile codebase.

## 1. How the app is built today

| Piece | What is in the repo |
| --- | --- |
| UI | React 19, TanStack Router file routes under `src/routes/`, TanStack Start server functions. |
| Bundler | Vite 7 (`vite.config.ts` via `@lovable.dev/vite-tanstack-config`). Production build is `pnpm run build:vercel` (`DEPLOY_TARGET=vercel`). `pnpm run deploy` is a Cloudflare Worker path. The live host the shell loads is www. |
| Auth | Supabase (`@supabase/supabase-js` 2.74.0) in `src/integrations/supabase/client.ts`. Email and password, magic link (`src/lib/email-sign-in.ts`), and Google (`signInWithOAuth` in `src/lib/google-auth.ts`). PKCE verifier is written to WebView `localStorage`, then the browser is sent to `{SUPABASE_URL}/auth/v1/authorize`. Callback on the site is `/auth/callback`. |
| Auth host | Runbook in `docs/AUTH_CUSTOM_DOMAIN.md` for `auth.milonfinance.com`. The Android shell already treats both `*.supabase.co/auth/` and `auth.milonfinance.com/auth/v1/` as Custom Tab hops. The repo does not record whether that custom domain is Active. |
| Data | Supabase Postgres with row-level security, plus Storage for uploads. Stripe is the billing system (`stripe` 22.x, `@stripe/stripe-js`). Firm bands are the paid catalog (`src/lib/stripe-plans.ts`: the paying customer is the accounting firm). Owner checkout also exists (`startOwnerCheckout` in `src/lib/stripe-checkout.functions.ts`, lookup keys in `src/lib/owner-price.ts`). |
| PWA | `public/manifest.json` is `standalone`, `start_url` `/`, theme `#0A0A0A`, icons under `public/icons/`. No service worker, no Workbox, no `navigator.serviceWorker` registration. |
| Android | Capacitor 8.5.3 remote-URL shell. `mobile/` is its own npm package, outside the pnpm workspace. `server.url` is `https://www.milonfinance.com`. `www/` is the offline page only. Package id `com.milonfinance.app`. `minSdk` 24, `compileSdk` / `targetSdk` 36, Java 21. CI: `.github/workflows/android.yml` builds a debug APK when `mobile/**` changes. It does not sign a release AAB. |
| iOS | No `ios/` project, no `apple-app-site-association`, no `PrivacyInfo.xcprivacy`, no Sign in with Apple. |
| Push | Not wired. `mobile/www/shell.js` leaves the Capacitor push block commented. No `google-services.json` (gitignored if someone adds one). |
| Store copy already drafted | `mobile/store/play-listing.md`, `data-safety.md`, `content-rating.md`, `theo-checklist.md`. Those drafts are for the Android shell. They are not an App Store listing, and they are not yet in The MILŌN Team voice. |

The Android shell’s splash, status bar, and offline page use ink `#0a0a0a` (`mobile/capacitor.config.ts`, `mobile/scripts/generate-brand-assets.py`). Brand System v1.1 is a white field, cobalt `#0B5FFF`, deep navy `#102A43` text, and gold only on the MILŌN wordmark. The next shell PR restyles the shell. It does not restyle the product.

## 2. Wrapping approach

**One Capacitor app for both stores.** Android stays a remote-URL shell so a web deploy reaches installed copies without a store binary. iOS uses the same `server.url`, the same offline page, and the same rule for which hosts leave the WebView.

Reasons:

- The OAuth and Stripe return path is already designed for a WebView that keeps the PKCE verifier and a system browser that shows Google. `MilonExternalUrls` sends `accounts.google.com`, Supabase `/auth/`, Stripe Checkout, Intuit, Xero, YouTube, and the Sage hosts out to Custom Tabs. App Links on `milonfinance.com` and `www.milonfinance.com` are how the code comes back. iOS needs the same split: WKWebView for the site, `SFSafariViewController` or `ASWebAuthenticationSession` for those hosts, Universal Links back into the same WebView.
- Google rejects Google sign-in inside an embedded WebView (`disallowed_useragent`). A TWA does not remove that rule.
- Play internal testing is unblocked by a new architecture. It is blocked by an organisation account, an upload key, and Asset Links verification. See the checklist.
- iOS review is blocked by guideline 4.2 and by payments, below. A faster wrapper submission would spend a review cycle to learn that.

`allowNavigation` is only `milonfinance.com` and `*.milonfinance.com`. Keep it that narrow on iOS.

### Apple guideline 4.2

Guideline 4.2 says the app should include features, content, and UI that elevate it beyond a repackaged website. If it is not useful, unique, or app-like, it does not belong on the App Store. 4.2.2 adds that, other than catalogs, apps should not primarily be marketing materials, advertisements, web clippings, content aggregators, or a collection of links. 4.2.7(e) says thin clients for cloud-based apps are not appropriate. A reviewer can place a remote-URL Capacitor shell in that bucket. Splash screens, a dark status bar, and a hardware back button do not move it out. The Android shell already has those.

**Risk if we submit today’s shell, plus an iOS target that only loads the URL: high.** The binary would request no permission except network. The same screens are one Safari bookmark away. `/` and `/talk/:agent` are marketing and sample conversations. That is the rejection 4.2 is written for.

**Risk after the native set below ships, with a signed-in workspace on the review account: medium.** Web-rendered UI is allowed. The review notes have to show device capabilities Safari does not provide as an installed finance workspace. Appeal text will not carry a binary that is still only a WebView.

Native features to add so a reviewer can see them. Each one is a product need, and each one is absent today.

1. **Push, with a tap that opens a Milōn URL.** APNs on iOS, FCM on Android, through `@capacitor/push-notifications`. Send for something the workspace already does: a sign-off asked of the owner, a hand-off ready for the accountant, a firm-sent link. Guideline 4.5.4: push is not required to use the app, and it is not a marketing list unless the person opted in inside the app and can opt out there. Do not put figures or client names in the notification body.
2. **Camera and document picker for source documents.** The site already has this job. `src/components/source-documents-panel.tsx` offers “Upload a document” (`SOURCE_DOC_ACCEPT`: PDF, JPEG, PNG, WebP, HEIC, HEIF) and “Take a photo” (`accept="image/*"` and `capture="environment"`). PDF statement zones are `application/pdf` only. The Android manifest requests `INTERNET` only. There is a FileProvider and no `CAMERA` permission. iOS has no `NSCameraUsageDescription` or photo-library string. `capture` on a WKWebView fails closed without those strings. Add the Capacitor Camera plugin (and a document picker for PDFs), usage strings that say the photo is a receipt, invoice, bill, or statement the person chose to attach, and a shell bridge the page can call. The HTML inputs can stay for the browser.
3. **Universal Links and App Links for the links the firm actually sends.** Android already claims both hosts with `autoVerify`. iOS needs `applinks:www.milonfinance.com` and `applinks:milonfinance.com`, plus `public/.well-known/apple-app-site-association` served as `application/json` with HTTP 200 on both hosts. Paths that must open the app: `/talk/*`, `/try`, `/auth/*`, `/billing/*`, `/join/*`, `/access/*`, `/api/qbo/callback`, `/api/xero/callback`, `/app`, `/settings`. `/talk/$agent` is the public one-agent route (`financial-manager`, `analyst`, `advisor`, and on the ZA copy pack the tax specialist). It needs no account. The warm-demo email still points its call to action at `https://www.milonfinance.com/try` (`emails/try-outreach.tsx`), so `/try` stays on the list until that mail uses `/talk/:agent`.
4. **Biometric lock on the installed app.** Face ID or fingerprint before the workspace is shown, on-device only. A finance app that holds books is the case reviewers understand. The site’s own session cookie stays the login. The biometric gate is local and does not become a second account system. Do not upload biometric data.
5. **An honest offline page, on both platforms.** Android already shows `mobile/www/index.html` after a main-frame failure or a 20-second hang, and after a second renderer crash within 30 seconds. Copy that to iOS. The page offers a retry. It does not show cached books or invented figures.

Also required by 4.8, because the auth screen offers “Continue with Google” (`src/routes/auth.tsx`) as a way to create the primary account. 4.8 requires an equivalent login that collects only name and email, lets the person hide their email, and does not use app interactions for advertising. Email and password do not let someone hide their email, so they do not meet that test. **Sign in with Apple** is the equivalent. Ship it before the first iOS binary goes to review. The button is a web change (Supabase Apple provider plus the auth screen). The shell opens Apple’s host outside the WebView the same way it opens Google.

4.2.3(ii): on first launch the shell downloads the site. Say that in the App Review notes, and say the binary itself contains the offline page. Do not describe the app as a remote desktop. 4.2.7 is about mirroring someone else’s machine.

What we will tell the reviewer, in the notes, with the demo account:

- Push: a test notification that opens `/app` or a `/talk/:agent` link.
- Camera: photograph a sample receipt on the source-document screen. The sample is seeded data.
- Face ID: lock and unlock.
- Universal Link: open `https://www.milonfinance.com/talk/financial-manager` from Mail and land in the app.

Screenshots for that submission use the signed-in workspace, vertical navigation, silent avatars, and no WhatsApp control in any accountant screen. The home page alone is a weak 4.2 exhibit.

### Payments: 3.1.1, reader apps, and the firm subscription

3.1.1: if the app unlocks features or functionality, including a subscription, it uses In-App Purchase. A Stripe Checkout button inside the app is the app’s own mechanism.

Who pays today:

- Accounting firms pay Stripe on client-count bands (Starter through Scale; Enterprise is a quote). Checkout success returns to `/billing/success`. The billing wall is `/billing/required` and the in-app gate in `src/components/firm-billing-gate-view.tsx`. Settings has “Manage billing”, which sends the browser to the Stripe Customer Portal.
- Business owners have an owner checkout (`milon_owner_monthly` / `milon_owner_annual`, and the ZA pair). The owner door calls `startOwnerCheckout`. A firm plan can cover the owner (`covered_by_firm` in `src/lib/owner-billing.ts`). Comment in `src/lib/stripe-plans.ts` still says Owner Spark stays free; the owner checkout path is live code beside that comment. Treat owner checkout as a real purchase surface until Chief of Staff says otherwise.

How the exemptions apply:

| Rule | Applies to Milōn? |
| --- | --- |
| 3.1.3(a) Reader apps | No. Reader content is magazines, newspapers, books, audio, music, and video. The External Link Account Entitlement requires that same primary content. Milōn is a finance workspace. Do not file a reader-app entitlement. |
| 3.1.3(b) Multiplatform | Only if the same subscription is also an In-App Purchase. The rule allows access to something bought on the web when that item is also sold with IAP. It is not a way to keep Stripe as the only checkout and still show a buy button. |
| 3.1.3(c) Enterprise services | This is the firm case, and only the firm case. The firm is an organisation buying access for its people and the clients linked to that firm. The guideline’s examples are professional databases and classroom tools. Consumer, single-user, or family sales must use IAP. A business owner buying Milōn Owner for their own company is that single-user sale. |
| 3.1.3(e) Goods outside the app | No. The subscription is access to software. It is not a physical good or a service consumed outside the app. |
| 3.1.3(f) Free stand-alone companion | No. The list is VoIP, cloud storage, email, and web hosting, and the app still may not contain a purchase call to action. |
| 3.1.1(a) United States storefront | On the US storefront, buttons and links to other purchase methods do not need the External Purchase Link entitlement. On every other storefront, those buttons and links are not allowed unless an entitlement for that storefront says so. South Africa is not the US storefront. A shell that shows Stripe Checkout to a ZA firm fails 3.1.1 outside the US even if the US build would be allowed to link out. |

Google Play’s payments policy has the same shape. Digital subscriptions inside the app use Google Play Billing, unless the app only lets someone in who already paid elsewhere and the app does not sell. Play’s user-choice billing and the EEA alternative-billing programmes are extra integrations with fees and regional limits. They are not the fast path.

**Honest fastest payments posture:** both store apps are clients for an account that already has a plan. The binary does not start Stripe Checkout, does not open the Customer Portal, and does not show a price. Firms and owners subscribe on the website, in a normal browser. Mail about plans stays outside the app, which 3.1.3 explicitly allows. The review account is already entitled, so the reviewer sees the workspace.

That posture needs the purchase surfaces hidden when the shell flag is set (`window.__MILON_ANDROID_SHELL__` today; an iOS equivalent later). Those surfaces live in the billing-gate files. **This plan does not propose an edit.** Chief of Staff approval is required before any PR touches them. The file list is in the PR sequence.

Until that approval, do not upload an iOS build for review. A reviewer can open Settings → Manage billing, `/billing/start`, `/billing/required`, or the owner door and land on Stripe. The Android Custom Tab makes that obvious. Play’s production review can ask the same question. Internal Play testing of the existing shell is still useful for OAuth and uploads. It is not a production submission.

Building a second catalog in StoreKit and Play Billing, kept in sync with Stripe firm bands and owner prices, is a real product and a second source of truth. It is slower and it is not required if the apps stay consumption-only.

## 3. Blockers

### Auth redirects and OAuth

Google sign-in inside the WebView is rejected by Google. The Android shell intercepts it. iOS must do the same before anyone tests Google on a device.

The return only reaches the app when the OS has verified the link:

- Android: `public/.well-known/assetlinks.json` and the copy in `mobile/well-known/assetlinks.json` contain one SHA-256, the upload key `53:72:E4:DA:D7:C3:B3:04:82:C1:93:2B:AE:AA:2A:B0:BC:56:46:4E:6D:6E:C4:84:86:49:F0:13:62:61:53:9E`. A Play-installed build is signed by Play’s app signing certificate. That second fingerprint has to be added to both files after the first AAB enrols in Play App Signing. Until `adb shell pm get-app-links com.milonfinance.app` shows verified, the Custom Tab keeps `/auth/callback` and the WebView never sees the code.
- The apex host has been redirecting to www before the deployment runs (`mobile/store/theo-checklist.md`). Asset Links and, later, `apple-app-site-association` need HTTP 200 on `https://milonfinance.com/.well-known/...` and on www, `Content-Type: application/json`, with no redirect. That domain setting is a human change. This plan does not deploy it.
- Supabase Authentication → URL Configuration must allow `https://www.milonfinance.com/auth/callback` and `https://www.milonfinance.com/**`, and keep the apex entries. No custom URL scheme. Google Cloud’s authorized redirect stays the Supabase callback (`*.supabase.co/auth/v1/callback` and, after the custom-domain cutover, `https://auth.milonfinance.com/auth/v1/callback`). The shell does not add a Google redirect URI.
- Xero returns to `/api/xero/callback`. QuickBooks returns to `/api/qbo/callback`. Both are on the Milōn host, so App Links / Universal Links must claim them. Sage is an API key, not an OAuth redirect (`src/lib/sage.ts`). The shell still opens Sage login hosts in the system browser if the page navigates there.
- Invite and checkout hops ride on the callback query (`invite`, `cc`, `join`, `next`, `checkout`). The shell must load the full URL, not only the path. Android’s `appUrlOpen` handler does that.
- iOS cookie isolation: the PKCE verifier has to be created in the WKWebView. Opening the authorize URL in `ASWebAuthenticationSession` from the start leaves the verifier behind. Mirror the Android order: let the site start the request, intercept the foreign host, return via Universal Link into the same WebView.
- Sign in with Apple is a 4.8 blocker for the App Store, covered above. It needs an Apple Services ID and a key in the Supabase Apple provider. Those are credentials.

### Deep links, including `/talk/:agent`

Host-wide claim is already the Android intent filter. A firm-sent `https://www.milonfinance.com/talk/financial-manager` (or `analyst`, `advisor`) opens the app once Asset Links verify. The page is anonymous and server-rendered. There is a known hydration gap on first send (`docs/rootcause/talk-first-message.md`): a tap before React hydrates can submit the form as a GET and drop the text. That bug is on the website, so the app inherits it. Fix it in a web PR if the store demo leads with Talk. It is not a shell bug.

`/join/:token` and `/access/:token` are signed-in hand-offs. They need the same host claim. A path-specific AASA is safer than claiming the entire host if marketing ever wants those URLs to stay in Safari. For the first version, claim the paths listed in the 4.2 section, including `/talk/*`.

### Push

No token registration, no API to store a device token, no APNs key, no FCM project in the repo. The commented block in `mobile/www/shell.js` is the intent. Shipping it is a later PR, and it depends on credentials Theo generates and does not commit (`google-services.json` is gitignored).

### File uploads and camera

Web file inputs should reach Android’s picker through Capacitor’s WebChrome client. `MilonWebViewClient` replaces the WebView client and does not replace the Chrome client, so the chooser is still Capacitor’s. That path is untested on a Play-signed build. “Take a photo” is the fragile one: no camera permission, and iOS has no usage strings. HEIC from the iOS camera is already in `SOURCE_DOC_ACCEPT`. The shell PR that adds the camera plugin also adds the Play photo-and-video declaration and the App Store purpose strings. Data-safety and the privacy nutrition label then say the photo is the document the person attached.

### Payments and paywall visibility

Covered in section 2. The shell cannot ship to production review while Checkout is one tap away, unless Chief of Staff accepts store billing. Hiding the wall is a billing-gate change and waits for approval.

### Privacy manifest, data safety, account deletion

**iOS privacy manifest.** A `PrivacyInfo.xcprivacy` ships with the iOS target. Capacitor touches UserDefaults; declare the required-reason API categories the binary actually uses (UserDefaults reason `CA92.1` at minimum; add file-timestamp or disk-space reasons only if the linked Capacitor pods use them). `ITSAppUsesNonExemptEncryption` is false when the app only uses HTTPS. App Privacy nutrition label, in App Store Connect, matches the data-safety draft:

- Name, email, user id: account.
- Financial info: figures from QuickBooks, Xero, or Sage, and files the account uploads. The product does not take a bank login.
- Product interaction: events such as “report sent”, not the amounts.
- Diagnostics: the shell has no native crash SDK. The website reports to Sentry only when `VITE_SENTRY_DSN` is set at build (`src/lib/monitoring.ts`). Theo confirms whether production builds set it. If they do, tick diagnostics on both forms. If they do not, leave diagnostics off. Do not paste the DSN into the listing or this doc.
- Photos: collected only after the camera feature exists, and only as an upload the person initiated.
- Precise location, contacts, SMS, microphone, advertising: not collected. Do not tick them.

`mobile/store/data-safety.md` currently says to leave crash data off until a crash reporter exists. The shell PR’s listing pass corrects that sentence so it matches the Sentry condition above.

**Account deletion.** Guideline 5.1.1(v): if the app supports account creation, it offers account deletion inside the app. The product does. Settings → danger zone → type DELETE (`src/routes/_authenticated/settings.index.tsx`) calls `deleteOwnAccount` (`src/lib/account.functions.ts`), which uses the `delete_own_account` RPC and falls back to a service-role delete. The public URL is https://www.milonfinance.com/settings and it requires a session. The privacy notice states the same path: https://www.milonfinance.com/privacy. There is no signed-out deletion form. The review login must not be the account the reviewer deletes. Give review a second, disposable login for the deletion test, or tell the reviewer the steps and accept that the demo user is gone after the test. Seeded books on the surviving demo account are sample data, never a real client.

Play’s Data safety “deletion” answer points at that Settings path. Play also asks for a privacy-policy URL on the listing. Use https://www.milonfinance.com/privacy on both stores.

## 4. Store assets, metadata, and what Theo must supply

Brand for every asset: white field, cobalt `#0B5FFF` as the primary, deep navy `#102A43` for text, gold only inside the MILŌN wordmark. Avatars stay silent. Navigation in screenshots is the vertical nav. Accountant screenshots and accountant sentences do not mention WhatsApp.

### Assets

| Asset | Spec | Repo today |
| --- | --- | --- |
| App icon | Apple: 1024×1024 PNG, no transparency, no pre-rounded corners. Play: 512×512 32-bit PNG. Adaptive icon already generated for Android. | `public/icons/` and `mobile/assets/`. Regenerated in the shell PR onto the v1.1 field. Current generator paints `#0a0a0a`. |
| Splash | Capacitor splash, white, wordmark in gold, mark in cobalt or navy. | `mobile/assets/splash.png` is the dark shell. |
| Phone screenshots | At least three, real product, signed-in workspace. Play: 2–8 phone shots, PNG or JPEG, each side between 320 and 3840 px, 9:16. App Store: the display sizes App Store Connect lists on upload day. As of this writing that set includes the 6.9-inch iPhone (1320×2868). Confirm in the form. Do not invent a size. | None checked in as store shots. |
| Tablets | Ship the shell as phone-only (Android `supports-screens` / iOS `TARGETED_DEVICE_FAMILY` iPhone) so 7-inch, 10-inch, and 13-inch iPad shots are not required. The web layout is built around a vertical nav on a phone. | Android is currently free to run on tablets. The shell PR sets phone-only. |
| Play feature graphic | 1024×500. Wordmark on white. | Missing. |
| Short / full description | Honest. The team reads the books. A person signs off. Milōn does not connect to the bank, does not file a tax return, and does not promise a filing date. Figures are as current as the last sync or upload. Books stay in QuickBooks or Xero. Sage is the connect path the product already has; do not say Sage is absent if the screen still offers it, and do not say it is generally available if the listing page still says coming soon. Match the screen. | `mobile/store/play-listing.md` is a draft in a different voice. The shell PR rewrites it and adds an App Store draft. |
| Privacy policy URL | https://www.milonfinance.com/privacy | Live route `src/routes/privacy.tsx`. |
| Support URL | A public `https` URL App Store Connect and Play will accept. | No `/support` route. `/faq` exists. `team@milonfinance.com` is the privacy inbox (`LEGAL_PRIVACY_EMAIL`). Theo names the URL. A page can be a later web PR if `/faq` is not acceptable. This plan does not add one. |
| Account deletion URL | https://www.milonfinance.com/settings | Signed-in. Described on `/privacy`. |
| Category | Finance. Content rating: the answers in `mobile/store/content-rating.md` (Everyone / IARC 3+ band, no public UGC, digital purchase answered honestly). If the shell hides checkout, the questionnaire’s “can users purchase digital goods inside the app?” answer is no, and the notes say subscriptions are sold on the website to organisations. Read the live sentence. | Drafted for Play. App Store age rating is a separate questionnaire with the same facts. |
| Play Financial features | Declare the app as a tool that displays accounting figures from software the customer connected or files they uploaded. It does not take deposits, move money, lend, or trade. | Not filed. Human step in Play Console. |
| Seller name | Milon, Inc. Postal address on the privacy notice: 800 N King Street, Suite 304, PMB 3836, Wilmington, DE 19801, United States. The organisation name on Apple and Google must match the enrolment documents. | In `src/lib/legal.ts`. |

### What Theo must supply

Check these off in order. The repo cannot create them. Do not commit keystores, `.p8` keys, `google-services.json`, or passwords.

1. **Apple Developer Program, organisation.** Enrol as **Milon, Inc.** A D-U-N-S number for that legal entity is required before Apple will verify the organisation. Personal enrolment will not match the seller name and will not satisfy the organisation path below.
2. **Google Play Console, organisation account.** Same legal entity, **Milon, Inc.**, with D-U-N-S and whatever documents Play asks for that week. The one-time registration fee is USD 25. A personal Play account has had a closed-test gate (at least 12 testers opted in for 14 days) before production. Confirm the live policy. The organisation account is how we avoid starting that clock. Complete identity verification before expecting a production review.
3. **Android upload key.** Generate on a machine you control, following `mobile/README.md`. Copy `mobile/android/keystore.properties.example` to `keystore.properties`. Both the keystore and the properties file are gitignored. Enroll the first AAB in Play App Signing. Keep a backup of the upload key. Google holds the app signing key. After Play shows the app-signing SHA-256, that fingerprint is added beside the upload fingerprint in `public/.well-known/assetlinks.json` and `mobile/well-known/assetlinks.json`. Shipping that JSON is a web change and needs a deploy, which is outside this plan.
4. **Apple signing.** A distribution certificate and an App Store provisioning profile for `com.milonfinance.app`, or Xcode-managed signing on the Account Holder’s team. An App Store Connect API key only if CI will archive. CI must not contain the private key in the git repo.
5. **App icon and splash sources.** A 1024×1024 mark and the MILŌN wordmark on a white field, cobalt and navy, gold only in the wordmark. `public/icons/` and `public/milon-wordmark.png` are the current sources. Replace them if they are still the dark-ink mark, or approve a recolor of those files in the shell PR.
6. **Screenshots, per device size.** Phone shots for the sizes in the table above, captured from the demo account after the shell shows the real workspace. One set for Play, one set for the iPhone size App Store Connect requires. No tablet set if the shell is phone-only. No WhatsApp, no speaking avatars, vertical nav in frame.
7. **Privacy policy URL.** https://www.milonfinance.com/privacy. Confirm it loads signed-out on the day of submission.
8. **Support URL.** You choose the public URL and the inbox behind it. `team@milonfinance.com` is the inbox the privacy notice already publishes. The stores want an `https` page.
9. **Account deletion URL.** https://www.milonfinance.com/settings. Confirm a signed-in DELETE still completes on production before review.
10. **App Review test login.** A demo account with seeded books, created for review, never a real client and never a real firm’s ledger. Two users if both doors matter: an accountant on a firm that already has a plan, and an owner covered by that firm, so neither hits Checkout. A third disposable user if the reviewer will tap Delete account. Password and one-time notes go in App Store Connect’s review notes and in a Play testing instruction. They do not go in git. Turn off extra factors the reviewer cannot pass. Leave QuickBooks and Xero disconnected, or connect them to a sandbox company that contains only sample data.

Also, before OAuth or push can be called done. These are credentials and dashboard edits, same rule: not in git.

- Supabase → Authentication → URL Configuration: the www callback and `https://www.milonfinance.com/**`, apex entries kept. No new Google redirect URI.
- After Play App Signing: the app-signing SHA-256 in both assetlinks files, then a deploy of that static file.
- Apex and www both return 200 for `/.well-known/assetlinks.json` and, once the iOS PR has landed, `/.well-known/apple-app-site-association`.
- Sign in with Apple: Services ID, key, and the Supabase Apple provider.
- Push, when that PR starts: an APNs auth key, and an FCM Android app whose `google-services.json` stays on the build machine.
- A statement of whether production web builds set a Sentry DSN, yes or no, with the value left out.

## 5. PR sequence

Small, independent, in this order. The next piece of work after this document is one branch that builds the shell out and adds CI plus the listing drafts. Later PRs stay separate so a listings tweak does not wait on Face ID, and so the billing-gate files stay untouched until Chief of Staff says otherwise.

Dates below are external clocks, not build estimates. Apple and Google do not publish a review SLA.

### PR 0 — this document

Scope: add `docs/mobile/store-launch-plan.md` only.

Acceptance:

- The diff is that file.
- No change under `src/`, `mobile/`, `supabase/`, or workflow files.
- Web CI on the PR is green. `.github/workflows/android.yml` does not run, because its path filter is `mobile/**` and `.github/workflows/android.yml`. That is expected. Web CI (production build, unit tests, SQL migration check, Deno check) runs on every pull request and does apply to a docs change.

### PR 1 — Shell app, CI, and store-listing drafts

This is the next step. Branch off main. Do not recreate the Android project.

Scope:

- Add the Capacitor iOS target inside `mobile/`. Same app id, same remote URL, same offline page, same host list for leaving the WebView. `SFSafariViewController` or `ASWebAuthenticationSession` for the hosts in `MilonExternalUrls`. Universal Links entitlement. `PrivacyInfo.xcprivacy`. Camera and photo purpose strings can wait for the camera PR. Set iPhone-only.
- Restyle the Android and iOS shell chrome and the offline page to Brand System v1.1. White, cobalt, navy, gold only on the MILŌN wordmark. Regenerate icons and splash from the approved sources.
- Phone-only on Android as well, so Play does not require tablet screenshots.
- `public/.well-known/apple-app-site-association` for the paths in section 2. Serving it with the right content type is a deploy after merge. The PR only adds the file.
- CI: keep the debug APK job. Add a job that runs `cap sync ios` and an Xcode build for the simulator on a macOS runner. If the repository’s GitHub plan cannot run `macos-latest`, the PR says so in the workflow comment and still fails when the iOS project is missing; it does not pretend an unsigned simulator build ran.
- Rewrite `mobile/store/play-listing.md` and add `mobile/store/app-store-listing.md` in The MILŌN Team voice. Claims stay inside what the product does. No WhatsApp in accountant copy. Update `data-safety.md` for the Sentry condition. Leave `theo-checklist.md` accurate.

Out of scope: push, biometrics, camera plugin, Sign in with Apple, any file in the billing-gate list, any deploy, any store upload.

Acceptance:

- `mobile/` debug APK CI is green.
- iOS project syncs, and the simulator build is green or the workflow documents a missing macOS runner without failing silently.
- A cold launch with no network shows the offline page and a retry, on Android from the existing client and on iOS from the new one.
- Listing drafts do not promise bank feeds, tax filing, or a filing date.
- `git diff` does not touch the billing-gate paths listed under PR 5.

### PR 2 — Link verification notes and Talk deep link

Scope, only if PR 1’s AASA paths need a code-side fix after a device test: make sure an https link to `/talk/financial-manager`, `/auth/callback?code=…`, `/billing/success`, `/api/qbo/callback`, and `/api/xero/callback` is loaded in full inside the WebView and the system browser closes. Android already aims at this. iOS must match.

Acceptance: a test note in the PR (device, not a store upload) shows one Talk URL and one auth return URL opening the app. Asset Links stay unverified until Theo’s Play certificate fingerprint is deployed. The PR does not fake that check.

### PR 3 — Sign in with Apple, and iOS OAuth parity

Scope: Supabase Apple provider wiring in the auth screen, beside Google. The shell opens Apple’s authentication host outside the WebView. No new Google redirect URI. Dashboard secrets stay with Theo.

Acceptance: on a device build, Google sign-in and Apple sign-in both return to `/auth/callback` inside the WebView and land a session. Email and password still work. The PR does not remove Google.

### PR 4 — Camera, document picker, push, biometric lock

These can be three PRs if one of them stalls on a credential. The order inside the group is camera, then biometric lock, then push. Push waits on the APNs key and `google-services.json`.

Acceptance:

- Photographing a sample receipt from the source-document screen attaches an image the existing upload path accepts.
- Choosing a sample PDF still works.
- Face ID or fingerprint gates the workspace and does not clear the Supabase session when it fails once.
- A push tapped on a build with credentials opens a `/talk/:agent` or `/app` URL in the WebView. The notification body has no client name and no figure.
- Purpose strings and the privacy manifest match the new collection. Data-safety draft gains the photo row only in this PR.

### PR 5 — Paywall visibility inside the shell

**Blocked on Chief of Staff.** Do not open this PR until that approval is written down.

If the decision is “consumption-only”, the change hides Stripe Checkout, the Customer Portal, price selection, and the billing wall’s purchase button when the shell flag is set, and shows a sentence that the plan is managed on the website by the firm. The website in a normal browser stays exactly as it is.

Files that approval has to name before anyone edits them:

- `src/routes/_authenticated.gate.tsx`
- `src/components/firm-billing-gate-view.tsx`
- `src/lib/firm-gate-access.ts`
- `src/lib/billing-wall.ts`
- `src/lib/shell-gate.ts`
- `src/routes/billing.required.tsx`
- `src/routes/billing.start.tsx`
- `src/routes/billing.success.tsx`
- `src/routes/billing.cancel.tsx`
- `src/components/owner-door/owner-door.tsx` and `src/components/owner-door/owner-subscribe.tsx`
- `src/routes/_authenticated/settings.index.tsx` (the Manage billing row and the plan upgrade controls)
- `src/lib/stripe-checkout.functions.ts` and `src/lib/stripe-checkout.core.ts` only if the hide cannot be done at the view. Prefer the view. Leave charge creation alone.

Acceptance, once approved: a shell user agent or the shell flag cannot navigate into Checkout; a desktop browser still can; existing billing-gate tests stay green; a new test covers the shell flag. If Chief of Staff instead wants IAP and Play Billing, this PR is replaced by a design note. It is not started as a Stripe-hiding patch.

### After the PRs: human submission

No store upload is part of any PR above.

1. While PR 1 is in review, Theo starts D-U-N-S and both organisation enrolments. That paperwork is the long pole.
2. When PR 1 is merged and the upload key exists, upload a signed AAB to a Play **internal** track. Install from the Play opt-in link so App Links match Play’s certificate. Run one Google sign-in and one ledger connect or Stripe return only after the signing fingerprint is in assetlinks and the file returns 200 on both hosts. Internal testing is allowed to find the paywall. Production is not.
3. iOS TestFlight after PR 3 and PR 4, using the demo account. App Store review after PR 5 is approved and merged, or after Chief of Staff records a different payments decision and the binary matches it.
4. Review notes list the native features, the demo login, the deletion login, and the fact that plans are sold on the website to firms. Attach a screen recording of push, camera, and Face ID if the form allows it.

Play production and App Store review then run in parallel. A 4.2 rejection means more native surface or a narrower review build, then a new binary. It does not mean starting a React Native rewrite.

## What stays out of engineering’s hands

Deploys, Play Console edits, App Store Connect, Supabase dashboard, Google Cloud OAuth, Apple certificates, and email to anyone. Billing-gate and gate files, until Chief of Staff approves PR 5 by name.
