/**
 * Structural check for the iOS shell. Runs on Ubuntu.
 * Does not compile, sign, or launch the simulator. Those need a Mac,
 * Xcode, and an Apple signing identity, which this runner does not have.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const config = readFileSync(resolve(root, "capacitor.config.ts"), "utf8");
assert(config.includes('url: "https://www.milonfinance.com"'), "remote URL is www.milonfinance.com");
assert(config.includes('backgroundColor: "#FFFFFF"'), "shell canvas is white");
assert(!config.includes("#0a0a0a") && !config.includes("#0A0A0A"), "dark shell ink is gone from capacitor config");

const plist = readFileSync(resolve(root, "ios/App/App/Info.plist"), "utf8");
assert(plist.includes("<key>ITSAppUsesNonExemptEncryption</key>"), "export compliance key is set");
assert(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/.test(plist), "encryption flag is false");
assert(plist.includes("UIStatusBarStyleDarkContent"), "status bar uses dark content on white");

const privacy = readFileSync(resolve(root, "ios/App/App/PrivacyInfo.xcprivacy"), "utf8");
assert(privacy.includes("<key>NSPrivacyTracking</key>"), "privacy manifest tracks the tracking flag");
assert(/<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(privacy), "privacy manifest does not track");
assert(privacy.includes("NSPrivacyAccessedAPICategoryUserDefaults"), "UserDefaults reason is declared");
assert(privacy.includes("CA92.1"), "UserDefaults reason code is CA92.1");
assert(privacy.includes("NSPrivacyCollectedDataTypeOtherFinancialInfo"), "financial info is declared");
assert(!privacy.includes("NSPrivacyCollectedDataTypePaymentInfo"), "card data is not declared");

const project = readFileSync(resolve(root, "ios/App/App.xcodeproj/project.pbxproj"), "utf8");
assert(project.includes("PRODUCT_BUNDLE_IDENTIFIER = com.milonfinance.app;"), "bundle id is com.milonfinance.app");
assert(!project.includes('TARGETED_DEVICE_FAMILY = "1,2"'), "iPad is not a target");
assert(project.includes("TARGETED_DEVICE_FAMILY = 1;"), "iPhone is the device family");
assert(project.includes("PrivacyInfo.xcprivacy in Resources"), "privacy manifest is in the app resources");

const manifest = readFileSync(resolve(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
assert(manifest.includes('android:largeScreens="false"'), "Android shell is phone-only");

console.log("ios shell structure ok");
console.log(
  "Not run here: xcodebuild, code signing, TestFlight, and the iOS simulator. Those need a Mac, Xcode, and an Apple signing identity.",
);
