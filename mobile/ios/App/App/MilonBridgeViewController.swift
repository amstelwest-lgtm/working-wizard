import Capacitor
import WebKit

/// Remote-URL shell. Injects www/shell.js and registers the external-URL plugin.
class MilonBridgeViewController: CAPBridgeViewController {
    static var launchURL: String?

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MilonShellPlugin())
        injectShell()
    }

    private func injectShell() {
        guard let webView else { return }
        guard let file = Bundle.main.url(forResource: "shell", withExtension: "js", subdirectory: "public"),
              let source = try? String(contentsOf: file, encoding: .utf8) else {
            return
        }
        let launch = MilonBridgeViewController.launchURL.map(jsQuote) ?? "null"
        let script = WKUserScript(
            source: "window.__MILON_LAUNCH_URL__ = \(launch);\n\(source)",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        webView.configuration.userContentController.addUserScript(script)
    }

    private func jsQuote(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value])
        guard let data, let text = String(data: data, encoding: .utf8), text.count >= 2 else {
            return "null"
        }
        return String(text.dropFirst().dropLast())
    }
}
