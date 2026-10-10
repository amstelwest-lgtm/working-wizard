/*
 * Milōn Android shell. The native WebView injects this at document start on
 * milonfinance.com. The website does not ship it.
 *
 * Cookies and localStorage are left alone. Nothing here clears them.
 */
(function () {
  if (window.__MILON_ANDROID_SHELL__) return;
  var host = (location.hostname || "").toLowerCase();
  var onMilon =
    host === "milonfinance.com" ||
    host.endsWith(".milonfinance.com") ||
    host === "localhost";
  if (!onMilon) return;
  window.__MILON_ANDROID_SHELL__ = true;

  var DARK = "#0a0a0a";

  function plugin(name) {
    var cap = window.Capacitor;
    if (!cap || typeof cap.registerPlugin !== "function") return null;
    try {
      return cap.registerPlugin(name);
    } catch (e) {
      return cap.Plugins ? cap.Plugins[name] : null;
    }
  }

  function isReturnUrl(url) {
    try {
      var parsed = new URL(url);
      if (parsed.protocol !== "https:") return false;
      var h = parsed.hostname.toLowerCase();
      return h === "www.milonfinance.com" || h === "milonfinance.com";
    } catch (e) {
      return false;
    }
  }

  function closeCustomTab(browser) {
    if (!browser || typeof browser.close !== "function") return;
    try {
      var pending = browser.close();
      if (pending && typeof pending.catch === "function") pending.catch(function () {});
    } catch (e) {
      /* Android close is best-effort; MainActivity also finishes the tab. */
    }
  }

  /**
   * App Link return (Google, Stripe, ledger OAuth). Load it once in this
   * WebView so the PKCE verifier in localStorage can finish the session.
   */
  function handleReturn(url, browser) {
    if (!url || !isReturnUrl(url)) return;
    closeCustomTab(browser);
    if (window.location.href === url) return;
    var key = "milon_shell_return:" + url;
    try {
      if (sessionStorage.getItem(key) === "1") return;
      sessionStorage.setItem(key, "1");
    } catch (e) {
      /* private mode: still navigate, native side dedupes */
    }
    window.location.replace(url);
  }

  function boot() {
    var App = plugin("App");
    var Browser = plugin("Browser");
    var StatusBar = plugin("StatusBar");
    var SplashScreen = plugin("SplashScreen");
    if (!App) return false;

    if (StatusBar) {
      StatusBar.setOverlaysWebView({ overlay: false });
      StatusBar.setBackgroundColor({ color: DARK });
      // DARK = light icons / text, for the dark bar. See StatusBar plugin.
      StatusBar.setStyle({ style: "DARK" });
    }
    if (SplashScreen && typeof SplashScreen.hide === "function") {
      SplashScreen.hide();
    }

    App.addListener("backButton", function (event) {
      if (event && event.canGoBack) {
        window.history.back();
        return;
      }
      App.minimizeApp();
    });

    App.addListener("appUrlOpen", function (event) {
      handleReturn(event && event.url, Browser);
    });

    /*
     * Push is not wired. No FCM project, no google-services.json.
     * When Theo is ready:
     *   1. npm install @capacitor/push-notifications
     *   2. Place google-services.json only on the signing machine (gitignored).
     *   3. npx cap sync android
     *   4. Uncomment the block below.
     *
     * var Push = plugin("PushNotifications");
     * if (Push) {
     *   Push.requestPermissions().then(function (perm) {
     *     if (perm.receive === "granted") return Push.register();
     *   });
     *   Push.addListener("registration", function (token) {
     *     // send token.token to the Milōn API
     *   });
     *   Push.addListener("pushNotificationReceived", function () {});
     *   Push.addListener("pushNotificationActionPerformed", function (action) {
     *     var url = action && action.notification && action.notification.data && action.notification.data.url;
     *     if (url) handleReturn(url, Browser);
     *   });
     * }
     */

    if (window.__MILON_LAUNCH_URL__) {
      handleReturn(window.__MILON_LAUNCH_URL__, Browser);
    }
    return true;
  }

  if (!boot()) {
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (boot() || tries > 40) clearInterval(timer);
    }, 50);
  }
})();
