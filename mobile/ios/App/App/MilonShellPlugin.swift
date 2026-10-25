import AuthenticationServices
import Capacitor
import SafariServices
import WebKit

/**
 * Opens Google, Apple, Supabase authorize, Stripe, and ledger hosts outside
 * the WKWebView. The PKCE verifier stays in the WebView. iOS 17.4 and later
 * hand the https return back through ASWebAuthenticationSession. Older
 * systems use SFSafariViewController and depend on a Universal Link.
 *
 * Keep the host list aligned with MilonExternalUrls.java.
 */
@objc(MilonShellPlugin)
public class MilonShellPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "MilonShellPlugin"
    public let jsName = "MilonShell"
    public let pluginMethods: [CAPPluginMethod] = []

    private var session: ASWebAuthenticationSession?
    private var safari: SFSafariViewController?

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.webView?.window ?? ASPresentationAnchor()
    }

    public override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url else { return nil }
        guard MilonExternalUrls.shouldOpenOutside(url) else { return nil }
        let target = MilonExternalUrls.customTabTarget(url)
        if MilonExternalUrls.isYouTube(target) {
            DispatchQueue.main.async { self.openSafari(target) }
        } else {
            openOutside(target)
        }
        return NSNumber(value: true)
    }

    func closeBrowser() {
        session?.cancel()
        session = nil
        if let safari {
            bridge?.viewController?.dismiss(animated: true)
            self.safari = nil
        }
    }

    private func openOutside(_ url: URL) {
        DispatchQueue.main.async {
            if #available(iOS 17.4, *) {
                self.openAuthenticationSession(url)
            } else {
                self.openSafari(url)
            }
        }
    }

    @available(iOS 17.4, *)
    private func openAuthenticationSession(_ url: URL) {
        // The https callback matches this path. webcredentials on the host is
        // what lets the system hand it back. Query strings are not part of the path.
        let callback = ASWebAuthenticationSession.Callback.https(
            host: "www.milonfinance.com",
            path: MilonExternalUrls.returnPath(for: url)
        )
        let next = ASWebAuthenticationSession(url: url, callback: callback) { [weak self] callbackURL, _ in
            self?.session = nil
            guard let callbackURL else { return }
            DispatchQueue.main.async {
                self?.bridge?.webView?.load(URLRequest(url: callbackURL))
            }
        }
        next.presentationContextProvider = self
        next.prefersEphemeralWebBrowserSession = false
        session = next
        if !next.start() {
            session = nil
            openSafari(url)
        }
    }

    private func openSafari(_ url: URL) {
        let controller = SFSafariViewController(url: url)
        controller.dismissButtonStyle = .close
        safari = controller
        bridge?.viewController?.present(controller, animated: true)
    }
}

enum MilonExternalUrls {
    private static let youtube: Set<String> = [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtu.be",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
    ]

    private static let ledger: Set<String> = [
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
        "accounting.sageone.co.za",
    ]

    private static let apple: Set<String> = [
        "appleid.apple.com",
        "idmsa.apple.com",
    ]

    static func isYouTube(_ url: URL) -> Bool {
        youtube.contains((url.host ?? "").lowercased())
    }

    /// Path the system browser must land on for this hop to count as done.
    static func returnPath(for url: URL) -> String {
        let host = (url.host ?? "").lowercased()
        if host == "checkout.stripe.com" { return "/billing/success" }
        if host.contains("intuit.com") { return "/api/qbo/callback" }
        if host.contains("xero.com") { return "/api/xero/callback" }
        return "/auth/callback"
    }

    static func isReturn(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https" else { return false }
        let host = (url.host ?? "").lowercased()
        return host == "www.milonfinance.com" || host == "milonfinance.com"
    }

    static func shouldOpenOutside(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "https", let host = url.host?.lowercased(), !host.isEmpty else {
            return false
        }
        if host == "accounts.google.com" || host.hasPrefix("accounts.google.") { return true }
        if apple.contains(host) { return true }
        if isSupabaseAuth(host: host, path: url.path) { return true }
        if youtube.contains(host) || ledger.contains(host) { return true }
        return false
    }

    static func customTabTarget(_ url: URL) -> URL {
        let host = (url.host ?? "").lowercased()
        guard host == "www.youtube-nocookie.com" || host == "youtube-nocookie.com" else { return url }
        let path = url.path
        guard path.hasPrefix("/embed/") else { return url }
        var id = String(path.dropFirst("/embed/".count))
        if let slash = id.firstIndex(of: "/") {
            id = String(id[..<slash])
        }
        guard !id.isEmpty, let watch = URL(string: "https://www.youtube.com/watch?v=\(id)") else { return url }
        return watch
    }

    private static func isSupabaseAuth(host: String, path: String) -> Bool {
        if host.hasSuffix(".supabase.co") && path.hasPrefix("/auth/") { return true }
        return host == "auth.milonfinance.com" && path.hasPrefix("/auth/v1/")
    }
}
