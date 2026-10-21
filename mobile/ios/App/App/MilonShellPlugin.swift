import AuthenticationServices
import AVFoundation
import Capacitor
import LocalAuthentication
import SafariServices
import UIKit
import UniformTypeIdentifiers
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
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "takePhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickDocument", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "biometricAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "biometricEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBiometricEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlockWithBiometric", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushConfigured", returnType: CAPPluginReturnPromise),
    ]

    private var session: ASWebAuthenticationSession?
    private var safari: SFSafariViewController?
    private var photoCall: CAPPluginCall?
    private var documentCall: CAPPluginCall?

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

    @objc func takePhoto(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.beginPhoto(call) }
    }

    @objc func pickDocument(_ call: CAPPluginCall) {
        DispatchQueue.main.async { self.beginDocument(call) }
    }

    private func beginPhoto(_ call: CAPPluginCall) {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            call.reject("Camera is not available")
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            presentCamera(call)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    if granted {
                        self.presentCamera(call)
                    } else {
                        call.reject("Camera permission was denied")
                    }
                }
            }
        default:
            call.reject("Camera permission was denied")
        }
    }

    private func presentCamera(_ call: CAPPluginCall) {
        guard let host = bridge?.viewController else {
            call.reject("Camera is not available")
            return
        }
        photoCall?.resolve(["cancelled": true])
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        picker.delegate = self
        photoCall = call
        host.present(picker, animated: true)
    }

    private func beginDocument(_ call: CAPPluginCall) {
        guard let host = bridge?.viewController else {
            call.reject("Document picker is not available")
            return
        }
        documentCall?.resolve(["cancelled": true])
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: Self.documentTypes, asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        documentCall = call
        host.present(picker, animated: true)
    }

    private static let documentTypes: [UTType] = [.pdf, .jpeg, .png, .webP, .heic, .heif]
    private static let maxBytes = 20 * 1024 * 1024

    fileprivate func finishPhoto(image: UIImage?, cancelled: Bool) {
        guard let call = photoCall else { return }
        photoCall = nil
        if cancelled || image == nil {
            call.resolve(["cancelled": true])
            return
        }
        guard let data = image?.jpegData(compressionQuality: 0.85) else {
            call.resolve(["cancelled": false, "error": "The photo could not be read."])
            return
        }
        if data.count > Self.maxBytes {
            call.resolve(["cancelled": false, "error": "This file is over 20 MB."])
            return
        }
        call.resolve([
            "cancelled": false,
            "name": "receipt-\(Int(Date().timeIntervalSince1970)).jpg",
            "mime": "image/jpeg",
            "base64": data.base64EncodedString(),
        ])
    }

    fileprivate func finishDocument(url: URL?, cancelled: Bool) {
        guard let call = documentCall else { return }
        documentCall = nil
        guard let url, !cancelled else {
            call.resolve(["cancelled": true])
            return
        }
        let allowed = ["pdf", "jpg", "jpeg", "png", "webp", "heic", "heif"]
        let ext = url.pathExtension.lowercased()
        guard allowed.contains(ext) else {
            call.resolve(["cancelled": false, "error": "Use a PDF or a photo (JPEG, PNG, WebP, or HEIC)."])
            return
        }
        do {
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            let values = try url.resourceValues(forKeys: [.fileSizeKey])
            if let size = values.fileSize, size > Self.maxBytes {
                call.resolve(["cancelled": false, "error": "This file is over 20 MB."])
                return
            }
            let data = try Data(contentsOf: url)
            if data.count > Self.maxBytes {
                call.resolve(["cancelled": false, "error": "This file is over 20 MB."])
                return
            }
            if data.isEmpty {
                call.resolve(["cancelled": false, "error": "This file is empty."])
                return
            }
            let mime = UTType(filenameExtension: ext)?.preferredMIMEType ?? ""
            call.resolve([
                "cancelled": false,
                "name": url.lastPathComponent,
                "mime": mime,
                "base64": data.base64EncodedString(),
            ])
        } catch {
            call.resolve(["cancelled": false, "error": "The file could not be opened."])
        }
    }
}

extension MilonShellPlugin: UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        finishPhoto(image: nil, cancelled: true)
    }

    public func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
        let image = info[.originalImage] as? UIImage
        picker.dismiss(animated: true)
        finishPhoto(image: image, cancelled: false)
    }
}

extension MilonShellPlugin {
    private static let biometricKey = "milon_biometric_lock"

    @objc func pushConfigured(_ call: CAPPluginCall) {
        let configured = Bundle.main.object(forInfoDictionaryKey: "MilonPushConfigured") as? Bool ?? false
        call.resolve(["configured": configured])
    }

    @objc func biometricAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": canUseBiometric()])
    }

    @objc func biometricEnabled(_ call: CAPPluginCall) {
        call.resolve(["enabled": UserDefaults.standard.bool(forKey: Self.biometricKey)])
    }

    @objc func setBiometricEnabled(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        guard canUseBiometric() else {
            call.resolve(["ok": false, "message": "This device has no Face ID or Touch ID."])
            return
        }
        evaluateBiometric(reason: enabled ? "Lock Milōn on this device." : "Unlock Milōn on this device.") { success in
            if success {
                UserDefaults.standard.set(enabled, forKey: Self.biometricKey)
            }
            call.resolve(success
                ? ["ok": true]
                : ["ok": false, "message": "That didn't unlock. Try again."])
        }
    }

    @objc func unlockWithBiometric(_ call: CAPPluginCall) {
        guard UserDefaults.standard.bool(forKey: Self.biometricKey) else {
            call.resolve(["ok": true])
            return
        }
        guard canUseBiometric() else {
            call.resolve(["ok": false, "message": "Biometric unlock isn't available on this device."])
            return
        }
        evaluateBiometric(reason: "Unlock Milōn on this device.") { success in
            call.resolve(success
                ? ["ok": true]
                : ["ok": false, "message": "That didn't unlock. Try again."])
        }
    }

    private func canUseBiometric() -> Bool {
        let context = LAContext()
        var error: NSError?
        return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
    }

    private func evaluateBiometric(reason: String, done: @escaping (Bool) -> Void) {
        let context = LAContext()
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, _ in
            DispatchQueue.main.async { done(success) }
        }
    }
}

extension MilonShellPlugin: UIDocumentPickerDelegate {
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishDocument(url: nil, cancelled: true)
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finishDocument(url: urls.first, cancelled: false)
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
