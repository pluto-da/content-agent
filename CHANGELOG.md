# 变更日志

## 0.1.0（2026-10-22）
- 首个可运行 MVP：信息源（RSS、公开网页、公众号、X、抖音）、内容库、选题、六平台改写模板、审核、发布交接、CSV 复盘。
- 热点模块：百度、微博、知乎、抖音、B 站、X 趋势、Google Trends；robots 检查、限速、缓存，失败如实标注；聚类与深度调研生成选题卡。
- 多模型能力层：llm、vision、image、tts、asr、video、embedding、ocr 八个模块，13 个提供方，路由、备用、按能力成本统计。
- 改写流水线：小红书自动配图；抖音/视频号口播稿 → TTS 配音 → ASR 时间轴 → SRT 字幕。
- Agent 系统文件：soul.md、working-method.md（默认 13 条）、USER.md、APPROVAL.md、skills、memory、improvement-log；版本与回滚；A/B 评测基准集。
- 插件管理（按终端启用）、创作中心标签页（Electron webview / 移动端系统浏览器 / 网页新标签）。
- 任务队列、结构化日志、任务面板、本地通知、中英文、深浅色、无障碍、CSP、密钥库、备份导入导出、CI 脚本。
