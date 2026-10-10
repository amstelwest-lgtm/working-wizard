package com.milonfinance.app;

import android.net.Uri;
import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Which navigations stay in the WebView, and which must leave it.
 * Google rejects sign-in inside an embedded WebView, and Stripe / ledger
 * OAuth pages are full browser flows. Those open in Custom Tabs.
 */
final class MilonExternalUrls {

    private static final Set<String> YOUTUBE = setOf(
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtu.be",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com"
    );

    /** Hosts the user actually visits. Token endpoints stay server-side. */
    private static final Set<String> LEDGER_OAUTH = setOf(
        "checkout.stripe.com",
        "appcenter.intuit.com",
        "accounts.intuit.com",
        "oauth.platform.intuit.com",
        "oauth.intuit.com",
        "app.qbo.intuit.com",
        "qbo.intuit.com",
        "quickbooks.intuit.com",
        "login.xero.com",
        "identity.xero.com",
        "go.xero.com",
        "apps.xero.com",
        "id.sage.com",
        "accounts.sage.com",
        "login.sage.com",
        "accounts.sageone.com",
        "www.sageone.com",
        "my.sageone.com",
        "oauth.accounting.sage.com",
        "accounting.sageone.co.za"
    );

    private MilonExternalUrls() {}

    static boolean isAppLinkReturn(Uri uri) {
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
        String host = host(uri);
        return "www.milonfinance.com".equals(host) || "milonfinance.com".equals(host);
    }

    /** True when the WebView must not load this URL. */
    static boolean shouldOpenInCustomTab(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme();
        if (scheme == null || !scheme.equalsIgnoreCase("https")) return false;
        String host = host(uri);
        if (host.isEmpty()) return false;
        if (isGoogleSignIn(host)) return true;
        if (isSupabaseAuth(host, uri.getPath())) return true;
        if (YOUTUBE.contains(host)) return true;
        return LEDGER_OAUTH.contains(host);
    }

    /** Embed URLs do not play reliably in a tab. Open the watch page. */
    static Uri customTabTarget(Uri uri) {
        String host = host(uri);
        if (!"www.youtube-nocookie.com".equals(host) && !"youtube-nocookie.com".equals(host)) {
            return uri;
        }
        String path = uri.getPath();
        if (path == null || !path.startsWith("/embed/")) return uri;
        String id = path.substring("/embed/".length());
        int slash = id.indexOf('/');
        if (slash >= 0) id = id.substring(0, slash);
        if (id.isEmpty()) return uri;
        return Uri.parse("https://www.youtube.com/watch?v=" + id);
    }

    private static boolean isGoogleSignIn(String host) {
        return "accounts.google.com".equals(host) || host.startsWith("accounts.google.");
    }

    /**
     * Supabase OAuth starts at /auth/v1/authorize and bounces to Google.
     * Open that first hop in a Custom Tab so the WebView never becomes the
     * embedded user-agent Google blocks. The PKCE verifier stays in the
     * WebView. The return is https://www.milonfinance.com/auth/callback.
     */
    private static boolean isSupabaseAuth(String host, String path) {
        if (path == null) return false;
        if (host.endsWith(".supabase.co") && path.startsWith("/auth/")) return true;
        boolean customDomain = "auth.milonfinance.com".equals(host) || "auth.milon.co.za".equals(host);
        return customDomain && path.startsWith("/auth/v1/");
    }

    private static String host(Uri uri) {
        String host = uri.getHost();
        if (host == null) return "";
        return host.toLowerCase(Locale.US);
    }

    private static Set<String> setOf(String... hosts) {
        HashSet<String> set = new HashSet<>();
        Collections.addAll(set, hosts);
        return set;
    }
}
