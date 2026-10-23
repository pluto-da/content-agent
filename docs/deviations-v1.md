# 1.0.0 偏离与未完成项（deviations-v1）

更新：2026-10-23（CST）。对照 design/ROADMAP.md「1.0」。逐项证据见 design/acceptance-v1.md（scripts/accept-v1.mjs 生成）。

| 编号 | ROADMAP 要求 | 实际 | 原因 / 需要什么 |
|---|---|---|---|
| V1-1 | 桌面**签名**安装包 | 未签名（Windows NSIS、macOS dmg） | 没有 Windows 代码签名证书、没有 Apple 开发者账号（Developer ID + 公证）。Windows 安装会提示“未知发布者”，macOS 首次需右键 → 打开。拿到证书后只需在 CI 配环境变量（docs/desktop.md） |
| V1-2 | 安装 → 首启 → 备份恢复 → 卸载全流程截图 | 在 GitHub 的 Windows / macOS 虚拟机上自动完成并截图（smoke.json + 4 张图 + 卸载检查） | 不是你的真机；SmartScreen / Gatekeeper 真弹窗、双击安装体验待真机 |
| V1-3 | macOS 安装包 | 只打 Apple 芯片（arm64）版 | macos-latest runner 是 arm64；Intel Mac 需要 x64 / universal 包（体积约翻倍），未做 |
| V1-4 | 安装包放进仓库分支 | 按 45 MB 切片 + sha256 推到 desktop-build-win / desktop-build-mac | GitHub 单文件上限 100 MB，安装包约 95–112 MB |
| V1-5 | iOS TestFlight 安装；通知、分享、内置网页真机验证 | 只做了 CI 无签名模拟器构建（能编译、模拟器能启动并截图） | 需要 Apple 开发者账号与 iPhone 真机 |
| V1-6 | iOS Key 进 Keychain | 已实现（SecureKeysPlugin.swift），单测用假插件；模拟器里编译通过 | 钥匙串在重启、App 更新、换机恢复后的真实行为待真机 |
| V1-7 | 低端机 1 GB 媒体下首屏 < 2 s | 沙盒 Chromium + CPU 4 倍降速：首屏中位 480 ms | 不等于低端安卓真机，待真机复测 |
| V1-8 | axe 0 严重问题 | critical 0 / serious 0（自动扫描） | 读屏软件（TalkBack / VoiceOver）人工走查未做 |
| V1-9 | 判官复测（第一部分收尾） | BQ-20、BQ-24 通过；BQ-03、BQ-12 仍不通过；新出 BQ-10、BQ-23 | 改 AGENTS / SYSTEM 属高风险，须你确认（design/proposals-v1.0.md P-1、P-2）；BQ-23 是评测不给工具所致，建议改评测说明 |
| V1-10 | 判官人工抽检 20% | 抽检表 evals/real/judge-sample-v1.md 已生成 | 由你填写，执行者是 AI，不代填 |
| V1-11 | CI 时长与额度 | 新增 Windows（2× 计费）与两个 macOS 作业（10× 计费，私有库） | 每次推 main 都会跑；如额度紧张，可把 desktop / ios-simulator 改为只在打 tag 或手动触发时运行 |
| V1-12 | 桌面冒烟导出、恢复全过 | 已过（Windows 修复后） | Windows 上导出报 Internal error.：静默安装后自动启动的实例与冒烟实例共用 userData，本机数据库互锁。已加单实例锁、固定端口、退出收后端；冒烟前结束遗留实例。用户真机上若曾在 1.0 修复前装过并多开，旧数据在旧端口来源下，固定端口后不会自动合并（1.0 之前每次启动端口都变，本就留不住数据） |

**明确没做（硬边界）**：多账号 / 团队、自动点赞评论私信关注、刷量、绕风控、抓登录后私有数据、替你点击发布；不部署 154.8.183.93；仓库与产物不含真实密钥。
