import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        if let activity = connectionOptions.userActivities.first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb }),
           let url = activity.webpageURL,
           MilonExternalUrls.isReturn(url) {
            MilonBridgeViewController.launchURL = url.absoluteString
        }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = MilonBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
           let url = userActivity.webpageURL,
           MilonExternalUrls.isReturn(url) {
            if let root = window?.rootViewController as? MilonBridgeViewController {
                (root.bridge?.plugin(withName: "MilonShell") as? MilonShellPlugin)?.closeBrowser()
                root.webView?.load(URLRequest(url: url))
            }
        }
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
