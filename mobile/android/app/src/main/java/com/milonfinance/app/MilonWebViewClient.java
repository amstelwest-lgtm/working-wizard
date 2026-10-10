package com.milonfinance.app;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.lang.ref.WeakReference;
import java.util.Locale;

/**
 * Keeps a renderer crash or a failed remote load from taking the process down.
 * The dead WebView is removed and destroyed, then the activity is recreated.
 * A main-frame error, or a remote navigation that has not committed in
 * {@link #LOAD_TIMEOUT_MS}, loads the bundled offline page instead.
 *
 * Cookies and localStorage live in the app WebView profile. This class does
 * not clear them.
 */
public class MilonWebViewClient extends BridgeWebViewClient {

    static final long LOAD_TIMEOUT_MS = 20_000L;
    private static final long REPEAT_CRASH_WINDOW_MS = 30_000L;
    private static final String TAG = "MilonShell";

    private static long lastCrashElapsed = 0L;
    private static boolean landOnOffline = false;
    private static String pendingReloadUrl = null;

    private final Bridge bridge;
    private final WeakReference<MainActivity> activityRef;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pendingTimeout;
    private int timeoutGeneration = 0;
    private String lastGoodUrl;
    private boolean recovering;

    public MilonWebViewClient(Bridge bridge, MainActivity activity) {
        super(bridge);
        this.bridge = bridge;
        this.activityRef = new WeakReference<>(activity);
    }

    /** Second renderer crash in a short window opens the offline page. */
    static boolean landOnOfflineAfterCrash(boolean didCrash, long lastCrashElapsed, long now) {
        if (!didCrash || lastCrashElapsed == 0L) return false;
        return now - lastCrashElapsed < REPEAT_CRASH_WINDOW_MS;
    }

    /**
     * A page worth reloading after a renderer crash. One-shot OAuth and
     * checkout returns are skipped so a code is not replayed.
     */
    static String safeReloadUrl(String url) {
        if (url == null || url.isEmpty()) return null;
        Uri uri = Uri.parse(url);
        if (!"https".equalsIgnoreCase(uri.getScheme())) return null;
        String host = uri.getHost();
        if (host == null) return null;
        host = host.toLowerCase(Locale.US);
        boolean milon = "milonfinance.com".equals(host) || host.endsWith(".milonfinance.com");
        if (!milon) return null;
        String path = uri.getPath() == null ? "" : uri.getPath();
        if (path.equals("/auth") || path.startsWith("/auth/") || path.startsWith("/billing/") || path.startsWith("/api/")) {
            return null;
        }
        return url;
    }

    static boolean consumeOfflineLanding() {
        boolean value = landOnOffline;
        landOnOffline = false;
        return value;
    }

    static String consumeReloadUrl() {
        String url = pendingReloadUrl;
        pendingReloadUrl = null;
        return url;
    }

    /** Arm the timeout if the first remote navigation is still in flight. */
    void armIfStillLoading(WebView view) {
        if (view == null || isBundledError(view.getUrl())) return;
        if (view.getProgress() >= 100 && view.getUrl() != null) return;
        scheduleTimeout(view);
    }

    @Override
    public void onPageStarted(WebView view, String url, Bitmap favicon) {
        super.onPageStarted(view, url, favicon);
        if (isBundledError(url)) {
            cancelTimeout();
            return;
        }
        scheduleTimeout(view);
    }

    @Override
    public void onPageCommitVisible(WebView view, String url) {
        super.onPageCommitVisible(view, url);
        if (!isBundledError(url)) cancelTimeout();
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        if (isBundledError(url)) {
            cancelTimeout();
            return;
        }
        lastGoodUrl = url;
        cancelTimeout();
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request != null && request.isForMainFrame()) {
            cancelTimeout();
            if (isBundledError(request.getUrl() == null ? null : request.getUrl().toString())) return;
        }
        super.onReceivedError(view, request, error);
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
        if (request != null && request.isForMainFrame()) {
            cancelTimeout();
            if (isBundledError(request.getUrl() == null ? null : request.getUrl().toString())) return;
        }
        super.onReceivedHttpError(view, request, errorResponse);
    }

    @Override
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        // Capacitor's client returns false unless a listener opts in, and the
        // system then kills the app. Recover here and return true.
        if (recovering) return true;
        recovering = true;
        cancelTimeout();

        boolean didCrash = detail != null && detail.didCrash();
        long now = SystemClock.elapsedRealtime();
        boolean offline = landOnOfflineAfterCrash(didCrash, lastCrashElapsed, now);
        if (didCrash) lastCrashElapsed = now;
        if (offline) {
            landOnOffline = true;
            pendingReloadUrl = null;
        } else {
            pendingReloadUrl = safeReloadUrl(lastGoodUrl);
        }
        Log.w(TAG, didCrash ? "WebView renderer crashed; recovering" : "WebView renderer was killed; recovering");

        detachAndDestroy(view);
        MainActivity activity = activityRef.get();
        if (activity != null) {
            handler.post(activity::onRendererGone);
        }
        return true;
    }

    private void scheduleTimeout(WebView view) {
        cancelTimeout();
        final int ticket = timeoutGeneration;
        pendingTimeout =
            () -> {
                if (ticket != timeoutGeneration || recovering) return;
                showBundledError(view);
            };
        handler.postDelayed(pendingTimeout, LOAD_TIMEOUT_MS);
    }

    private void cancelTimeout() {
        timeoutGeneration++;
        if (pendingTimeout != null) {
            handler.removeCallbacks(pendingTimeout);
            pendingTimeout = null;
        }
    }

    private void showBundledError(WebView view) {
        if (view == null) return;
        String errorUrl = bridge.getErrorUrl();
        if (errorUrl == null) return;
        try {
            if (isBundledError(view.getUrl())) return;
            cancelTimeout();
            view.loadUrl(errorUrl);
        } catch (RuntimeException ex) {
            Log.w(TAG, "Could not open the offline page");
        }
    }

    private boolean isBundledError(String url) {
        if (url == null || url.isEmpty()) return false;
        String errorUrl = bridge.getErrorUrl();
        if (errorUrl != null && (url.equals(errorUrl) || url.startsWith(errorUrl + "?") || url.startsWith(errorUrl + "#"))) {
            return true;
        }
        Uri uri = Uri.parse(url);
        if (!"localhost".equalsIgnoreCase(uri.getHost())) return false;
        String path = uri.getPath();
        return path == null || path.equals("/") || path.endsWith("/index.html");
    }

    private static void detachAndDestroy(WebView view) {
        if (view == null) return;
        try {
            ViewParent parent = view.getParent();
            if (parent instanceof ViewGroup group) {
                group.setBackgroundColor(Color.parseColor("#0a0a0a"));
                group.removeView(view);
            }
            view.destroy();
        } catch (RuntimeException ex) {
            Log.w(TAG, "WebView cleanup after renderer loss failed");
        }
    }
}
