import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Remote-URL shell. The Play build loads the live site, so web deploys show
 * up without an app update. www/ is the offline and error page only.
 *
 * allowNavigation is milonfinance.com hosts. Stripe, Google, YouTube, and
 * ledger OAuth hosts are intentionally absent — the Android shell opens those
 * in Custom Tabs.
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
    backgroundColor: "#0a0a0a",
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: "#0a0a0a",
      androidScaleType: "CENTER",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // Capacitor's DARK style is light status-bar content on a dark bar.
      style: "DARK",
      backgroundColor: "#0a0a0a",
      overlaysWebView: false,
    },
  },
};

export default config;
