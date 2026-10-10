package com.milonfinance.app;

import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.lifecycle.Lifecycle;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONObject;

/**
 * Remote-URL shell. Cookies and WebView storage are not cleared on pause,
 * stop, or destroy — sign-in survives leaving the app.
 */
public class MainActivity extends BridgeActivity {

    private String shellScript;
    private boolean recoverWhenResumed;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MilonShellPlugin.class);
        super.onCreate(savedInstanceState);
        if (bridge == null || bridge.getWebView() == null) return;

        MilonWebViewClient client = new MilonWebViewClient(bridge, this);
        bridge.setWebViewClient(client);

        applySystemBars();
        acceptCookies(bridge.getWebView());
        shellScript = buildShellScript();
        installDocumentStartScript(bridge.getWebView(), shellScript);
        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageLoaded(WebView webView) {
                    if (shellScript != null && !shellScript.isEmpty()) {
                        webView.evaluateJavascript(shellScript, null);
                    }
                }
            }
        );

        WebView webView = bridge.getWebView();
        if (MilonWebViewClient.consumeOfflineLanding()) {
            String errorUrl = bridge.getErrorUrl();
            webView.stopLoading();
            if (errorUrl != null) webView.loadUrl(errorUrl);
            else client.armIfStillLoading(webView);
        } else {
            String reload = MilonWebViewClient.consumeReloadUrl();
            if (reload != null) {
                webView.stopLoading();
                webView.loadUrl(reload);
            } else {
                client.armIfStillLoading(webView);
            }
        }
    }

    /**
     * Posted from {@link MilonWebViewClient#onRenderProcessGone} after the
     * dead WebView has been detached and destroyed. Recreate so Capacitor
     * builds a fresh WebView. If that happens while we are backgrounded,
     * wait until resume.
     */
    void onRendererGone() {
        if (isFinishing() || isDestroyed()) return;
        if (!getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) {
            recoverWhenResumed = true;
            return;
        }
        recreate();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (!recoverWhenResumed || isFinishing() || isDestroyed()) return;
        recoverWhenResumed = false;
        recreate();
    }

    @Override
    public void onPause() {
        super.onPause();
        // Flush, do not wipe. WebView cookies are the signed-in session.
        CookieManager.getInstance().flush();
    }

    private void applySystemBars() {
        var window = getWindow();
        int ink = Color.parseColor("#0a0a0a");
        window.setStatusBarColor(ink);
        window.setNavigationBarColor(ink);
        WindowCompat.setDecorFitsSystemWindows(window, true);
        WindowInsetsControllerCompat insets = WindowCompat.getInsetsController(window, window.getDecorView());
        // false = light icons on the dark bar
        insets.setAppearanceLightStatusBars(false);
        insets.setAppearanceLightNavigationBars(false);
    }

    private void acceptCookies(WebView webView) {
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);
    }

    private void installDocumentStartScript(WebView webView, String script) {
        if (script == null || script.isEmpty()) return;
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
        Set<String> origins = new HashSet<>();
        origins.add("https://www.milonfinance.com");
        origins.add("https://milonfinance.com");
        origins.add("https://auth.milonfinance.com");
        origins.add("https://localhost");
        try {
            WebViewCompat.addDocumentStartJavaScript(webView, script, origins);
        } catch (IllegalArgumentException ignored) {
            /* onPageLoaded still injects the shell */
        }
    }

    private String buildShellScript() {
        String source = readAsset("public/shell.js");
        if (source.isEmpty()) return "";
        String launch = "null";
        Uri data = getIntent() == null ? null : getIntent().getData();
        if (MilonExternalUrls.isAppLinkReturn(data)) {
            launch = JSONObject.quote(data.toString());
        }
        return "window.__MILON_LAUNCH_URL__ = " + launch + ";\n" + source;
    }

    private String readAsset(String path) {
        try (InputStream in = getAssets().open(path)) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException ex) {
            return "";
        }
    }
}
