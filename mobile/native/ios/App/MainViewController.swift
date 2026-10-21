import UIKit
import Capacitor

/// 注册本地插件 LocalApps（Main.storyboard 的视图控制器类由 apply-native.mjs 改为本类）。
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LocalAppsPlugin())
    }
}
