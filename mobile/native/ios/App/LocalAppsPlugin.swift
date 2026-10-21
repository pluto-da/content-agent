import Foundation
import Capacitor
import UIKit

/// 本地应用插件（iOS）。
/// - canOpen：UIApplication.canOpenURL，只对 Info.plist 中 LSApplicationQueriesSchemes 声明的 Scheme 有效。
/// - launch：用 URL Scheme 打开 App。
/// - share：系统分享面板（UIActivityViewController），附带文字与媒体文件。
///   iOS 不允许把分享定向到某个指定 App，由用户在分享面板中选择；发布由用户本人在 App 内完成。
@objc(LocalAppsPlugin)
public class LocalAppsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocalAppsPlugin"
    public let jsName = "LocalApps"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "canOpen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "launch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
    ]

    private func safeURL(_ s: String) -> URL? {
        let lower = s.lowercased()
        for bad in ["javascript:", "data:", "file:", "vbscript:", "about:"] where lower.hasPrefix(bad) { return nil }
        guard s.contains("://"), let u = URL(string: s) else { return nil }
        return u
    }

    @objc func canOpen(_ call: CAPPluginCall) {
        guard let u = safeURL(call.getString("url") ?? "") else { call.reject("URL Scheme 格式不正确"); return }
        DispatchQueue.main.async { call.resolve(["canOpen": UIApplication.shared.canOpenURL(u)]) }
    }

    @objc func launch(_ call: CAPPluginCall) {
        guard let u = safeURL(call.getString("url") ?? "") else { call.reject("URL Scheme 格式不正确"); return }
        DispatchQueue.main.async {
            UIApplication.shared.open(u, options: [:]) { ok in ok ? call.resolve() : call.reject("无法打开应用（未安装或未声明 Scheme）") }
        }
    }

    @objc func share(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        let files = call.getArray("files", JSObject.self) ?? []
        let headers = call.getObject("headers") ?? [:]
        DispatchQueue.global().async {
            var items: [Any] = []
            if !text.isEmpty { items.append(text) }
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("share", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            for (n, f) in files.prefix(9).enumerated() {
                guard let s = f["url"] as? String, let u = URL(string: s), ["http", "https"].contains(u.scheme ?? "") else { continue }
                var req = URLRequest(url: u)
                for (k, v) in headers { if let v = v as? String { req.setValue(v, forHTTPHeaderField: k) } }
                let sem = DispatchSemaphore(value: 0)
                var data: Data?
                URLSession.shared.dataTask(with: req) { d, _, _ in data = d; sem.signal() }.resume()
                _ = sem.wait(timeout: .now() + 60)
                let name = ((f["name"] as? String) ?? "file-\(n)").replacingOccurrences(of: "/", with: "_")
                let out = dir.appendingPathComponent(name)
                if let data = data, (try? data.write(to: out)) != nil { items.append(out) }
            }
            DispatchQueue.main.async {
                guard let vc = self.bridge?.viewController else { call.reject("界面未就绪"); return }
                let avc = UIActivityViewController(activityItems: items, applicationActivities: nil)
                avc.popoverPresentationController?.sourceView = vc.view
                avc.popoverPresentationController?.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 0, height: 0)
                avc.completionWithItemsHandler = { activity, done, _, _ in call.resolve(["completed": done, "activity": activity?.rawValue ?? ""]) }
                vc.present(avc, animated: true)
            }
        }
    }
}
