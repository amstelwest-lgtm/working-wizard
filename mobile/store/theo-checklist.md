# Before this shell can ship

The repo does not contain a keystore, a Play account, or the Digital Asset Links fingerprint. These stay with you.

1. **Play Console account.** One-time USD 25 registration. Create it in the name you want on the store. A personal account and an organisation account follow different review rules (see closed testing below).

2. **Identity.** Complete Play’s identity check. An organisation account needs the organisation verification Play asks for, which is often a D-U-N-S number. A personal account uses the identity documents the form requests. Do this before you expect a production review.

3. **Privacy policy URL.** https://www.milonfinance.com/privacy — on the store listing and on Data safety. The draft answers are in `data-safety.md` and `content-rating.md`. The listing copy is in `play-listing.md`.

4. **Play App Signing and the upload key.** Enroll in Play App Signing when the first AAB is uploaded. Generate the upload keystore on a machine you control (`mobile/README.md`). Copy `android/keystore.properties.example` to `android/keystore.properties`. Both the keystore and that properties file are gitignored. Keep a backup of the upload key. You cannot download it from Play later. The app signing key stays with Google.

5. **Asset Links fingerprint.** Play Console → App integrity → App signing key certificate → SHA-256. Paste it over `REPLACE_WITH_PLAY_APP_SIGNING_SHA256` in `mobile/well-known/assetlinks.json`. Publish that JSON at `https://www.milonfinance.com/.well-known/assetlinks.json` and at `https://milonfinance.com/.well-known/assetlinks.json` with `Content-Type: application/json`. This PR does not change the website. Until the file is live, App Links will not verify, and Google, Stripe, and ledger OAuth returns will stay in the Custom Tab instead of coming back into the app. Use the app signing certificate, not the upload certificate, once Play App Signing is on.

6. **Supabase redirect allow-list.** Authentication → URL Configuration. The shell’s origin is `https://www.milonfinance.com`, and Google sign-in redirects there (`/auth/callback`, plus any invite or checkout query the site already adds). Add:
   - `https://www.milonfinance.com/auth/callback`
   - `https://www.milonfinance.com/**`
   Keep the apex `https://milonfinance.com/…` entries. Do not add a custom scheme. Google Cloud’s OAuth client still redirects to the Supabase callback only (`*.supabase.co/auth/v1/callback` or `auth.milonfinance.com/auth/v1/callback`). No new Google redirect URI for the app.

7. **Testers track.** Upload the signed AAB to an internal or closed testing track first. Install from the Play opt-in link, not from a sideloaded release APK, so App Links and Play signing match the build testers actually run.

8. **Closed testing, if the account is personal.** Google has required a closed test with at least 12 testers who stay opted in for 14 days before a personal account can apply for production. Confirm the number and the waiting period on the current Play policy when you apply. An organisation account may not have that gate. Do not start the clock until the build you care about is the one those testers have installed.

Also before you call sign-in done: confirm `assetlinks.json` with `adb shell pm get-app-links com.milonfinance.app` on a Play-installed build, then run one Google sign-in and one Stripe return (or a ledger connect) and see the WebView land on the milonfinance.com URL.
