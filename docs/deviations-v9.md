# 0.9.0 偏离记录（相对 design/PROMPT-v9-models-agent.md v9.3）

更新：2026-10-23（CST）。每条：偏离了什么、为什么、影响、何时补齐。

| 编号 | 偏离 | 原因 | 影响 / 现状 | 何时补齐 |
|---|---|---|---|---|
| D-SEM | **SOUL.md / AGENTS.md 补入“指向 semiotics/、先加载 PRINCIPLES.md”一段**：v9.3 第八部分给出的 SOUL.md、AGENTS.md 默认正文里没有这段，但 C52 要求有。生成默认文件时（scripts/gen-vfs-defaults.mjs）在 SOUL 第三部分末尾、AGENTS“符号和结构”一节末尾补入，文字与 0.8 soul.md / working-method.md 同义。SOUL 第一部分（核心指令）未改动 | 规格内部矛盾，以验收项为准 | vfs:doctor `semiotics.pointer` 通过；“规格逐字一致”比对把补入段当作附加内容（规格抽取件仍是正文子串） | 下次修订规格时把这段写进第八部分 |
| D-EVAL | **评测为回放模式**：G01–G28、BQ-01–BQ-32 由录制的模型响应驱动；运行时、工具、审批、幂等、自检、能力层（Mock 适配器）都是真实代码。行为评测中话术类条目只用规则判官，未用 LLM 判官 | 本轮无可用于 CI 的真实 Key；真实模型输出不稳定 | 60/60 通过（out/eval-report-0.9.0.json）；真实模型的话术表现未验证 | ROADMAP 0.11 |
| D-KEYSTORE | **Key 存储未绑定硬件 Keystore**：安卓上与网页同一实现——WebCrypto AES-GCM，加密密钥是不可导出的 CryptoKey，存 IndexedDB；未使用 AndroidKeyStore / StrongBox | 原生插件需要真机验证，本轮没有真机 | Key 不出现在配置、日志、备份、VFS、截图里（扫描 0 命中）；但 root 设备或被篡改的 WebView 理论上可在页面内调用解密 | ROADMAP 0.10 |
| D-AIGC | **AIGC 隐式标识只做了 PNG**（tEXt：AIGC 标签、生成模型、服务提供者、内容编号、时间）；JPEG EXIF / XMP、MP3 ID3、WAV、MP4 元数据未写，只在 media 记录里标注 | 需要逐格式的二进制写入与真机播放验证 | 生图默认 PNG，已覆盖主路径；其他格式在卡片与发布检查里提醒“在平台勾选 AI 生成声明” | ROADMAP 0.10 |
| D-MULTIPART | **Capacitor multipart / 二进制响应未在真机验证**：改图、转写（multipart）、配音（二进制）在 jsdom 与假 HTTP 下测试通过，CapacitorHttp 原生实现下的表现未验证 | 无真机 | 真机上可能失败；失败时显示白话原因与下一步 | ROADMAP 0.10 |
| D-REAL | **真实 MiMo 调用未执行，C5 / C6 待 Key**：本轮没有执行任何真实模型调用（0.4.1 / 0.8.0 曾实跑 MiMo 文本，但不是 0.9 运行时） | 本轮未获得可用 Key；不写入任何真实密钥 | C5、C6 记为“待 Key”；C41 / C42 用本地 mock 服务断言请求体 | 你提供 Key 后按 ROADMAP 0.11 执行 |
| D-VIDEO | **“视频每次确认”不可在设置里关闭**：用户要求花钱阈值“可改”。单次 / 当日阈值已可改；视频确认在代码里是硬性项（6.10 HARD_CONFIRM、BudgetPolicy.videoAlwaysConfirm 字面量 true），设置页显示为锁定 | 规格把视频列为硬性确认 | 设置页说明“代码固定每次确认，不能关闭” | 如需可关，需先改规格 |
| D-CARDS | **新卡片逐张截图未完成（C12 部分）**：shots-v9 覆盖 17 个页面 × 4 视口 × 浅深；对话里的 11 类卡片正常 / 失败态未逐张截图（组件与失败态有单测） | 时间；需要回放会话驱动 | C12 记为“部分” | ROADMAP 0.10 |
| D-ROUTING | **“高级：按任务路由”页未做**：数据结构与 runner 支持 tasks 绑定，界面未提供编辑 | 本轮优先完成用户点名的页面 | 只能通过导入 models.json 配置按任务路由 | 0.10 或按需 |
| D-AT | **@ 菜单与会话头部按角色胶囊（9.2）沿用 0.8 的模型胶囊**：@ 覆盖在运行时已支持并有单测，输入框里的角色分组菜单未改版 | 优先级 | C11 以单测为证 | 0.10 |
| T1 | **改写的旧测试断言**：web/src/app.test.tsx “我的”分组 id 列表（新增 Agent 组 6 项与运维 3 项）；未删除任何旧测试 | 导航新增页面 | 见提交 1fef900 | — |
| E1 | **lint 修复**：evals/golden.test.ts 未用的类型导入与一处 prefer-const（阶段 1 遗留，CI verify 作业首次运行时暴露） | — | 已修 | — |
| E2 | **新增账号 id 改短**：`secret:<账号 id>` 在 id ≥16 字符时会被密钥扫描（kv-secret 规则）误判，导致保存被拒；新账号 id 改为 10 位 | 测试中发现 | 已修，有测试 | — |
