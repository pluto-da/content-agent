# 变更日志

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
