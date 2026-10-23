import UIKit
import Capacitor

/// 注册本地插件 LocalApps、SecureKeys（1.0 ios-keychain）（Main.storyboard 的视图控制器类由 apply-native.mjs 改为本类）。
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LocalAppsPlugin())
        bridge?.registerPluginInstance(SecureKeysPlugin())
    }
}
