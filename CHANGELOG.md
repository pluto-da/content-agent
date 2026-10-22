# 变更日志

## 0.4.0（2026-10-22）
把 DeepInfer 蒸馏原则（design/deepinfer-distilled.md）落到调用编排层：每一份调用只做一次有效的工作。
- 稳定前缀：系统提示词统一为 硬边界 → soul → 规则（working-method、USER、输出规则）→ skill → 平台规范（Schema 键排序序列化），逐字节稳定；素材、时间、用户输入只在 user 消息。多平台改写共享 skill 之前的前缀（按顺序发出，后一次可命中缓存）。读取服务商缓存命中字段（DeepSeek `prompt_cache_hit_tokens`、OpenAI 兼容 `prompt_tokens_details.cached_tokens`、Anthropic `cache_read_input_tokens`），Usage 新增 `cachedInput`，usage 表新增 `cached_tokens`；价格支持 `cachedInput` 缓存价。Anthropic system 段加 `cache_control`。
- 结构化输出：skill 可声明输出 JSON Schema（```json schema 代码块）；内置平台默认 Schema（小红书标题 20 / 正文 1000、X 每段 280 中文按 2、公众号标题 64、闲鱼标题 30）。提供方声明 `jsonMode`（json_schema / json_object），支持就传 `response_format`；本地 Schema 校验不通过时带错误信息修复重试一次。
- 断点续跑与局部重写：流水线每步写入 `draft_steps`；`POST /api/drafts/:id/resume` 只重跑失败步；`POST /api/drafts/:id/partial-rewrite` 只发送选中段 + 前后有界窗口。创作页新增“局部重写所选”“续跑失败步骤”。
- 草稿-验证分档（默认关闭，运行状态页开关）：草稿模型走路由任务 `draft`；代理信号（合规命中数、Schema 是否一次通过、字数越界）分高/中/低：高直接进待审，中只复核标题与合规命中（任务 `verify`，只替换命中词），低才用强模型整篇重写。草稿记录置信度、一次通过、实际/理论调用次数；草稿模型单价 > 强模型 20% 时给出提示。Mock 可演示三档。
- 确定性评测：A/B 评测 temperature=0，支持的服务商传固定 seed；记录模型版本 + 提示词哈希 + 输入哈希，同哈希命中 `eval_cache` 直接复用。
- 健康路由：按 usage 计算各服务商近期失败率与 p50/p95；主路失败切备用，主路近 30 分钟失败率 ≥ 50%（≥ 4 次样本）且备用健康时先走备用（可配置/关闭）。
- 统一编解码：ChatResult 新增 `reasoning`（DeepSeek/千问 `reasoning_content`、行内 `<think>`、Anthropic thinking 块），不进成稿与日志正文；按思考模式给 max_tokens 默认（非思考 8192、思考 65536，受提供方输出上限截断），请求前粗估长度做上下文上限预检。
- 度量：设置中心 → 运行状态新增“推理效率”（单篇成本、缓存命中率、一次通过率、返工放大系数、p50/p95、各服务商失败率、按平台单篇成本、置信度分布）与“推理策略”开关；接口 `GET /api/metrics/efficiency`、`GET/PUT /api/pipeline/settings`。
- Agent 文件：新增 skills/inference-efficiency.md（蒸馏文档第 2、5 节精要），working-method.md 末尾引用。xiaohongshu-note、x-post 声明输出 Schema。
- Mock：模拟前缀缓存命中、Schema 修复、局部重写、标题复核；正文示例去掉会误触“极限用语”的“第一段”。
- 测试：新增 server/test/inference.test.ts（11 项：Schema 校验与修复、稳定前缀、max_tokens 与预检、置信度分档、断点续跑、局部重写、确定性缓存、健康路由、效率度量）；修正 app.test 中 3 处过期计数（平台 8、创作中心 7、skills 13）与抖音步骤断言，server 71/71 通过；前端新增推理效率面板测试，11/11 通过。
- 版本 0.4.0；Android versionName 0.4.0 / versionCode 400。
- 硬边界未变：不自动点赞/评论/私信/关注，不绕风控，发布由用户本人点击。

## 0.3.0（2026-10-22）
- 信息架构 v4（design/IA-v4-workflow.md）：13 个平级导航改为 4 个主空间 + 设置中心，按“热点 → 选题 → 生成 → 审核 → 用户手动发布 → 复盘”工作流组织。
  - 今天：单一待办流（待审草稿、待发布、失败任务、新热点/关注词命中），每条一个主操作（审核 / 去发布 / 查看 / 转选题）；顶部 4 个小计数与“开启通知”“采集热榜”。
  - 灵感：热点 / 内容库 / 选题 三个标签合并；跨榜合并列表每条新增“转选题”（调用既有 /api/hot/research）。
  - 创作：草稿列表 + 编辑/审核详情 + 平台预览（中性外框、字数与小红书/X 软上限提示，不使用平台品牌素材）；审核通过后“复制并去发布”打开官方后台或本地应用，发布由用户本人点击；原“创作中心/本地应用”并入“发布台”；桌面可切看板（选题 → 生成中 → 待审 → 待发布 → 已发布）。
  - 复盘：原复盘页（导入 CSV、生成复盘、回复草稿）。
  - 设置中心：运行状态、任务与日志、系统文件、改进与评测、插件、通用（主题/语言/连接/代理）、密钥、模型、备份分组收纳。
  - 旧 hash 兼容：#overview、#hot、#library、#topics、#review、#creator、#analytics、#status、#agent、#improve、#plugins、#tasks、#settings 自动重定向到新地址（replaceState，不增加历史记录）；新地址形如 #create/drafts/12，支持浏览器返回。
- 三端布局：手机 <768 底部 4 标签 + 中间“＋新建”，列表点进全屏详情，操作用底部抽屉（vaul）；平板 768–1279 图标栏（Radix Tooltip）+ 列表|详情双栏；电脑 ≥1280 窄侧栏 + 列表 + 详情三栏，列表宽度可拖动（键盘 ←/→ 可调，双击复位，保存在本机）。Ctrl/⌘K 命令面板改用 Radix Dialog，覆盖全部目的地。
- 技术：引入 Tailwind CSS v4（@tailwindcss/vite，token 全部映射到 DESIGN-v3 的 CSS 变量，深浅色自动跟随）、shadcn/ui 风格组件（components/ui：Button、Dialog、Drawer、Tabs、Tooltip、DropdownMenu、ResizableSplit，基于 Radix primitives，手动放入）、lucide-react 图标（替换内联 SVG，保留按名取图标接口）、vaul。旧样式收进 @layer base/components，外壳样式删除。
- 修复：平板审核状态标签条被截断（改为可换行的筛选胶囊）；手机设置页“保存”按钮与说明文字太挤（统一 .actions 区，12px 间距，手机端主按钮整行）。手机触控目标 ≥44px。
- 版本 0.3.0；Android versionName 0.3.0 / versionCode 300。
- 硬边界未变：不自动点赞/评论/私信/关注，不绕风控，发布由用户本人点击。

## 0.2.1（2026-10-22）
- 界面 v3「极简时尚」改版（规范 design/DESIGN-v3-minimal.md），替换 0.2.0 的靛紫渐变/玻璃/重动效风格：
  - 设计 token：暖中性灰（浅色画布 #fafafa / 卡片 #fff / 发丝线 #ebebeb / 墨色 #171717 / 正文 #4d4d4d / 弱化 #8f8f8f；深色 #0a0a0a / #141414 / #262626 / #ededed / #a1a1a1）；主按钮墨色（深色反转）；唯一强调色靛蓝 #5e6ad2（深色 #8b93ff）只用于链接、焦点、选中；状态色均配文字或图标。
  - 字体：系统中文栈，数字 tabular-nums；字阶 12/13/14/16/20/24/32；字重 400/500/600；标题轻微负字距。
  - 4px 间距，卡片内边距 20–24；按钮/输入 6px、卡片 12px 圆角，仅标签用胶囊；默认平面 + 1px 发丝线，阴影只给菜单、弹窗、移动底栏。
  - 侧栏比内容区暗一档、文字更淡，去掉分割线与选中竖条；图标 16px / 1.5 线宽，卡片标题去掉彩色图标底块。
  - 动效只做反馈（150–200ms：hover 底色、按下 0.98、焦点环、骨架屏、toast）；删除页面/列表错落入场、数字滚动、图表描线、发光、渐变、顶栏与遮罩模糊（只保留移动底栏轻模糊）；保留“减少动态效果”。
  - 总览只保留 4 个指标卡（待审草稿、候选选题、热榜条目、任务成功率）+ 待审队列 + 热点前 5；成本、各能力成本、模型能力、流水线、最近任务、硬边界移到新二级页“运行状态”（系统分组，⌘K 可达）。
  - 手机单列、触控目标 ≥44px、底栏 5 项；深浅色切换与 Ctrl/⌘K 保留。PWA theme-color / manifest 颜色同步。
- Android：apply-native 按 mobile/package.json 写入 versionName / versionCode（0.2.1 → 201）。
- 硬边界未变：无自动点赞/评论/私信/关注、无反检测或绕过风控，发布仍由用户点击。

## 0.2.0（2026-10-22）
- 界面全面改版（高级 SaaS Dashboard 风格）：中性色 + 单一靛蓝强调色、8px 网格、系统中文字体栈、12–16px 圆角分层卡片；总览改为真正的仪表盘（KPI 卡片 + 纯 SVG 迷你趋势图、流水线状态、热点榜、审核队列、各能力成本、最近任务）；电脑侧栏分组导航 / 平板可展开图标导轨 / 手机底部标签栏 + 底部抽屉；⌘K 快速跳转；内联 SVG 图标集（无新依赖）；悬停抬升、按压缩放、焦点环、骨架屏、页面切换与列表交错进入、轻提示动画、数字滚动、平滑主题切换，均为 CSS/小 hook，150–300ms ease-out，遵守“减少动态效果”。
- 创作中心登录保持：电脑 App 每个平台独立持久分区，跳转/定时/退出前落盘 Cookie，启动与升级不清理，恢复各标签页上次地址；新增每个平台的“退出登录/清除登录”（唯一清除入口）；登录状态“已保存会话 / 未登录 / 会话已被平台过期”（只统计 Cookie 数量，不读值）。手机端用系统浏览器组件、网页版用新标签页，登录由系统/浏览器保存。
- 本地应用：插件管理新增“本地应用”，按平台登记 Android 包名/深链接、iOS URL Scheme、电脑 .exe/.app 路径或协议；“打开应用”“分享草稿到应用”（Android 定向 ACTION_SEND、iOS 分享面板、电脑复制+打开素材文件夹+启动）；Android “导入已安装应用”（仅 <queries> 声明的官方 App，不申请 QUERY_ALL_PACKAGES）；条目存服务端（`local_apps` 表），支持 JSON 导入导出并包含在备份中。新增 LocalApps 原生插件（mobile/native）与工程注入脚本 `mobile/scripts/apply-native.mjs`。
- 知乎：第 7 个发布平台。新增 skills `zhihu-answer`、`zhihu-article`；插件、平台列表、创作中心（https://www.zhihu.com/creator，域名白名单 zhihu.com）、交接（复制后打开 https://zhuanlan.zhihu.com/write 或用户提供的问题页）、平台合规提示、本地应用预设（com.zhihu.android / zhihu://）、中英文。知乎热榜仍遵守 robots。
- 桌面端预加载脚本改为经 IPC 调用主进程（沙箱预加载不能直接使用 shell），主进程只接受主界面来源的请求。
- 百炼 CosyVoice 语音合成：按官方 WebSocket 协议（run-task / continue-task / finish-task）接入，默认 cosyvoice-v3-flash + longanyang，音色可在路由或提供方设置中选择；长文本按句切分。
- 图像编辑：统一 `hub.imageEdit(图片, 指令)`；百炼千问图像编辑（qwen-image-2.0-pro，同步接口）、OpenAI 兼容 images/edits、Mock；未配置时与其他能力一致提示“未配置”；按输出张数计入成本；新增接口 `POST /api/images/edit`，`GET /api/models` 返回 imageEdit 状态。
- 视频合成：新增 `modules/video.ts`，用本机 ffmpeg 把配音 + SRT 字幕 + 配图合成 1080x1920 竖版 MP4（Ken Burns 轮播；有中文字体时烧录字幕，否则软字幕；无有效配音时用静音轨）；作为抖音口播、视频号改写流水线的 TTS/ASR 之后一步；新增 `POST /api/drafts/:id/video`（可为小红书等图文草稿生成视频）；媒体接口支持 mp4/jpg/webp。
- 抖音热榜：robots.txt 未限制通用 UA，但网页接口对诚实请求返回空内容（需要签名/登录态），现如实标注为 `needs_official_api`（空响应、非 JSON 分别处理）；新增“抖音热榜（开放平台官方接口）”（/hotsearch/sentences/ + client_token），密钥 douyin.client_key / douyin.client_secret / douyin.client_token。

## 0.1.0（2026-10-22）
- 首个可运行 MVP：信息源（RSS、公开网页、公众号、X、抖音）、内容库、选题、六平台改写模板、审核、发布交接、CSV 复盘。
- 热点模块：百度、微博、知乎、抖音、B 站、X 趋势、Google Trends；robots 检查、限速、缓存，失败如实标注；聚类与深度调研生成选题卡。
- 多模型能力层：llm、vision、image、tts、asr、video、embedding、ocr 八个模块，13 个提供方，路由、备用、按能力成本统计。
- 改写流水线：小红书自动配图；抖音/视频号口播稿 → TTS 配音 → ASR 时间轴 → SRT 字幕。
- Agent 系统文件：soul.md、working-method.md（默认 13 条）、USER.md、APPROVAL.md、skills、memory、improvement-log；版本与回滚；A/B 评测基准集。
- 插件管理（按终端启用）、创作中心标签页（Electron webview / 移动端系统浏览器 / 网页新标签）。
- 任务队列、结构化日志、任务面板、本地通知、中英文、深浅色、无障碍、CSP、密钥库、备份导入导出、CI 脚本。
