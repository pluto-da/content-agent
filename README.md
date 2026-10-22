# 内容运营助手 Content Agent（合规版 MVP）

多平台（抖音、小红书、视频号、公众号、闲鱼、X、知乎）内容获取与运营助手：采集公开信息与官方接口数据 → 热点发现与调研 → 选题 → 多平台改写（含配图、配音、字幕）→ 审核 → 发布交接。**最后一步“发布”和任何评论/私信的“发送”，永远由你本人完成。**

## 硬边界（写在代码里，配置无法放宽）
不做反检测/拟人化点击/指纹伪装/绕过风控与验证码；不自动点赞、评论、私信、关注；不做多账号；不抓取登录后的私有数据；只走官方接口、RSS、公开网页（遵守 robots 并限速）与你自己导出的数据；闲鱼只生成文案；发布只推草稿箱或复制跳转；回复只生成草稿；密钥加密保存、不进 Git。

## 快速开始
```bash
npm ci
npm run build
npm start                 # 打开 http://127.0.0.1:8787
```
- 首次打开所有模型模块显示“未配置”：到 **模型 → 路由** 选择提供方（可先选 Mock 体验流程），到 **模型 → 密钥** 填写各平台密钥。
- 演示流程（Mock 模型 + 真实公开 RSS 与热榜）：`npm run e2e`
- Docker：`cp .env.example .env && docker compose up -d --build`

## 接入小米 MiMo（0.4.1）
1. 模型 → 密钥：填“小米 MiMo API Key”（或服务器环境变量 `MIMO_API_KEY`）。
2. 模型 → 路由：文本/对话、视觉理解选“小米 MiMo”，默认 `mimo-v2.6-flash`，可下拉选 `mimo-v2.6-pro`；Token Plan Key（tp-/ttp-）把“接入地址”切到 Token Plan。
3. 真实联调：`MIMO_API_KEY=sk-xxx npm run mimo:smoke`，报告在 `out/mimo-smoke-report.json`。
细节（max_completion_tokens、thinking 开关、json_object 降级、缓存命中、默认价）见 [docs/models.md](docs/models.md#小米-mimo-接入041)。

## 界面结构（0.5.0「一个前台」）
- 没有“后台/设置中心”。侧栏 8 项：工作流（今天、灵感、创作、复盘）+ 工作台（平台、模型、Agent、偏好）；页内用标签细分（每页 ≤3）。旧地址（`#settings/*`、`#review` 等）自动跳到新位置。
- “添加软件”固定在侧栏底部（手机在“更多”抽屉底部和右下“＋”里），三步登记官方 App；只打开 App 或调用系统分享。
- ⌘K / Ctrl+K 搜索 8 个页面和标签，旧名称（设置、密钥、插件、运行状态…）也能搜到。

## 三端
| 端 | 形态 | 构建 |
|---|---|---|
| 电脑（Win/Mac） | Electron，内置后端，创作中心为独立持久登录分区的 webview（登录保持到你手动退出），可登记本机官方 App | `npm run app:desktop -- win` / `mac`（需在对应系统上构建） |
| 手机/平板（Android/iOS） | Capacitor，连接你电脑或服务器上的后端；可打开/分享草稿到本机官方 App | `npm run app:android`（生成调试 APK）/ `npm run app:ios`（需 macOS + Xcode） |
| 浏览器 | PWA，可添加到主屏幕、离线只读 | `npm start` |

## 目录
```
server/   后端（Fastify + SQLite）：sources、models、modules、skills、queue …
web/      前端（React + Vite PWA），三端共用
agent/    Agent 系统文件：soul.md、working-method.md、USER.md、APPROVAL.md、skills/、memory/、evals/
desktop/  Electron 外壳        mobile/  Capacitor 配置
docs/     架构、接口、运维、模型提供方      scripts/  CI、打包、APP 构建
```

## 质量
`npm run ci`：lint、typecheck、单元测试与覆盖率、构建、前端包密钥扫描、依赖审计。

## 文档
- [docs/architecture.md](docs/architecture.md) 架构图与关键设计
- [docs/api.md](docs/api.md) 接口文档
- [docs/operations.md](docs/operations.md) 运维手册
- [docs/models.md](docs/models.md) 模型提供方地址与适配情况
- [使用说明.md](使用说明.md) 各平台官方密钥申请与配置
- [CHANGELOG.md](CHANGELOG.md)
