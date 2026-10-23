# iOS（1.0.0）

## 现在能做到的
- CI 作业 `ios-simulator`（macos-latest）：`npx cap add ios` → `cap sync` → `mobile/scripts/apply-native.mjs ios`（复制 LocalApps、SecureKeys、MainViewController 三个 Swift 文件并用 xcodeproj gem 加入 App target；写 LSApplicationQueriesSchemes；版本号 1.0.0 / 10000）→ **无签名模拟器构建**（`xcodebuild -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO`）→ 在模拟器里安装、启动、截图。结果推到分支 `ios-build`（ios-build.json、xcodebuild.log、ios-sim-first-run.png）。
- Key：SecretBackend `ios-keychain`——自写插件 `SecureKeysPlugin.swift`，256 位主密钥存 iOS 钥匙串（`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`：仅本机、不随 iCloud 钥匙串同步、不进备份），CryptoKit AES-256-GCM 加解密；WebView 拿不到主密钥。旧 WebCrypto 密文首次使用时一次性迁入，失败回退并提示。
- 内置网页：iOS 上用 `@capacitor/browser`，其 iOS 实现就是 SFSafariViewController（系统 Safari 视图，Cookie 与 Safari 共享，本 App 读不到页面内容）。

## 还需要你提供
| 项 | 需要 |
|---|---|
| 装到自己的 iPhone、TestFlight | Apple 开发者账号（年费）；签名证书与描述文件；App Store Connect 建 App |
| 真机验证 | iPhone 一台：通知、分享面板、SFSafariViewController 内登录与发布、钥匙串在重启 / 更新后仍可解密 |

拿到账号后：在 Xcode 打开 mobile/ios/App/App.xcworkspace（或 .xcodeproj）选 Team，Product → Archive → 上传 TestFlight；或在 CI 加 `xcodebuild archive` + `-exportArchive` 与 App Store Connect API Key。
