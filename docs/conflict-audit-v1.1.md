# 1.1.0 全量冲突审计（conflict-audit-v1.1）

> 依据：PROMPT-v1.1-unify 第四部分 · 基线 1.0.0（59e55a0）· 审计对象：app/ main 最新代码 · 2026-10-24
> 方法：列出全部用户可见入口（路由 `route.ts`、`nav.ts` 的 `ME_GROUPS`、命令面板 `NAV`、Agent 面板抽屉 / @ 菜单、各卡片按钮）与全部持久化写入点（IndexedDB kv 键、集合、Agent VFS 文件、config/*.json、localStorage），按“概念”逐一标出 能看 / 能改 / 写到哪 / 谁读。一个概念 ≥2 个“能改”入口或 ≥2 个写入点 = 冲突；读取方读的不是最后写入的那一处 = **严重冲突**。
> 守护：`scripts/single-source-check.mjs`（S1–S5，CI 严格运行）；对应单测见“测试”列。

## A. 第二部分 2.2 列出的冲突（全部覆盖）

| # | 概念 | 1.0 入口 | 1.0 写入点 | 读取方 | 冲突类型 | 处理 | 理由 | 测试 |
|---|---|---|---|---|---|---|---|---|
| A1 | 平台写法 | 我的→写作助手与规则（AgentSub/AssistantEdit）；我的→技能 | kv:assistants（覆盖正文）；VFS skills/<id>/SKILL.md | 旧生成路径 generate.ts 读 kv:assistants + 打包的 agent/skills/*.md；v9 运行时读 VFS 技能 | **严重**：两个真相源，用户在技能里改了写法，旧生成路径仍按 kv 覆盖或打包原文写 | 删除 data/assistants.ts、AgentSub、AssistantEdit、入口与文案；平台写法只从 VFS 技能读（local/platformSkill.ts）；kv:assistants 迁移为技能用户修订版本（进版本历史，可回滚） | 同一件事一个真相源 | v11.test D7；single-source S4 |
| A2 | 模型选择 | 角色默认 / 备用（RoleSettings）；高级：按任务路由（RoutingPage）；写作助手单选模型（ModelPicker in AssistantEdit） | models_v3.roles[r].primary / fallback / tasks；kv:assistants.providerId/model | runner.resolveTarget；对话主链 getModels/resolveProvider（读 roles.chat.primary）；generate.ts（读助手覆盖） | **严重**：三处设置、三条读取链 | 统一为 shared `resolveModel(state, task, need)` 一条链（任务指定→主模型→同服务商→其他→无）；runner.resolveTarget 只是别名；getModels 的默认服务商由 resolveModel 推出；助手级覆盖删除并迁到 roles.chat.tasks["write:<平台>"] | 选模型只有一条链 | unify.test 五级；single-source S3 |
| A3 | 列表标题截字 | 写作助手列表 `description.slice(0, 24)` | — | — | 显示缺陷（截图 A） | 列表随写作助手一起删除；全局禁止 `.slice(` 截标题（ListRow 走 CSS 两行省略 + title 全文） | 截字丢主信息 | accept-v1.1 D11 静态扫描 + 截图矩阵 |
| A4 | 日志 / 审计 / 运行状态 | 我的→日志；我的→审计日志；我的→运行状态 | /api/logs（本机日志）；audit 集合；usage_log | 三个页面各读一份 | 重复入口（同一问题“做了什么、哪里失败”三处看） | 合并为“记录”：筛选 最近任务 / 失败 / 审批 / 花费 / 设定改动；运行健康作为“运行健康”标签；旧路由 me/logs、me/audit、me/status 重定向 | 一个问题一个地方看 | v11.test D9；app.test 路由 |
| A5 | 花钱 | 我的→花钱与实验功能（阈值）；运行状态（成本）；1.0 月度预算（SpendGuard） | prefs.spend + models_v3.budget（同步双写）；prefs.spend.guard | runtime 读 prefs.spend；runner 读 models.budget；运行状态显示成本 | 重复入口 + 双写入点（同步写，读取一致） | 合并为“花钱”（阈值 + 预算 + 日上限 + 异常提醒）；运行详情去掉花费数字，只留“看花钱 ›”链接；双写保留在同一个保存函数里（S2 只允许 ops.tsx 与 v9/spend.ts 写） | 花钱信息一处 | single-source S2；v9ui 设置测试 |
| A6 | 本机数据 | 我的→备份与恢复；我的→存储（同一图标） | backup zip；media / vfs 版本 | 两页 | 重复入口 | 合并为“数据”（两个标签）；me/backup、me/storage 重定向 | 同一件事“管本机数据” | v11.test D9 |
| A7 | 用户画像 | 我的→账号画像；记忆页；Agent 设定里的 USER.md | kv:profile；VFS USER.md / user/profile.md；记忆条目 | Agent 读 kv:profile（工具、发布检查）；系统提示读 USER.md | **严重**：画像改了，系统文件里的 USER 不变 | 画像唯一真相源 = VFS `user/profile.md`（USER.md 的详情文件，带版本）；getProfile / saveProfile 改为读写该文件；kv:profile 迁移后清空；USER.md 结构不动（高风险，见 proposals） | 画像与 USER 同源 | v11.test 画像；v081 画像卡 |
| A8 | 成长 / 技能 / 记忆 | 成长记录；技能；记忆；收益 | proposals、lessons、VFS skills、memory | 各页 | 重复入口（自动采纳在技能里，成长记录又展示一遍） | “记忆与技能”一页两标签；“成长”含收益标签；自动采纳记录只在成长展示，技能页只看当前版本 | 一个概念一处 | v11.test D9 |
| A9 | 热点来源 | 我的→数据源；通用设置“公开热点来源” | 都写 prefs.hotSources（同一个键） | router.ts 读 prefs.hotSources | 重复入口（非双写） | 通用设置里的列表删除，只在“平台与软件 → 数据源与热点来源”；无数据迁移（审计确认是同一键） | 两处开关一份数据 | single-source S2（只允许 sources.tsx 写） |
| A10 | 低频项 | 重新开始引导、提醒与高频项平铺 | — | — | 信息架构 | “重新开始引导”移到通用设置底部；提醒留在 Agent 组 | 降低噪声 | app.test 命令面板旧词 |
| A11 | 模型页空状态 | 11 行灰点“未接” | — | — | 空状态无下一步（截图 B） | 未配置时只显示一张卡和唯一主按钮“接入第一个模型”（三步向导）；配置后显示主模型卡 + 8 个能力覆盖一览（点亮写明由谁覆盖，未覆盖“补一个”只列支持该能力的服务商） | 空状态只给一个下一步 | v9ui D3/D4；accept-v1.1 D3 |
| A12 | 深度推理 / 快速小模型 | 模型页独立角色行 | roles.reason / roles.fast | runner 角色回退 | 概念错位（档位被当成模型） | 深度思考 = 对话里的开关（advanced.thinking 唯一真相源）；省钱档 = 高级里的开关（economy.mode）；角色退为内部实现，界面不出现“角色”“深度推理”“快速小模型” | 贴合市面模型形态 | unify.test 思考档；accept D3 |

## B. 本轮自查出的冲突（14 条，多于 A 组 12 条）

| # | 概念 | 入口 / 位置 | 写入点 | 读取方 | 冲突类型 | 处理 | 理由 | 测试 |
|---|---|---|---|---|---|---|---|---|
| B1 | 视频任务轮询 | engine.ts pollVideo | — | 直接读 roles.video.primary | **严重**：视频若由主模型 / 同服务商覆盖（未单独绑定），轮询读不到目标或读错模型 | 改为 resolveModel(video) | 提交与轮询同一链 | single-source S3 |
| B2 | 花费预估 | v9/models.ts estimate | — | 读 roles[r].primary | **严重**：预估用的模型与实际调用的不是同一个 | 改为 resolveModel | 预估与计费一致 | single-source S3 |
| B3 | 模型状态（Agent 工具 models_status） | engine.ts modelsStatus | — | 读 roles[r].primary.model | 显示与实际不一致 | 改为 resolveModel | 同上 | single-source S3 |
| B4 | 后台任务路由（压缩 / 规划 / 修复 / 判官） | engine.ts | roles.chat.tasks | 直接读 tasks[purpose] | 绕过统一链 | 改为 resolveModel(purpose, chat).via === 'task' | 同一链 | single-source S3 |
| B5 | Key 共用方式 | “花钱与实验功能”页 | prefs.keyPolicy + models.keyPolicy | runner | 概念放错页（属于模型） | 移到 模型 → 高级 | 一个概念一个入口 | single-source S2 |
| B6 | 实验开关 | “花钱与实验功能”页 | prefs.flags | 全局 | 与花钱混在一页 | 移到 通用设置 | 第七部分结构 | single-source S2 |
| B7 | 硬边界文本 | 写作助手页显示 server HARD_BOUNDARIES（9 条）；Agent 设定显示 BOUNDARIES.md（15 条） | 代码常量 + VFS 文件 | 两处界面各显示一份，内容不同 | **严重**：两份硬边界、条目不一致 | 界面只读 BOUNDARIES.md（MePages.HardBoundaries，在“设定与硬边界”顶部）；web 不再导入 HARD_BOUNDARIES；服务端常量与文件统一属高风险，写入 proposals-v1.1 P1 待确认 | 与 BOUNDARIES 同源 | v11.test D10；single-source S5 |
| B8 | 旧路由语义 | #agent/files、#agent/improve、#settings/agent 指向“写作助手与规则” | — | — | 路由指向已删除的概念 | 改指“记忆与技能 → 技能”；全部旧 me 子页重定向表 ME_REDIRECTS | 旧书签不落空 | app.test、v11.test D9 |
| B9 | Agent 面板“当前各能力使用的模型” | 模型抽屉 | — | 只列有 primary 绑定的角色 | 被主模型自动覆盖的能力不显示，与实际不符 | 改为 coverage()（与能力覆盖一览同一函数） | 显示与解析一致 | unify.test 覆盖一览 |
| B10 | @ 菜单分组 | 输入框 @ | — | ROLE_GROUPS（文字 / 深度推理 / 快速小模型…） | 文案与模型页新概念冲突 | 按 8 个能力分组 | 同一套词 | v10ui atOptions |
| B11 | 写作默认平台 | Composer 默认 xiaohongshu；toWritePlatform 兜底 xiaohongshu；draft_write platform 必填 | — | — | 与“自由创作为默认”冲突 | 默认 free（自由创作技能 skills/free-writing）；draft_write platform 可选；新增 draft_adapt 一稿多适配 | 第六部分 | v11.test D8 |
| B12 | 备份导出旧真相源 | v9/backup.ts KV_KEYS 含 profile、assistants；本机 API 备份 router.ts 同 | 导出 kv:assistants / kv:profile | 恢复时直接写回 kv | **严重**：恢复旧备份会把旧覆盖写回已废弃的键，绕过技能与 user/profile.md | 不再导出这两个键；恢复时交给 importLegacyV11 走迁移（覆盖 → 技能修订；画像 → user/profile.md） | 旧数据也只进一个真相源 | v11.test D12 |
| B13 | 模型接入方式 | 账号与 Key 页；“快速连接”旧页（6 家） | 两种方式写 models_v3 | — | 两个接入入口 | “接入一个模型”三步向导为主入口（#me/models/connect，旧 #me/models/legacy 指向向导）；账号与 Key 收进“高级 → 自定义服务商”；#me/models/mimo 等旧深链仍可用 | 首次使用只有一条路 | v9ui D3 |
| B14 | 运行详情里的花费 | 运行状态 totals / 每行 ¥ | — | usage_log | 与“花钱”重复显示 | 运行详情不再显示花费数字，只给链接 | A5 的延伸 | 截图自检 |

## C. 审过但保留（不判冲突）

| 概念 | 位置 | 结论 |
|---|---|---|
| 本次临时选模型 | 写作编辑器“改写”旁的 ModelPicker、输入框 @ | 只影响这一次调用、不持久化，等同 resolveModel 的 override 层（第 0 级）；保留 |
| 角色（RoleId） | shared 适配器、卡片、计费、usage_log.role | 内部实现，界面不出现（第五部分 5.3 明确保留） |
| 旧“快速连接”页 ModelsPage | #me/models/<服务商 id> 旧深链 | 只为旧链接可达，不在任何列表里出现 |
| prefs.spend 与 models.budget 同步双写 | ops.tsx saveSpend | 单入口、同一函数同步写，两个读取方读到的值相同；S2 守护写入点 |
| 旧生成路径的底座文件 | data/agentFiles.ts（soul / working-method / USER 打包） | 只作为旧 generate.ts 的系统提示底座，不含平台写法；与 VFS SOUL/USER 的统一属高风险，列入 proposals-v1.1 P2 |

## D. 穷尽依据

1. 入口：`ME_GROUPS` 22 项、`ME_SUBS` 19 个、`SETTINGS_MAP` / `LEGACY` / `V5_MAP` / `V7_MAP` 全部旧路由、命令面板 `NAV`、Agent 面板模型抽屉 / 附件抽屉 / @ 菜单，逐一核对（见 A、B、C）。
2. 写入点：`git grep "setKV\("` 全部 kv 键（models / models_v3 / prefs / profile / assistants / usage / schema / approvals.remembered / memory.dontRemember / hot.cache / sources.creds.meta / backup.snapshot），`setPrefs({` 全部字段，VFS `vfs.write(` 全部调用，localStorage（ca.server / ca.token / ca.mode / ca.theme / ca.lang）。localStorage 各键只有一个写入点，无冲突。
3. 读取链：`git grep "roles\[|roles\.\w+\.(primary|tasks)"` 全部命中已改为 resolveModel 或属于编辑器 / 迁移（single-source S3 的白名单）。
4. 隐性冲突三类：同一开关两处默认值（热点来源默认值只在 DEFAULT_PREFS 一处；花钱阈值 ¥1/¥10 在 DEFAULT_PREFS 与 DEFAULT_BUDGET 两处，数值一致，记为保留）；同一文案 id 不同含义（“技能”“记忆”“写作助手与规则”随入口合并调整，删除的入口文案 id 保留在表中仅供命令面板别名使用）；两功能同时生效互相覆盖（A1 自动采纳写技能 vs 旧覆盖生效，已随 A1 消除）。

合计：A 组 12 条 + B 组 14 条 = 26 条冲突，全部已处理；C 组 5 项审过保留。
