# Milōn Android shell

A Capacitor shell for the public site. The installed app loads `https://www.milonfinance.com`, so a web deploy shows up without a Play update. `www/` is only the offline page, used when that host cannot be reached.

This folder is its own npm package. It is not in the root pnpm workspace. Root ESLint and Prettier ignore it. Do not add it to a workspace list.

Package id: `com.milonfinance.app`. Display name: Milōn.

## What the shell does

- Status bar: dark background `#0a0a0a`, light icons. `@capacitor/status-bar` uses style `DARK` for that (Capacitor's name for light content on a dark bar).
- Splash: `@capacitor/splash-screen`, gold mark on `#0a0a0a`, generated from `public/icons` and `public/milon-wordmark.png`.
- Back: `@capacitor/app`. WebView history goes back. At the root the app minimises instead of finishing.
- Custom Tabs (`@capacitor/browser`): Stripe Checkout (`checkout.stripe.com`), YouTube, QuickBooks / Intuit, Xero, and Sage OAuth hosts, plus Google sign-in.
- App Links: `https://www.milonfinance.com` and `https://milonfinance.com`, `autoVerify`. `appUrlOpen` loads the returned URL in the WebView and the Custom Tab controller is finished.
- Session: WebView cookies and `localStorage` are the Capacitor defaults. Nothing in this project calls `CookieManager.removeAllCookies` or `WebStorage.deleteAllData`. `onPause` only flushes cookies to disk. A renderer crash does not clear them either.
- Renderer crash: `MilonWebViewClient` overrides `onRenderProcessGone`. The dead WebView is removed and destroyed, and the activity is recreated on the last Milōn page (home, if that page was an OAuth or checkout return). A second renderer crash within 30 seconds opens the bundled offline page. Returning true is what stops Android from killing the process.
- Failed or slow load: a main-frame network or HTTP error opens `www/index.html` (`server.errorPath`). If a remote navigation has not committed within 20 seconds, the same page opens. Retry on that page loads `https://www.milonfinance.com` again.

## Build

Capacitor 8 compiles this Android project as Java 21. Use JDK 21. JDK 17 will fail in `capacitor.build.gradle` (`sourceCompatibility JavaVersion.VERSION_21`).

Install once:

- JDK 21 (Temurin or the distro OpenJDK)
- Android SDK with platform 36 and build-tools 36 (`compileSdk` / `targetSdk` 36, `minSdk` 24)
- Node 22 to match the shell CI job

```bash
cd mobile
npm ci
npx cap sync android
cd android
./gradlew assembleRelease
./gradlew bundleRelease
```

`assembleRelease` is the APK. `bundleRelease` is the AAB Play expects.

A debug APK, signed with the local debug keystore Gradle creates, does not need `keystore.properties`:

```bash
cd mobile/android
./gradlew assembleDebug
```

The debug APK is `android/app/build/outputs/apk/debug/app-debug.apk`. CI runs this job (`.github/workflows/android.yml`) and uploads the APK as an artifact. It does not run the web build.

`npx cap open android` opens the project in Android Studio if you have it.

## Signing

Release signing reads `mobile/android/keystore.properties`. That file is gitignored, and so are `*.jks`, `*.keystore`, and `google-services.json`.

```bash
cp android/keystore.properties.example android/keystore.properties
```

`storeFile` is relative to `mobile/android/`. Put the upload keystore next to it, or point `storeFile` at an absolute path on the signing machine. Never commit the keystore or the filled-in properties file.

If `keystore.properties` is absent, `assembleRelease` / `bundleRelease` still configure, but the release build type is unsigned. Play Console will reject an unsigned AAB. Create the upload key once:

```bash
keytool -genkeypair -v \
  -keystore android/upload-keystore.jks \
  -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

Enroll in **Play App Signing**. The upload key stays with you. Google holds the app signing key. `assetlinks.json` needs both SHA-256 fingerprints: the upload key (already filled in) and the Play app signing certificate (still the `REPLACE_WITH_PLAY_APP_SIGNING_SHA256` placeholder).

## App Links

OAuth and Stripe return to the website (`/auth/callback`, `/billing/success`, `/api/qbo/callback`, `/api/xero/callback`, and so on). The shell claims `https://www.milonfinance.com` and the apex host so those URLs open the app instead of staying in the Custom Tab.

`autoVerify` does nothing until the site serves Digital Asset Links. This PR does not add a web route. The file to publish is `mobile/well-known/assetlinks.json`.

Serve the same JSON at both:

- `https://www.milonfinance.com/.well-known/assetlinks.json`
- `https://milonfinance.com/.well-known/assetlinks.json`

`Content-Type: application/json`. No redirects that drop the file. The file already contains the upload-key SHA-256 `53:72:E4:DA:D7:C3:B3:04:82:C1:93:2B:AE:AA:2A:B0:BC:56:46:4E:6D:6E:C4:84:86:49:F0:13:62:61:53:9E`. Replace `REPLACE_WITH_PLAY_APP_SIGNING_SHA256` with the fingerprint from Play Console → App integrity → App signing key certificate → SHA-256. Colons, uppercase hex, the way Play shows it. Leave both entries in the array.

Until that file is live, Android will not verify the link. The Custom Tab will keep the return URL and the WebView will not see the OAuth code. Check after the file is deployed:

```bash
adb shell pm get-app-links com.milonfinance.app
adb shell pm verify-app-links --re-verify com.milonfinance.app
```

Play Console's App Links statement list should show the host as verified.

## Google sign-in

The website starts Google with Supabase (`src/lib/google-auth.ts`): `signInWithOAuth({ provider: "google", redirectTo })`. `redirectTo` is the page origin plus `/auth/callback`. Inside the shell that origin is `https://www.milonfinance.com`, so the callback is `https://www.milonfinance.com/auth/callback` (invite and checkout query params included).

supabase-js writes the PKCE code verifier into this WebView's `localStorage`, then navigates to `{SUPABASE_URL}/auth/v1/authorize`. That host is `*.supabase.co` today, or `auth.milonfinance.com` after the custom-domain cutover. Google then shows `accounts.google.com`. Google rejects that page inside a WebView (`disallowed_useragent`).

The shell intercepts those navigations and opens them in a Custom Tab. The verifier stays in the WebView. Google returns to Supabase, Supabase redirects to `https://www.milonfinance.com/auth/callback?code=…`, the App Link opens the app, and `appUrlOpen` loads that URL in the WebView. The site's existing callback exchanges the code. The Custom Tab controller is finished so it does not sit on top of the WebView.

No Google Cloud redirect URI change. Google's authorized redirect is still the Supabase callback (`https://…supabase.co/auth/v1/callback` or `https://auth.milonfinance.com/auth/v1/callback`).

**Theo:** Supabase → Authentication → URL Configuration. The checked-in runbook lists the apex callback. The shell's origin is `www`, so add:

- `https://www.milonfinance.com/auth/callback`
- `https://www.milonfinance.com/**`

Keep the apex entries that are already there. No custom scheme. App Links will not complete sign-in until `assetlinks.json` is served with the Play signing fingerprint.

## Push

Not wired. There is no `google-services.json` and the Firebase plugin is not applied unless that gitignored file is present on a machine (the Capacitor template checks for it).

When you want FCM:

1. `npm install @capacitor/push-notifications` inside `mobile/`
2. Place `google-services.json` only on the build machine (`mobile/android/app/google-services.json`). Do not commit it.
3. `npx cap sync android`
4. Uncomment the block in `www/shell.js`

## Icons

```bash
python3 scripts/generate-brand-assets.py
npx capacitor-assets generate --android \
  --iconBackgroundColor '#0a0a0a' \
  --iconBackgroundColorDark '#0a0a0a' \
  --splashBackgroundColor '#0a0a0a' \
  --splashBackgroundColorDark '#0a0a0a'
```

Run that from `mobile/`. Source art is the existing mark and wordmark. Generated `res/` files are committed so a Play build does not need the generator.

## Store drafts

`store/play-listing.md`, `store/content-rating.md`, `store/data-safety.md`, and `store/theo-checklist.md`.
