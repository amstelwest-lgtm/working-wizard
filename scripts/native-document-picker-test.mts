/**
 * The store shell's camera and document picker stay behind the native flag.
 * A browser keeps the file input. Run:
 * pnpm exec vite-node --config scripts/vite-test.config.ts scripts/native-document-picker-test.mts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileFromNativePick, pickNativeDocument, readNativePicker } from "../src/lib/native-document-picker";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const file = fileFromNativePick({
  name: "receipt.png",
  mime: "image/png",
  base64: png.toString("base64"),
});
assert(file?.type === "image/png", "a png comes back as a png file");
assert(file?.name === "receipt.png", "the file keeps its name");
assert(file && file.size === png.length, "the bytes round-trip");

assert(
  fileFromNativePick({ name: "../secret.exe", mime: "application/x-msdownload", base64: png.toString("base64") }) ===
    null,
  "a disallowed type is dropped",
);
assert(
  fileFromNativePick({ name: "notes.pdf", mime: "", base64: png.toString("base64") })?.type === "application/pdf",
  "an empty mime falls back to the extension",
);

assert(readNativePicker({}) === null, "a browser has no native picker");
assert(
  (await pickNativeDocument("camera", {})).status === "unavailable",
  "camera falls back when the shell is absent",
);
assert(
  (await pickNativeDocument("upload", {})).status === "unavailable",
  "documents fall back when the shell is absent",
);

const cancelled = await pickNativeDocument("camera", {
  __MILON_NATIVE_PICKER__: {
    takePhoto: async () => null,
    pickDocument: async () => null,
  },
});
assert(cancelled.status === "cancel", "a dismissed camera is not a second prompt");

const denied = await pickNativeDocument("camera", {
  __MILON_NATIVE_PICKER__: {
    takePhoto: async () => {
      throw new Error("Camera permission was denied");
    },
    pickDocument: async () => null,
  },
});
assert(
  denied.status === "error" && denied.message.includes("Allow camera access"),
  "a denied camera permission is explained",
);

const panel = readFileSync(resolve("src/components/source-documents-panel.tsx"), "utf8");
assert(panel.includes("pickNativeDocument"), "the documents panel asks the shell first");
assert(panel.includes('capture="environment"'), "the browser still has the camera input");
assert(panel.includes("Upload a document"), "upload stays available");
assert(panel.includes("Take a photo"), "the camera action stays available");

const shell = readFileSync(resolve("mobile/www/shell.js"), "utf8");
assert(shell.includes("__MILON_NATIVE_PICKER__"), "the shell publishes the picker");
assert(shell.includes("takePhoto"), "the shell can take a photo");
assert(shell.includes("pickDocument"), "the shell can pick a document");

const java = readFileSync(
  resolve("mobile/android/app/src/main/java/com/milonfinance/app/MilonShellPlugin.java"),
  "utf8",
);
const helper = readFileSync(
  resolve("mobile/android/app/src/main/java/com/milonfinance/app/MilonPickedFile.java"),
  "utf8",
);
assert(java.includes("void takePhoto"), "Android plugin takes a photo");
assert(java.includes("void pickDocument"), "Android plugin picks a document");
assert(helper.includes("20 * 1024 * 1024"), "Android refuses files over 20 MB");

const manifest = readFileSync(resolve("mobile/android/app/src/main/AndroidManifest.xml"), "utf8");
assert(manifest.includes("android.permission.CAMERA"), "Android declares the camera permission");
assert(manifest.includes('android:required="false"'), "a phone without a camera can still install");
assert(!manifest.includes("READ_MEDIA_IMAGES"), "the document picker does not request photo-library access");
assert(!manifest.includes("READ_EXTERNAL_STORAGE"), "the document picker uses the system picker");

const plist = readFileSync(resolve("mobile/ios/App/App/Info.plist"), "utf8");
assert(plist.includes("<key>NSCameraUsageDescription</key>"), "iOS has a camera usage string");
assert(
  /NSCameraUsageDescription<\/key>\s*<string>[^<]*receipt[^<]*<\/string>/.test(plist),
  "the camera usage string says what the photo is for",
);
const swift = readFileSync(resolve("mobile/ios/App/App/MilonShellPlugin.swift"), "utf8");
assert(swift.includes('name: "takePhoto"'), "iOS plugin registers takePhoto");
assert(swift.includes('name: "pickDocument"'), "iOS plugin registers pickDocument");
assert(swift.includes("UIDocumentPickerViewController"), "iOS uses the document picker");
assert(swift.includes("NSCameraUsageDescription") === false, "the usage string lives in Info.plist");

const privacy = readFileSync(resolve("mobile/ios/App/App/PrivacyInfo.xcprivacy"), "utf8");
assert(privacy.includes("NSPrivacyCollectedDataTypePhotosorVideos"), "a receipt photo is declared");
assert(!privacy.includes("NSPrivacyCollectedDataTypePaymentInfo"), "card data is still not declared");

for (const text of [plist, swift, java, panel]) {
  assert(!/\bwhatsapp\b|\bsars\b|\brand\b|\bzar\b/i.test(text), "picker copy has no out-of-scope claims");
}

console.log("native-document-picker-test: ok");
