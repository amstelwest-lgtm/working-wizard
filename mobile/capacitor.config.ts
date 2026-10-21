import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Remote-URL shell. The Play build loads the live site, so web deploys show
 * up without an app update. www/ is the offline and error page only.
 * Android shows it on a main-frame failure and when a remote load does not
 * commit within 20 seconds.
 *
 * allowNavigation is milonfinance.com hosts. Stripe, Google, YouTube, and
 * ledger OAuth hosts are intentionally absent — the Android shell opens those
 * in Custom Tabs.
 *
 * Shell chrome is Brand System v1.1: white canvas, cobalt #0B5FFF, navy
 * #102A43. Gold appears only inside the MILŌN wordmark artwork.
 */
const config: CapacitorConfig = {
  appId: "com.milonfinance.app",
  appName: "Milōn",
  webDir: "www",
  server: {
    url: "https://www.milonfinance.com",
    androidScheme: "https",
    cleartext: false,
    errorPath: "index.html",
    allowNavigation: ["milonfinance.com", "*.milonfinance.com"],
  },
  android: {
    backgroundColor: "#FFFFFF",
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    backgroundColor: "#FFFFFF",
    contentInset: "automatic",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: "#FFFFFF",
      androidScaleType: "CENTER",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // LIGHT is dark status-bar content on a white bar.
      style: "LIGHT",
      backgroundColor: "#FFFFFF",
      overlaysWebView: false,
    },
  },
};

export default config;
