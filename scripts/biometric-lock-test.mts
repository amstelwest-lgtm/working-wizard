/**
 * On-device biometric lock. It never signs the person out.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/biometric-lock-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { biometricLockAvailable, readBiometricLock } from "../src/lib/biometric-lock";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(readBiometricLock({}) === null, "a browser has no biometric lock");
assert(biometricLockAvailable(null) === null, "a missing host stays unlocked");

const ui = readFileSync(resolve("src/components/biometric-lock.tsx"), "utf8");
assert(ui.includes("Milōn is locked"), "the lock screen names the app");
assert(ui.includes("does not sign you out"), "the setting says the session stays");
assert(!ui.includes("signOut"), "the lock does not sign the person out");
assert(!ui.includes("supabase"), "the lock does not touch the session client");
assert(ui.includes("#0B5FFF") && ui.includes("#102A43"), "the lock uses brand colours");
assert(!/gold|#d4af37|#b8860b/i.test(ui), "the lock does not use gold");

const layout = readFileSync(resolve("src/routes/_authenticated.tsx"), "utf8");
assert(layout.includes("BiometricLockGate"), "the workspace can show the lock");
const gate = readFileSync(resolve("src/routes/_authenticated.gate.tsx"), "utf8");
assert(!gate.includes("Biometric"), "the billing gate file is untouched");

const settings = readFileSync(resolve("src/routes/_authenticated/settings.index.tsx"), "utf8");
assert(settings.includes("BiometricLockSetting"), "settings can turn the lock on");

const shell = readFileSync(resolve("mobile/www/shell.js"), "utf8");
assert(shell.includes("__MILON_BIOMETRIC__"), "the shell publishes the lock");
assert(shell.includes("milon-biometric-lock"), "leaving the app asks the workspace to lock");

const java = readFileSync(
  resolve("mobile/android/app/src/main/java/com/milonfinance/app/MilonShellPlugin.java"),
  "utf8",
);
assert(java.includes("void unlockWithBiometric"), "Android can unlock");
assert(java.includes("biometric_lock"), "Android stores the flag on the device");
assert(!java.includes("signOut"), "Android lock does not sign out");

const manifest = readFileSync(resolve("mobile/android/app/src/main/AndroidManifest.xml"), "utf8");
assert(manifest.includes("android.permission.USE_BIOMETRIC"), "Android declares biometric use");

const gradle = readFileSync(resolve("mobile/android/app/build.gradle"), "utf8");
assert(gradle.includes("androidx.biometric:biometric"), "Android biometric library is on the app");

const plist = readFileSync(resolve("mobile/ios/App/App/Info.plist"), "utf8");
assert(plist.includes("<key>NSFaceIDUsageDescription</key>"), "Face ID usage string is set");
assert(plist.includes("stays on this device"), "the Face ID string says the biometric stays on device");

const swift = readFileSync(resolve("mobile/ios/App/App/MilonShellPlugin.swift"), "utf8");
assert(swift.includes('name: "unlockWithBiometric"'), "iOS plugin registers unlock");
assert(swift.includes("LAContext"), "iOS uses LocalAuthentication");
assert(swift.includes("milon_biometric_lock"), "iOS stores the flag on the device");

const privacy = readFileSync(resolve("mobile/ios/App/App/PrivacyInfo.xcprivacy"), "utf8");
assert(
  !privacy.includes("NSPrivacyCollectedDataTypeSensitiveInfo"),
  "the biometric is not declared as collected data",
);

console.log("biometric-lock-test: ok");
