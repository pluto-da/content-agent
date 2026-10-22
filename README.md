# 超级工作台（原“内容运营助手 Content Agent”）

多平台（抖音、小红书、视频号、公众号、知乎、B站、快手、闲鱼、X）内容获取与运营助手：采集公开信息与官方接口数据 → 热点发现与调研 → 选题 → 多平台改写（含配图、配音、字幕）→ 审核 → 发布交接。**最后一步“发布”和任何评论/私信的“发送”，永远由你本人完成。**

## 硬边界（写在代码里，配置无法放宽）
不做反检测/拟人化点击/指纹伪装/绕过风控与验证码；不自动点赞、评论、私信、关注；不做多账号；不抓取登录后的私有数据；只走官方接口、RSS、公开网页（遵守 robots 并限速）与你自己导出的数据；闲鱼只生成文案；发布只推草稿箱或复制跳转；回复只生成草稿；密钥加密保存、不进 Git。

## 0.8.1：热修 + 深度修复 + 动效
在“我的 → 模型”保存后首页 Agent 立即可用（不用刷新）；常驻组件统一订阅本机数据变更；有 Key 即视为已配置（未测试只提示）；手机 / 平板触控目标统一 ≥44px；克制的界面动效（遵守“减少动态”）。详见 CHANGELOG。

## 0.8.0：超级工作台
一个 Agent 帮你管理各大平台：找热点、写内容、准备发布、记录效果；发布由你本人点击。
- **布局**：左侧平台栏（已登记平台 + 角标 + 长按菜单 + 排序，底部 添加平台 / Agent / 我的）；主区是平台官方网页（安卓：原生 WebView 叠放在主界面矩形上，每平台独立 Profile、保活 LRU；电脑：每平台一个 WebContentsView，分区 `persist:creator-<id>`，无 preload）；Agent 在平板 / 电脑右侧常驻，手机与平板竖屏为底部抽屉。手机平台栏收在“☰”抽屉。网页版不能内嵌平台页面，改为新标签页打开。
- **Agent**：OpenAI 兼容 function calling 多步循环（每轮 ≤8 次工具、单工具 60 s、整轮 3 min），流式回复（安卓原生 StreamHttp 插件 / 网页 fetch ReadableStream，共用 shared/stream.ts），不支持 tools 的服务自动降级为 JSON 指令模式；工具卡片（热点、分析、草稿、检查、发布、数据、画像、进度、确认）；会话历史；会话内换模型；账号画像、技能路由、发布前质量门禁、任务检查点“接着上次继续”、工作台总览卡（不调用模型）。
- **权限**：L0/L1 直接执行、卡片可见；L2 先出确认卡（可“记住此类”）；**不存在 L3 对外写入工具**——publish_prepare 只做到“文案已复制 + 已打开发布页”，publish_mark 只能由用户点击“我已发布”触发。
- **发给 Agent**：网页工具栏按钮（只发网址 / 标题 / 平台）、安卓 PROCESS_TEXT 选中文字菜单与 ACTION_SEND 分享目标、电脑右键菜单；均先预览后确认，进入素材箱与会话。
- **热点五路**：a 第三方数据服务（用户自己的 Key，WebCrypto AES-GCM 本机加密）、b 平台官方接口（抖音开放平台热点词）、c 分享进来、d 公开榜单与 RSS（遵守 robots）、e 用户本人翻看的热点巡视；清洗 / 去重 / 聚类 / 评分 / 角度 / 分平台选题，每条标注来源与路数。
- **硬边界**：不读取平台页面内容 / Cookie 值、不注入脚本、不自动填表或点击、不自动发布或互动、不多账号、不切 UA、不绕风控；密钥只显示末四位，不进 Git、日志、截图、trace、默认备份。扫描结果与偏离记录保存在项目工作区（shots-v8/b11-boundary-scan.json、design/deviations-v8.md、design/acceptance-v8.md，不在本仓库）。
- 只能真机验证：原生 WebView 叠放对齐（旋转 / 分屏 / 键盘）、多 Profile 可用性、各平台内嵌登录、PROCESS_TEXT 与分享入口、安卓逐字流式、保活内存、Android 15 边到边、文件上传、iOS 全部。

## 0.7.0：内置平台
- **在软件内打开官方网页版**：去发布页每条内容有“在软件内打开 X 发布”——先复制文案，再在 App 内的网页页面打开该平台发布页，你自己登录、粘贴、点击发布。登录会一直保存，直到你在 ⋯ 或“我的 → 平台与软件”里点“退出该平台登录”。网页版打不开时会说明原因并给“打开官方 App”。
- **平板分屏**：平板上“分屏打开小红书”把官方 App 放在本软件旁边（系统不支持时正常打开并提示）。
- 首页“打开平台”、去发布“已登记的软件”里都有“打开 X（内置）”入口。电脑 / 网页版在新标签页打开。
- 硬边界不变：不注入脚本、不自动填表或点击、不读取网页内容或 Cookie、不做多账号，发布由你本人点击。

## 0.6.0：装上就能用（本机模式）
- Android APK / 网页版默认**本机模式**：不需要任何服务器，数据存在本机（IndexedDB），模型从本机直接调用（App 内经 CapacitorHttp）。首次打开三步引导：连接一个模型 → 选平台 → 写第一篇。
- 导航：首页 / 找选题 / 写内容 / 去发布 / 看效果 + 我的。模型、平台与软件、写作助手、备份、日志都在“我的”里。
- 服务端可选：需要配音、配图、合成视频或多设备共用时，按下面“快速开始”启动服务端，再到 **我的 → 连接自己的服务器** 填地址和口令。
- 网页版受浏览器跨域限制，多数模型服务和热点源不能直连，会给出提示；请用 App 或连接服务端。

## 快速开始（可选：服务端）
```bash
npm ci
npm run build
npm start                 # 打开 http://127.0.0.1:8787
```
- 服务端的模型路由与密钥通过服务端接口配置（docs/api.md）；App 连上服务端后生成使用服务端的模型。
- 演示流程（Mock 模型 + 真实公开 RSS 与热榜）：`npm run e2e`
- Docker：`cp .env.example .env && docker compose up -d --build`

## 接入小米 MiMo（0.4.1）
1. 模型 → 密钥：填“小米 MiMo API Key”（或服务器环境变量 `MIMO_API_KEY`）。
2. 模型 → 路由：文本/对话、视觉理解选“小米 MiMo”，默认 `mimo-v2.6-flash`，可下拉选 `mimo-v2.6-pro`；Token Plan Key（tp-/ttp-）把“接入地址”切到 Token Plan。
3. 真实联调：`MIMO_API_KEY=sk-xxx npm run mimo:smoke`，报告在 `out/mimo-smoke-report.json`。
细节（max_completion_tokens、thinking 开关、json_object 降级、缓存命中、默认价）见 [docs/models.md](docs/models.md#小米-mimo-接入041)。

## 界面结构（0.6.0）
- 侧栏 6 项：首页、找选题、写内容、去发布、看效果、我的（手机底部 5 格，看效果从首页卡片与去发布页进入）。旧地址（0.5.0 的 `#today`、`#models/*`、`#settings/*` 等）自动跳到新位置。
- “添加软件”固定在侧栏底部（手机在右下“＋”里），三步登记官方 App；平台数据打包在前端，无服务端也能用；只打开 App 或调用系统分享。
- ⌘K / Ctrl+K 搜索所有页面，旧名称也能搜到。

## 三端
| 端 | 形态 | 构建 |
|---|---|---|
| 电脑（Win/Mac） | Electron，内置后端；0.8.0 起每个平台一个 WebContentsView（独立持久分区，登录保持到你手动退出，无 preload），可登记本机官方 App | `npm run app:desktop -- win` / `mac`（需在对应系统上构建） |
| 手机/平板（Android/iOS） | Capacitor，默认本机模式（无需后端），可选连接你电脑或服务器上的后端；可打开/分享草稿到本机官方 App | `npm run app:android`（生成调试 APK）/ `npm run app:ios`（需 macOS + Xcode） |
| 浏览器 | PWA，可添加到主屏幕、离线只读 | `npm start` |

## 目录
```
server/   后端（Fastify + SQLite）：sources、models、modules、skills、queue …
web/      前端（React + Vite PWA），三端共用；web/src/local/ 为本机模式数据与执行层
shared/   前后端共用纯函数：提示词、平台规则、Schema 校验修复、合规、RSS/robots
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
