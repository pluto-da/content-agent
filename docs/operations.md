# 运维手册

## 1. 本地运行（开发/个人电脑）
```bash
npm ci
npm run build
npm start                     # http://127.0.0.1:8787
# 开发模式：npm run dev:server 与 npm run dev:web（5173 端口，代理 /api）
```
要求 Node ≥ 22.5（使用内置 `node:sqlite`）。

## 2. docker-compose
```bash
cp .env.example .env          # 设置 CA_ACCESS_TOKEN、CA_MASTER_KEY
docker compose up -d --build
```
- 默认只映射到 127.0.0.1:8787。手机/平板访问需改端口映射为 `8787:8787` 并**务必设置访问口令**，建议再加 HTTPS 反向代理（Caddy/Nginx）。
- 数据卷 `./data`：数据库、加密密钥库、主密钥、日志、生成的媒体、自动备份。
- **不要部署到 408 站生产服务器（154.8.183.93）**；请使用单独的机器或容器。

## 3. 环境变量
| 变量 | 说明 |
|---|---|
| PORT / HOST | 监听端口与地址（默认 8787 / 127.0.0.1；容器内 0.0.0.0） |
| CA_DATA_DIR | 数据目录 |
| CA_ACCESS_TOKEN | 访问口令（局域网/服务器部署必填） |
| CA_MASTER_KEY | 密钥库主密钥；不填则自动生成 data/master.key（权限 600） |
| CA_SCHEDULER | 1 = 启用内置采集调度 |
| CA_LOG_ECHO | 1 = 日志同时输出到标准输出 |

## 4. 升级
```bash
git pull && npm ci && npm run build && 重启
```
数据库表结构使用 `CREATE TABLE IF NOT EXISTS`，向后兼容新增表；大版本升级前先导出备份。

## 4.1 电脑 App 的登录数据
- 位置：系统应用数据目录（Windows `%APPDATA%/内容运营助手`，macOS `~/Library/Application Support/内容运营助手`）下的 `Partitions/creator-<平台>`，以及记录上次地址的 `creator-state.json`。
- 升级安装不会清理；修改 `productName` 会改变该目录，导致需要重新登录。

## 4.2 移动端原生插件
- `npx cap add android|ios` 之后运行 `node mobile/scripts/apply-native.mjs`（`scripts/build-android-debug.sh` / `build-ios.sh` 已自动调用）：写入 LocalApps 插件、Android `<queries>` 与 FileProvider、iOS `LSApplicationQueriesSchemes`。
- iOS 首次需在 Xcode 中把 `LocalAppsPlugin.swift`、`MainViewController.swift` 加入 App target。
- 额外 Android 包名：`CA_EXTRA_PACKAGES=com.a.b,com.c.d`。

## 5. 备份与恢复
- 界面：偏好 → 备份 → 导出 / 导入（导入前自动备份到 `data/backups/`）。
- 备份包含本地应用登记（`local_apps`），不包含任何平台登录信息。
- 文件级：停止服务后复制整个 `data/` 目录。**主密钥丢失将无法解密密钥库**，需重新填写各平台密钥。

## 6. 排障
| 现象 | 处理 |
|---|---|
| 模块显示“未配置” | 模型 → 路由 选择提供方并填写密钥 |
| 公众号接口 40164 / 61004 | 把服务器出口 IP 加入微信开发者平台的 API IP 白名单 |
| 境外模型超时 | 偏好 → 通用 → 代理 填写本机 VPN 客户端 HTTP 代理，并确认该提供方开启“经代理” |
| 热榜显示“robots 禁止” | 这是遵守对方 robots.txt 的结果，系统不会绕过 |
| 任务失败 | 任务与日志页查看错误原因与重试次数 |

## 7. CI
`bash scripts/ci.sh`：lint → typecheck → 测试与覆盖率 → 构建 → 前端包密钥扫描 → npm audit。GitHub Actions 配置见 `.github/workflows/ci.yml`（含 Android 调试 APK 构建作业）。
