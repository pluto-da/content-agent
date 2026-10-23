# 桌面安装包（1.0.0，Windows / macOS，未签名）

## 怎么得到
- CI 作业 `desktop`（windows-latest / macos-latest）每次推 main 都会：构建 → 静默安装 → 首启冒烟（首启、我的 → 备份：导出 zip、再从这个 zip 恢复，每步截图）→ 卸载并检查 → 把产物推到分支 `desktop-build-win` / `desktop-build-mac`。
- 取回：`git clone --depth 1 --branch desktop-build-win https://github.com/pluto-da/content-agent.git`，安装包按 45 MB 切片（GitHub 单文件上限 100 MB）：
  - Windows（PowerShell）：`cmd /c copy /b content-agent-1.0.0-win-x64-setup.exe.part-* content-agent-1.0.0-win-x64-setup.exe`；macOS / Linux：`cat content-agent-1.0.0-mac-arm64.dmg.part-* > content-agent-1.0.0-mac-arm64.dmg`；
  - 用同目录的 `.sha256` 校验（`certutil -hashfile 文件 SHA256` / `shasum -a 256 文件`）。
- 本机自己打：`bash scripts/build-desktop.sh win`（在 Windows 上）或 `bash scripts/build-desktop.sh mac`（在 macOS 上）。

## 包里有什么
- Electron 39 外壳（desktop/main.cjs），本机后端由 `scripts/stage-desktop.mjs` 用 esbuild 打成单文件 `server/dist/index.mjs`（只监听 127.0.0.1，数据在系统应用数据目录），加上 web/dist 与 agent/ 默认设定。不再整份复制 node_modules。
- Key 加密：SecretBackend `electron-safeStorage`——Windows DPAPI、macOS 钥匙串；首次在桌面端用到 Key 时把旧 WebCrypto 密文一次性迁入，失败则继续用 WebCrypto 并在“诊断”里说明原因。
- macOS 包是 Apple 芯片（arm64）版；Intel Mac 需要另打 x64 或 universal 包（未做）。

## 没有代码签名证书时会看到什么
- **Windows**：双击安装包，SmartScreen 显示“Windows 已保护你的电脑 / 未知发布者”。点“更多信息 → 仍要运行”。安装为当前用户（无需管理员），装在 `%LOCALAPPDATA%\Programs\`。卸载：设置 → 应用 → 超级工作台 → 卸载（数据目录默认保留，备份在 我的 → 备份）。
- **macOS**：未签名、未公证，首次打开提示“无法验证开发者”。在访达里右键 → 打开 → 打开；或 系统设置 → 隐私与安全性 → “仍要打开”。卸载：把 /Applications/超级工作台.app 拖进废纸篓（数据在 ~/Library/Application Support/）。

## 去掉提示需要的资质（需要你本人办理）
| 平台 | 需要 | 说明 |
|---|---|---|
| Windows | 代码签名证书（OV 或 EV；EV 能更快通过 SmartScreen 信誉） | 向 CA 购买，需企业或个人身份验证；拿到后在 CI 配 `CSC_LINK` / `CSC_KEY_PASSWORD` 即可签名 |
| macOS | Apple 开发者账号（年费）→ Developer ID Application 证书 + 公证（notarytool） | 配 `CSC_LINK`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`，去掉 package.json 里的 `identity: null` |

## 冒烟做了什么、没做什么
- 做了：在 GitHub 的 Windows / macOS 虚拟机里真实安装、启动、导出备份、恢复备份、卸载；截图见 shots-v1/desktop-win、shots-v1/desktop-mac；结果 smoke.json。冒烟只在设置 `CA_SMOKE_DIR` 时运行，只操作本 App 主界面，不打开任何平台网页。
- 没做：你的真机上双击安装（SmartScreen / Gatekeeper 的真实弹窗）、平台网页内登录——待真机。
