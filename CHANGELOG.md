# 变更日志

## 0.9.0（2026-10-23）企业级超级工作台：模型分家，Agent 调度
- **模型分家（我的 → 模型）**：11 个能力角色分 5 组（文字 / 看与画 / 声音 / 视频 / 检索），顶部“已接 N / 11 类”，状态点（已实测 / 未实测 / 最近失败 / 未接）。角色页“设置 | 试一试 | 用量”：默认与备用、测试（会花钱的探测先确认）、这一类单独的地址与 Key。账号与 Key：同一服务商一个 Key 默认各能力通用；添加任意服务商（18 个适配器 + OpenAI 兼容 + 本地模拟）；模型名手填、原样发送（大小写和 / : . 都保留）、可加多个并各勾能力；获取 /models 列表（可搜索多选，列表外的名字标“可能已下线或改名”，404 提示手填）；错误模型名白话报错 + “获取列表 / 改模型名”，不自动换模型、不切备用。旧的“常用服务快速连接”保留。
- **试一试**：11 个角色都能不经 Agent 直接调用统一能力层，结果可存素材 / 发给 Agent / 插入草稿；与 Agent 共用记账、AI 生成标识。
- **Agent 设定 / 记忆 / 技能 / 收益 / 成长记录 / 提醒**：VFS 文件树、编辑先看改动对比再保存、版本历史与回滚、恢复默认、“加载预览”（按 SYSTEM.md 顺序组装、semiotics 与技能按需加载）；记忆查看 / 编辑 / 删除 / 忘掉（复查命中数 + 不要记住规则）；技能启用停用；收益手动录入与官方 CSV 导入（预览 → 列映射 → 确认 → 文件指纹去重）、四种归因（分摊估计单独标注）、漏斗；成长记录页顶诚实声明、修订建议看 diff 采纳 / 拒绝、一键回滚、打法看板、收益趋势（图注“不代表因果”）。
- **运维**：运行状态（按模型的调用、p50 / p95 延迟、费用、缓存命中、错误率、健康）、审计日志（筛选 + 导出 CSV / JSONL，已打码）、花钱与实验功能（单次 ¥1 / 当日 ¥10 可改，视频每次确认固定；实验开关；Key 共用方式）、本机提醒（只通知，不执行动作）。
- **备份**：一键导出 zip（manifest + 逐文件 sha256，永不含 Key），恢复前自动快照可撤销，兼容 0.6–0.8 JSON 备份；删除“同时导出 API Key”选项。
- **发布检查新增**：AI 生成声明（由你本人在平台勾选）、肖像 / 品牌授权、复刻音色授权（未授权阻断）、引用出处、收益假设。
- **工程**：shared 契约层（角色注册表、18 适配器、runner、Agent 运行时状态机 / 锁 / 检查点 / 审批、VFS、收益 / 进化、迁移、特性开关、文案集中、审计）；DB v3 只增集合；Key 迁入 AES-GCM 加密存储；C53 / C54 结构化输出校验；scripts/vfs-doctor.mjs、scripts/accept-v9.mjs；CI 新增严格 verify 作业（类型、lint、三套单测、回放评测、VFS 自检、密钥扫描含 git 历史、验收报告产物）；APK 继续用 runner 自带 Android SDK。
- 版本 0.9.0 / Android versionCode 900。偏离与待验见 design/deviations-v9.md、design/acceptance-v9.md；路线图 design/ROADMAP.md；架构决策 docs/adr/。

## 0.8.1（2026-10-22）热修：模型连接后首页仍显示“未连接” + 深度修复 + 界面动效
**用户真机反馈**：在“我的 → 模型”连接了大模型，回到首页 Agent 仍显示“未连接模型 / 先连接一个模型”。
**根因**：Agent 面板常驻不卸载，useAgent 只在挂载时 getModels 一次，之后保存模型它看不到；另外选模型的回退只认“测试通过”的服务，填了 Key 但测试失败 / 没测的服务被忽略，而空状态又用“有 Key”判断——两处标准不一致。
- **统一订阅机制**：web/src/local/db.ts 每次写入（insert / update / del / clear / setKV）派发变更键（集合名或 `kv:<键>`）；新增 web/src/local/useStore.ts（useStoreValue / useStoreChange，同一轮多次写入合并成一次，可选在路由切换、窗口回到前台时重读，读失败给白话错误）与 useModels.ts。saveModels 仍额外派发 `ca:models-changed`（MODELS_CHANGED）。
- **统一“已配置”判断**：store.ts 新增 isConfigured / configuredProviders / hasConfiguredModel / checkState / resolveProvider；有 Key（免 Key 服务填了地址）即视为已配置。Agent 面板、模型胶囊、首页“下一步”、写作页 ModelPicker、生成（activeProvider）全部改用它。未测试 / 测试未通过只在胶囊上提示“未测试 / 测试未通过”，不拦发送；发送失败在对话里给白话原因，并提示去“测试连接”。
- **同类问题一并修复（常驻 / 保活组件读一次就不再更新）**：侧栏平台列表（在“我的 → 平台”改了要刷新才变）、侧栏角标（写作页审核、草稿卡“通过”直接改库不走事件总线，最长 30 秒才更新）、会话列表（分享 / 平台绑定新建的会话不出现）、当前会话消息（空闲时外部写入不显示）、总览卡、素材箱 Tab、草稿列表、首页快照、我的 → 模型 / 账号画像 / 数据源 / 偏好 / 用量 / 写作助手；平台↔会话绑定开关在“我的”里打开后要刷新才生效（Workbench 读的是旧 prefs）。
- **发送按钮**：运行状态加 ref 兜底，任何一步抛错都复位“停止 → 发送”并显示白话原因（以前 createConversation 等出错会卡在运行中）；无模型时提示区分“没连接”与“没填 Key”；运行中不能重复发送。
- **触控目标 ≥44px**：手机 / 平板（视口 <1300 或粗指针）所有按钮、Tab、菜单项、输入框、选择框、链接统一 ≥44px（base 层 !important 统一压过组件里零散的 !min-h-9 / !min-h-10），正文里的链接保持行内。
- **界面动效**（150–250ms，ease-out / 轻回弹，只动 transform / opacity，全部遵守“减少动态”；没有引入动画库）：底部抽屉滑入时长 500→240ms + 遮罩淡入；手机平台侧栏抽屉滑入 + 遮罩淡入；Agent 底部面板上滑；页面切换（我的各子页）与 Tab 切换淡入 + 6px 位移；消息气泡进入；流式输出光标柔和闪烁；工具卡片“详情”展开 / 收起高度过渡（唯一用 grid-template-rows 的地方）；按钮按压 0.97 缩放 + 松开回弹；骨架屏（草稿 Tab 加载、模型胶囊读取中）；侧栏角标弹出（数字变化时重弹）；模型胶囊切换交叉淡入；空状态淡入；弹窗轻放大淡入；轻提示下滑淡入。
- **测试**：新增 web/src/v081.test.tsx 34 项（根因回归 4、已配置判断 5、订阅机制 3、常驻组件 7、发送按钮 3、B3 补测 2、B6 补测 7、B13 补测 3）；前端 169 通过 + 2 跳过，server 75/75。根因用例在去掉订阅后 4/4 失败（已验证能抓住回归）。
- 版本 0.8.1；Android versionName 0.8.1 / versionCode 801（根、shared、server、web、desktop、mobile 与 package-lock 中 @content-agent/shared 依赖同步）。

## 0.8.0（2026-10-22）「超级工作台」
按 design/PROMPT-v8-agent-workspace.md（B1–B20，修订 R1–R3）把软件从“多页面工具”重构为一个 Agent 管理各大平台的工作台；产品名改为“超级工作台”，包名 local.contentagent.app 不变（可覆盖安装）。偏离见 design/deviations-v8.md。
- **外壳**：web/src/shell/（Workbench、Sidebar、BrowserArea、AgentPanel）。首页即 Agent 对话；左侧平台栏（角标：待发布数字 / 新热点圆点，长按·右键菜单，排序态，自定义 https 网站）；主区内嵌平台网页 + 工具栏（后退 / 前进 / 刷新 / 域名 / 发给 Agent / ⋯）；平板·电脑 Agent 右栏（320–560px 可拖、Ctrl/⌘+J、可停靠左侧），手机与平板竖屏底部抽屉（收起 / 半屏 / 全屏）；手机平台栏为“☰”抽屉 + 左缘右滑；OverlayManager 浮层出现时隐藏原生网页。旧页面 home/topics/write/publish/results 不再是导航，V7_MAP 重定向。
- **Agent**：web/src/agent/（loop、tools、prompts、cards、model、store、overview）。function calling 多步循环、流式、工具卡片、会话（conversations/messages）、会话内换模型、JSON 指令降级（toolMode）、L0–L2 权限分级（无 L3）、publish_check 质量门禁、账号画像（profile_update 需采纳）、技能路由、任务检查点与“接着上次继续”、总览卡（纯本机）。
- **共用模块**：app/shared/ 新增 stream.ts（SSE / tool_calls 增量 / Anthropic 事件）、toolcall.ts（JSON 指令解析校验）、hotclean.ts（清洗、bigram 相似度、评分、趋势）。
- **热点五路**：web/src/hot/（connectors：今日热榜等第三方数据源，本机 AES-GCM 加密；collect：a–e 规划与来源标注），web/src/data/hotSources.ts 逐平台来源表；热点巡视浮条。
- **浏览器**：web/src/browser/（browserHost 三端统一接口、pool 保活 + LRU，默认 4，2–6 可调）。
- **安卓原生**：BrowserHost 插件（原生 WebView 叠放在 Capacitor WebView 上，androidx.webkit 多 Profile `ca-<平台>`）、PlatformWebClient 共用类（与 InAppWebActivity 共用）、StreamHttp 流式插件、ShareReceiverActivity（ACTION_SEND）、ProcessTextActivity（PROCESS_TEXT）；apply-native 幂等写入（webkit 依赖、<queries> PROCESS_TEXT、singleTask 不变）。
- **电脑端**：desktop/main.cjs + browser-views.cjs 迁移到 WebContentsView（partition persist:creator-<id>、sandbox、contextIsolation、无 preload），移除 <webview>；context-menu“发给 Agent”。
- **数据**：IndexedDB DB_VERSION 2（新增 conversations、messages、inbox、tasks、hot_snapshots；kv profile），备份 version 2，兼容导入 version 1，默认不导出任何密钥。
- **修复（发布前截图矩阵发现）**：平板竖屏 Agent 底部抽屉原先铺满全宽、盖住侧栏底部“添加平台 / Agent / 我的”，改为从 72px 侧栏右侧开始。
- **测试**：前端 135 通过 + 2 跳过（真实 MiMo 联调用例，需 CA_REAL_MIMO=1；上一执行者真实运行 2/2 通过，日志 work/v8/real-mimo.log）；server 75/75。新增 agent.test.tsx、desktop.test.ts；app.test.tsx 断言随新导航改写（未删旧测试文件，builtin.test.tsx 保留）。
- **真实 MiMo（B5）**：mimo-v2.6-flash 一次跑通“热点 → 分析 → 写小红书笔记”，6 次工具调用，标题 18 字、正文 599 字，Agent 轮次花费约 ¥0.027；整体 118.9 s（未达 30 s 目标，见偏离 F4）。
- 版本 0.8.0；Android versionName 0.8.0 / versionCode 800。

## 0.7.0（2026-10-22）「内置平台」
不用回桌面找别的 App：在本软件里打开各平台官方网页版，平板上可把官方 App 分屏放在旁边。安卓不能把另一个原生 App 嵌进本 App，所以做的是这两件事。偏离与说明见 design/deviations-v7.md。
- **内置官方网页版（A）**：安卓 App 新增原生页面 InAppWebActivity（自写 WebView，不用 iframe——平台页面有 X-Frame-Options）。工具栏：返回（网页后退，退到头关闭）、标题 + 网址、刷新、⋯（打开官方 App / 用浏览器打开 / 复制网址 / 退出该平台登录）、关闭；顶部提示条“粘贴后由你本人点击发布”。登录 Cookie 由系统 CookieManager 持久化（离开页面即写盘），直到你点“退出该平台登录”或“清除全部内置网页数据”。iOS 用系统内置浏览器（SFSafariViewController）；电脑 / 网页在新标签页（Electron 为系统浏览器）打开。
- **平台网址**：9 个平台（新增 B站、快手），首页与发布页网址已用搜索核实：小红书 creator.xiaohongshu.com/publish/publish、抖音 creator.douyin.com/creator-micro/content/upload、视频号 channels.weixin.qq.com/platform/post/create、公众号 mp.weixin.qq.com、知乎 zhuanlan.zhihu.com/write（回答进 www.zhihu.com/creator）、B站 member.bilibili.com/platform/upload/video/frame、快手 cp.kuaishou.com/article/publish/video、闲鱼 www.goofish.com、X x.com/compose/post。
- **去发布**：每条内容新增主按钮“在软件内打开 X 发布”（网页版文案为“在新标签页打开 X 发布”）：先复制标题 + 正文 + 话题，再打开该平台网页版发布页，提示“粘贴后由你本人点击发布”。内置网页不可用（系统 WebView 停用、插件报错、旧版 App）时显示白话原因 + “打开官方 App”。原“复制文案并打开 X（官方 App）”保留为次按钮。
- **入口卡片**：“添加软件”登记过的平台在首页“打开平台”和去发布“已登记的软件”里都有“打开小红书（内置）”。我的 → 平台与软件：每个已登记平台“退出该平台登录”，以及“清除全部内置网页数据”（仅安卓 App）。
- **平板分屏（B）**：本地插件 SplitScreen，用 FLAG_ACTIVITY_LAUNCH_ADJACENT | NEW_TASK | MULTIPLE_TASK 打开已登记的官方 App；“分屏打开小红书”只在安卓 App + 屏幕短边 ≥ 600 时显示；设备不支持时正常打开并提示。AndroidManifest `<queries>` 增加 B站 `tv.danmaku.bili`、快手 `com.smile.gifmaker` 及其 Scheme（其余平台 0.6.0 已声明）。
- **硬边界**：内置页不注入任何脚本（无 addJavascriptInterface / evaluateJavascript）、不自动填表或点击、不读取页面内容；Cookie 不交给网页层（退出登录只在原生层把该平台站点的 Cookie 置为过期，返回一个数量）；页面唤起其他 App 的跳转一律拦截并提示；相机 / 麦克风 / 定位请求一律拒绝；证书错误停止加载；不做多账号。发布永远由你本人点击。
- **0.6.0 遗留修复**：引导页底部“上一步 / 下一步”固定在屏幕底部、手势条（安全区）之上，内容再长也不用滚动。
- 测试：前端 94 项（新增 src/builtin.test.tsx 19 项：按钮出现条件、复制 + 打开流程、不支持时降级、首页入口；平台数 7 → 9 的 3 处断言随之更新），server 75/75；typecheck、eslint、build 通过。原生 Java 在沙盒内用 javac 21 + android-35 android.jar + Capacitor 8.5.3 / AndroidX 类库做过编译检查。截图：shots-v7/（report.json）。
- 版本 0.7.0；Android versionName 0.7.0 / versionCode 700。

## 0.6.0（2026-10-22）「装上就能用」
按 design/PROMPT-v6-rebuild.md 整体重构：APK 不再依赖服务端，装上就能用。偏离与更正见 design/deviations-v6.md。
- **本机模式（默认）**：新增 web/src/local/（IndexedDB 数据层 db/store、按路径分派的 router，与 api.ts 同签名）；`serverBase()` 为空即本机模式。模型直连 OpenAI / Anthropic 兼容接口（local/llm.ts），安卓 / iOS 经 CapacitorHttp 绕开跨域；网页版遇跨域给出白话提示。Key 只存本机，界面只显示末四位，不写日志，备份默认不含 Key。
- **共用模块 app/shared/**：提示词组装、平台字数规则、JSON Schema 校验与一次修复、合规词检查、RSS/robots 解析、错误分类从 server 抽出，本机生成（local/generate.ts）与服务端（server/src/modules/*）引用同一份。
- **服务端可选**：我的 → 连接自己的服务器（地址 + 口令 + 测试连接），连上显示“已连接服务器”，否则继续本机模式；配音 / 配图 / 合成视频在本机模式显示“需要连接服务器”。
- **导航动词化**：首页 / 找选题 / 写内容 / 去发布 / 看效果 + 我的（手机底部 5 格：首页、找选题、写内容、去发布、我的）。首页 = 一句话说明 + 随状态变化的“下一步”卡片 + 一句话输入 + 最近内容。“我的”为分组列表：模型、平台与软件、写作助手与规则、通用设置、备份与恢复、日志、连接服务器、重新开始引导。0.5.0 及更早的旧路由全部重定向。
- **首次引导三步**：连接一个模型（测试成功才亮“下一步”）→ 选要发的平台（勾选后提示把手机上的官方 App 也加进来）→ 写第一篇（当场生成）。
- **模型设置重做**：常用 6 家（小米 MiMo、DeepSeek、通义、Kimi、智谱、豆包）+ 更多 + “添加自定义服务”（名称、API 格式 OpenAI / Anthropic 兼容、Base URL、Key、模型、启用）；“测试连接”显示“已连通，用时 x 秒”，失败分类白话提示（Key 不对、地址错误、网络不通、额度不足、跨域被拒）；默认写作模型；高级项折叠。写作助手：每个平台默认指令，可单独指定模型。
- **硬缺陷修复**：状态栏安全区（@capacitor/status-bar、overlaysWebView=false、viewport-fit=cover、env(safe-area-inset-*)，顶栏 / 侧栏 / Sheet 标题 / 底部导航 / 悬浮按钮避让）；“添加软件”与平台列表改读打包进前端的静态平台数据，无服务端也显示全部 7 个平台；开启 CapacitorHttp。
- **反馈规则**：失败一律“白话原因 + 一个下一步按钮”；热点读不到时显示原因并给“手动输入”；长说明收进“?”弹出。
- 测试：前端 75 项（重写 app.test.tsx）、server 75/75；typecheck、eslint、build 通过。验收截图与脚本：shots-v6/、work/v6/。
- 主包 394.9 kB（vite 报告 gzip 126.5 kB），比 0.5.0 增加（本机层进首屏）。
- 版本 0.6.0；Android versionName 0.6.0 / versionCode 600。硬边界未变：不自动发布、不自动点赞 / 评论 / 私信 / 关注，发布由用户在平台 App 里本人点击。

## 0.5.0（2026-10-22）「一个前台」
按 design/PROMPT-v5-frontstage.md 改版信息架构与界面呈现，不改业务能力、不改 server API、不改硬边界。
- 取消“设置中心”与齿轮入口。侧栏固定 8 项两组、无二级菜单：工作流（今天 / 灵感 / 创作 / 复盘）+ 工作台（平台 / 模型 / Agent / 偏好）。页内细分用标签，每页 ≤3：模型 = 路由 / 密钥 / 用量；Agent = 文件 / 改进；偏好 = 通用 / 备份 / 日志。
- 路由：`#settings/*` 全部重定向（status→models/usage、models→models/routes、secrets→models/keys、plugins 与 local-apps→platforms、agent→agent/files、improve→agent/improve、general→prefs/general、backup→prefs/backup、tasks→prefs/logs、settings→prefs）；0.2.x 旧路由经 LEGACY 表继续重定向到新位置；新增 `#prefs/logs/<任务id>`（日志按任务过滤）。
- 悬浮“添加软件”：电脑/平板侧栏底部 sticky 墨色胶囊（40px、最低一级浮层阴影、已登记数量角标）；侧栏折叠为 64px 图标栏时变 40×40 圆形“＋”并有提示。手机：底部 4 标签 + “更多”（左侧抽屉 = 手机版侧栏，底部同样有“添加软件”），右下 56px“＋”抽屉第一项是“添加软件”，其余是原新建动作（NEW_ACTIONS 弹层并入）。三步 Sheet：选平台（7 个，已登记打勾）→ 确认软件（按系统预填官方包名 / Scheme / 协议，Android“从已安装应用选择”、Electron“选择应用”，深链接等在“高级”）→ 完成（“试打开一次”）。常见平台 3 次点击。
- 平台页：每个平台一行（网页登录状态〔桌面 App〕、是否已登记本地软件、发布入口、本终端模块开关），已登记软件列表与导入/导出（⋯）、采集模块开关。原插件页与本地应用管理并入；发布台只保留“打开应用”，分享在草稿交接里。
- 今天：4 张指标卡改为一条文字状态条（今日花费、模型是否正常、已连接平台数，点击跳转）；失败任务显示白话原因 +“重试”（热榜类），⋯ 进入按该任务过滤的日志；首次打开显示一次“设置已经并入侧栏的平台、模型、Agent、偏好四页”。
- 创作 / 灵感：生成面板（选题改写、草稿编辑器）显示当前文本模型并可就地切换（如 MiMo flash → pro），显示单价与相对倍数；草稿详情一个主按钮 + 最多 2 个次按钮，其余进“⋯”；草稿过滤 4 个；列表每行两行（标题 / 平台 · 状态点 · 时间）。
- 降噪：状态从彩色徽章改为圆点 + 文字；模型路由默认只显示 能力 / 服务商 / 模型（备用、思考、接入地址、单价进“高级”）；密钥每组默认 ≤4；Agent 文件列表改为下拉；添加信息源、选题“改写到”平台进折叠；文案去术语（“格式修复过一次”，用量页附白话说明）。盘点见 design/feature-audit-v5.md：可见控件 698 → 482（-30.9%；状态点计入时 698 → 517，-25.9%）。
- 性能：页面级 React.lazy，主包 533.85 kB → 367.6 kB（未压缩；gzip 171.1 → 117.9 kB）。
- 测试：前端 12 → 55 项（路由每条映射、侧栏 8 项两组、9 个原分区可达、添加软件 ≤3 次点击、手机抽屉与“＋”、折叠图标栏、⌘K 别名与键盘、状态条）；server 75/75 未改。
- 版本 0.5.0；Android versionName 0.5.0 / versionCode 500。硬边界未变：“添加软件”只能打开 App 或调用系统分享。

## 0.4.1（2026-10-22）
接入小米 MiMo（OpenAI 兼容，官方文档 2026-10-22 核实）。
- 提供方 `mimo`（小米 MiMo，region cn）：能力 llm / vision，默认 mimo-v2.6-flash，可选 mimo-v2.6-pro、mimo-v2.6-pro-ultraspeed；密钥 `model.mimo.key`，密钥库为空时读环境变量 `MIMO_API_KEY`；接入地址可在设置中切换按量（api.xiaomimimo.com/v1）与 Token Plan（token-plan-cn.xiaomimimo.com/v1）。
- 内置默认价（含缓存价）：flash 0.02/1/2、pro 0.025/3/6、pro-ultraspeed 0.25/30/60 元/百万 token；`GET /api/models` 新增 `defaultPrices`，`prices` 只返回用户自填（同键覆盖默认）。
- 适配器方言 `chatDialect`：`max_completion_tokens`；`thinking:{type}` 显式下发（视觉固定关闭；思考时不下发 temperature）；temperature 截断 [0,1.5]；json_schema → json_object 降级；读取 `reasoning_content`、`cached_tokens`、`reasoning_tokens`（details 为 null 时容错）；`repetition_truncation` 自动重试一次，仍截断则 `warnings` + warn 日志。
- 确定性评测强制 thinking disabled + temperature 0。
- 设置 → 模型：模型名下拉候选、llm“思考”列（自动/开/关）、带预设的提供方“接入地址”切换、内置默认价提示；切换地址不再冲掉未保存的路由修改。
- 新增 `npm run mimo:smoke`（server/src/scripts/mimo-smoke.ts）：a–f 六项真实联调，报告写 `out/mimo-smoke-report.json`，不含密钥。首次实跑 6/6 通过，合计约 ¥0.013。
- 测试：server 新增 MiMo 适配 4 项（max_completion_tokens、thinking 与评测、json_schema 降级 + 截断重试 + 默认价、usage details 为 null）；前端新增模型设置 MiMo 1 项。
- 版本 0.4.1；Android versionName 0.4.1 / versionCode 401。硬边界未变。

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
