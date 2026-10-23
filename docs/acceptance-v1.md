# 1.0.0 逐项验收（acceptance-v1）

由 `node scripts/accept-v1.mjs` 生成（证据：单测结果、压测与 a11y 报告、真实判官报告、CI 取回的桌面 / iOS / APK 清单、回归验收、源码与文档）。结论只有：通过 / 部分 / 待资质 / 待人工 / 待真机 / 失败。缺证书、缺开发者账号的项永远不记“通过”；人工与真机项不由执行者代填。

通过 17 · 部分 0 · 待资质 2 · 待人工 2 · 待真机 2 · 失败 0

生成时间：2026-10-23 21:35 CST；证据：CI run 39960746183（提交 7666424）的单测结果与回归验收（reports-1.0.0），取回的桌面 / iOS / APK 清单（app/docs/release/*-manifest-v1.json）。

| 编号 | 验收项 | 结论 | 证据 |
|---|---|---|---|
| E0 | CI：verify 含 i18n --strict 与 accept:v1；Windows / macOS / iOS 模拟器 runner；不用 android-actions/setup-android | 通过 | ✓ i18n-audit --strict（.github/workflows/ci.yml）<br>✓ CI 跑 accept:v1（.github/workflows/ci.yml）<br>✓ windows-latest runner（.github/workflows/ci.yml）<br>✓ macos-latest runner（.github/workflows/ci.yml）<br>✓ ios-simulator 作业（.github/workflows/ci.yml）<br>✓ 未使用 android-actions/setup-android<br>✓ 密钥扫描不被吞掉错误 |
| D1 | 桌面安装包：Electron Windows（NSIS）/ macOS（dmg），CI 产出 | 通过 | ✓ NSIS（desktop/package.json）<br>✓ dmg（desktop/package.json）<br>✓ 暂存脚本（后端 esbuild 单文件） 存在<br>✓ scripts/desktop-ci.sh 存在<br>✓ 已取回：win content-agent-1.0.0-win-x64-setup.exe、mac content-agent-1.0.0-mac-arm64.dmg |
| D2 | 安装 → 首启 → 备份恢复 → 卸载全流程截图 | 通过 | ✓ win（run 39960746183）：安装包 content-agent-1.0.0-win-x64-setup.exe 94432263 字节；首启 ✓、备份导出 353838 字节、恢复“已恢复：文件 101、数据集 22、设置 2。K”、safeStorage 可用且往返一致、卸载 ✓；截图 4 张（shots-v1/desktop-win/）<br>✓ mac（run 39960746183）：安装包 content-agent-1.0.0-mac-arm64.dmg 112025572 字节；首启 ✓、备份导出 353838 字节、恢复“已恢复：文件 101、数据集 22、设置 2。K”、safeStorage 可用且往返一致、卸载 ✓；截图 4 张（shots-v1/desktop-mac/）<br>✓ 冒烟脚本 desktop/smoke.cjs 存在 |
| D3 | Key 用 safeStorage（SecretBackend: electron-safeStorage） | 通过 | ✓ electron-safeStorage 后端（web/src/local/secretBackend.ts）<br>✓ 主进程 safeStorage 加密（desktop/main.cjs）<br>✓ safeStorage 单测：2 项，通过 2（vitest-web.json） |
| D4 | 代码签名 / 公证 | 待资质 | 📜 待资质：Windows 代码签名证书（没有则 SmartScreen 显示“未知发布者”）；macOS Developer ID + 公证（Apple 开发者账号）。当前安装包未签名，见 docs/desktop.md<br>✓ 文档写明“未知发布者”与所需资质（docs/desktop.md） |
| D5 | Windows / Mac 真机安装验证 | 待真机 | 📱 待真机：CI runner 上已做静默安装 / 首启 / 卸载；用户自己的 Windows 与 Mac 上双击安装、SmartScreen / Gatekeeper 提示待真机 |
| I1 | Capacitor iOS 构建（CI macOS runner 无签名模拟器构建能编译） | 通过 | ✓ scripts/ios-ci.sh 存在<br>✓ Swift 文件自动加入 App target 存在<br>✓ ios-build（run 39960746183）：xcodebuild 成功，App.app 1.0.0 (10000)，模拟器首启截图 ✓ |
| I2 | Key 进 Keychain（SecretBackend: ios-keychain，自写插件） | 通过 | ✓ mobile/native/ios/App/SecureKeysPlugin.swift 存在<br>✓ 仅本机、不随 iCloud 同步（mobile/native/ios/App/SecureKeysPlugin.swift）<br>✓ 插件已注册（mobile/native/ios/App/MainViewController.swift）<br>✓ ios-keychain 后端（web/src/local/secretBackend.ts）<br>✓ ios-keychain 单测：3 项，通过 3（vitest-web.json） |
| I3 | 内置网页用 SFSafariViewController | 通过 | ✓ iOS sheet 模式 = @capacitor/browser（iOS 实现即 SFSafariViewController）（web/src/builtin.ts）<br>✓ SFSafariViewController 单测：1 项，通过 1（vitest-web.json） |
| I4 | TestFlight 安装；通知、分享、内置网页真机验证 | 待资质 | 📜 待资质：Apple 开发者账号（签名、TestFlight，年费）<br>📱 待真机：iPhone 真机：通知、分享面板、SFSafariViewController 内登录与发布 |
| S1 | 存储治理：媒体配额与清理、版本修剪可视化 | 通过 | ✓ web/src/v9/media 存在<br>✓ 存储页 存在<br>✓ 存储单测：19 项，通过 19（vitest-web.json） |
| S2 | 1 GB 媒体下首屏 < 2 s | 待真机 | ✓ 1 GB 不可压缩媒体：首屏中位 480 ms（目标 2000；沙盒 Chromium headless + CDP CPU 降速模拟，不等于低端真机，CPU ×4）<br>📱 待真机：低端安卓真机复测 |
| F1 | 月度预算、按角色日上限、异常花费提醒（只提醒） | 通过 | ✓ shared/src/agent/policy.ts 存在<br>✓ 规则单测：7 项，通过 7（vitest-shared.json）<br>✓ 异常提醒单测：5 项，通过 5（vitest-shared.json） |
| F2 | 超预算一定先问；审计里每笔花费可追溯 | 通过 | ✓ 运行时单测：4 项，通过 4（vitest-shared.json）<br>✓ 审计可追溯单测：3 项，通过 3（vitest-web.json） |
| A1 | 文案统一 id 制、英文完整（英文缺失 0） | 通过 | ✓ id 1275，英文缺失 0，未知 id 0，写死中文 0，核心英文缺失 0<br>✓ i18n 单测：4 项，通过 4（vitest-shared.json） |
| A2 | axe 扫描 0 严重问题；读屏标签；ADR-007 重审 | 待人工 | ✓ axe 4.14.0：6 组（27 页 × 视口 × 语言），critical 0、serious 0<br>✓ ADR-007 重审（docs/adr/ADR-007.md）<br>👤 待人工：读屏软件（TalkBack / VoiceOver）人工走查 |
| G1 | 进化分级（ADR-014）：低风险自动生效、核心须确认、可回滚 | 通过 | ✓ docs/adr/ADR-014.md 存在<br>✓ shared 单测：9 项，通过 9（vitest-shared.json）<br>✓ web 单测：4 项，通过 4（vitest-web.json） |
| J1 | MiMo 判官复测 BQ-03 / 12 / 20 / 24（花费 ≤ ¥2，不含 Key） | 待人工 | ✓ judge-v1：live 28/32，本次 ¥0.114154，密钥命中 0<br>✓ BQ-20：通过<br>✓ BQ-24：通过<br>👤 待人工：BQ-03 仍不通过——修订建议 P-1 待你确认（design/proposals-v1.0.md）<br>👤 待人工：BQ-12 仍不通过——修订建议 P-1 待你确认（design/proposals-v1.0.md） |
| J2 | proposals-v1.0：已采纳修订 + 待确认修订（含改动对比、依据、风险、回滚） | 通过 | ✓ proposals-v1.0.md 存在<br>✓ 含 P-1（docs/proposals-v1.0.md） |
| X1 | 版本 1.0.0 / versionCode 10000 | 通过 | ✓ package.json 1.0.0<br>✓ desktop 1.0.0（desktop/package.json）<br>✓ mobile 1.0.0（mobile/package.json）<br>✓ versionCode 规则 x*10000+y*100+z（mobile/scripts/apply-native.mjs）<br>✓ APK：1.0.0 / 10000，4958825 字节（run 39960746183） |
| X2 | 文档：CHANGELOG、acceptance-v1、deviations-v1、ROADMAP 状态行、使用说明 .md/.docx、STATUS.md、截图矩阵 shots-v1 | 通过 | ✓ CHANGELOG 1.0.0（CHANGELOG.md）<br>✓ acceptance-v1.md 存在<br>✓ deviations-v1.md 存在<br>✓ ROADMAP 状态行含 1.0.0（docs/ROADMAP.md）<br>✓ 使用说明.md 含 1.0（使用说明.md）<br>✓ 使用说明.docx 存在<br>✓ docs/desktop.md 存在<br>✓ docs/ios.md 存在<br>✓ STATUS.md 含 1.0.0（CI 无项目根时跳过）<br>✓ shots-v1/ 截图矩阵（CI 无项目根时跳过） |
| X3 | 回归：accept:v9 / v10 / v11 失败 0 | 通过 | ✓ accept-v9：{"pass":43,"partial":9,"pending_device":2,"pending_key":2,"fail":0}<br>✓ accept-v10：{"通过":18,"待真机":7,"部分":1}<br>✓ accept-v11：{"通过":19,"部分":1,"待 Key":4,"待人工":1,"待真机":0,"失败":0} |
| X4 | 硬边界：不做多账号 / 自动互动 / 刷量 / 绕风控 / 抓私有数据；发布用户点击；回复只草稿；不部署 154.8.183.93；不写入真实密钥 | 通过 | ✓ 内置工具无对外写入<br>✓ CI 不部署 154.8.183.93<br>✓ 平台网页视图不注入脚本（冒烟只操作本 App 主界面）<br>✓ boundaries.ts 存在（server/src/boundaries.ts） |
