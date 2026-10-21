/**
 * Push opens a Milōn URL and stays inert without credentials.
 * Run: node scripts/push-shell-test.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const shell = readFileSync(resolve("mobile/www/shell.js"), "utf8");
assert(shell.includes("pushNotificationActionPerformed"), "a tap is handled");
assert(shell.includes("milonUrl"), "a path can become a Milōn URL");
assert(shell.includes('raw.charAt(0) === "/" && raw.charAt(1) !== "/"'), "protocol-relative URLs are not accepted");
assert(shell.includes("handleReturn(milonUrl(url)"), "the tap goes through the Milōn return check");
assert(shell.includes("!res.configured") || shell.includes("!res || !res.configured"), "registration waits for credentials");
assert(!shell.includes("token.token"), "the device token is not read");
assert(!/AIza|BEGIN PRIVATE KEY|google-services/i.test(shell), "shell.js has no push secret");

const plist = readFileSync(resolve("mobile/ios/App/App/Info.plist"), "utf8");
assert(/<key>MilonPushConfigured<\/key>\s*<false\/>/.test(plist), "iOS push flag defaults off");

const entitlements = readFileSync(resolve("mobile/ios/App/App/App.entitlements"), "utf8");
assert(!entitlements.includes("aps-environment"), "the push entitlement waits for an APNs key");

const manifest = readFileSync(resolve("mobile/android/app/src/main/AndroidManifest.xml"), "utf8");
assert(manifest.includes("FirebaseInitProvider"), "the Firebase provider is named");
assert(manifest.includes('tools:node="remove"'), "Firebase does not start without an app id");
assert(manifest.includes("android.permission.POST_NOTIFICATIONS"), "Android can ask to show a notification");
assert(manifest.includes('android:name=".MilonApplication"'), "the app can init Firebase itself");

const app = readFileSync(resolve("mobile/android/app/src/main/java/com/milonfinance/app/MilonApplication.java"), "utf8");
assert(app.includes("google_app_id"), "Android push looks for the generated app id");
assert(!/AIza|BEGIN PRIVATE KEY/.test(app), "the application class has no secret");

const java = readFileSync(
  resolve("mobile/android/app/src/main/java/com/milonfinance/app/MilonShellPlugin.java"),
  "utf8",
);
assert(java.includes("void pushConfigured"), "Android reports whether push is configured");

const swift = readFileSync(resolve("mobile/ios/App/App/MilonShellPlugin.swift"), "utf8");
assert(swift.includes('name: "pushConfigured"'), "iOS reports whether push is configured");
assert(swift.includes("MilonPushConfigured"), "iOS reads the plist flag");

const pkg = JSON.parse(readFileSync(resolve("mobile/package.json"), "utf8"));
assert(pkg.dependencies["@capacitor/push-notifications"] === "8.1.3", "push plugin is pinned");

assert(!existsSync(resolve("mobile/android/app/google-services.json")), "google-services.json is not in the repo");
assert(
  readFileSync(resolve("mobile/android/.gitignore"), "utf8").includes("google-services.json"),
  "google-services.json stays gitignored",
);

console.log("push shell ok");
