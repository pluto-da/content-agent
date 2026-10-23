# 1.2.0 冲突审计（conflict-audit-v1.2）

> 依据：PROMPT-v1.2-super-agent · 基线 1.1.0（tag v1.1.0 = 2c3a90e）· 2026-10-24
> 方法：把 1.2 新增的十类对象（超级 Agent、权限级别、按 Agent 预算、审批收件箱、子 Agent、自定义平台、软件入口、数据源、工作流、MCP / A2A）逐一与 1.1 已有的入口、写入点、读取方对照。
> 规则（延续 1.1 单一真相源）：一个概念一个设置入口、一个写入点；读取方读的必须是最后写入的那一处。冲突 = 同一概念出现 ≥2 个能改入口或 ≥2 个写入点。
> 穷尽依据：逐个过 1.1 的 `route.ts`（ME_SUBS 13 个子页）、`nav.ts`（ME_GROUPS 12 项 + ME_ALIASES）、`flags.ts`（12 个开关）、`policy.ts`（审批原因 11 种）、VFS 根目录（13 个系统文件 + agents/ hooks/ skills/ config/ 等目录）、kv 键（prefs / models_v3 / profile / localApps / hotSources）。

| # | 概念 | 1.1 已有 | 1.2 新增 | 冲突类型 | 处理 | 测试 |
|---|---|---|---|---|---|---|
| A1 | 子 Agent 定义 | VFS `agents/*.md`（v9 的 7 个“角色说明”：writer、analyst 等，只是提示词片段，不可单独运行） | `agents/<id>/AGENT.md`（常驻子 Agent） | 同名目录两种含义 | 旧平铺文件保留为“角色说明”（只读参考，不当作子 Agent）；子 Agent 只认 `agents/<id>/AGENT.md`；`listSubAgents` 只扫描二级目录 | super.test E7 `只认 agents/<id>/AGENT.md` |
| A2 | 子任务 | `agent.subtasks` 开关：深度 1、步数 ≤6 的一次性子运行 | 子 Agent 内部再派一次性子任务（深度 +1，总深度 ≤3） | 两套深度规则 | 一次性子任务机制原样保留，深度改由 `HIERARCHY.maxDepth = 3` 统一计算（用户 0 → 超级 1 → 子 Agent 2 → 子任务 3）；旧开关仍控制是否允许子任务 | super.test E8 深度 |
| A3 | 审批 | 对话里的确认卡（confirm-allow），花钱阈值、视频、删除、系统文件、记忆写入 | 审批收件箱（6 类） | 两个批准入口 | 对话内的同步确认卡保留（用户正在看着的那一步）；**异步**事项（子 Agent 超额度、L3、核心文件修订、新建子 Agent、新平台技能、外部工具启用）只进收件箱；同一事项只有一个 id，在任一处批准即两处同时消失 | super.test E4 |
| A4 | 预算 | 1.0 月度预算 + 按能力日上限（prefs.spend.guard，唯一写入 me/spend） | 按 Agent 月额度 + 单次上限 | 两处设预算 | 全局月度预算仍只在“花钱”页设；按 Agent 额度在子 Agent 编辑里设，存于该子 Agent 的 AGENT.md `budget`；判定顺序：全局护栏 → Agent 额度 → 单次上限，三者都过才执行 | super.test E3 |
| A5 | 权限级别 | `ToolLevel = L0/L1/L2`（工具注册表） | L3 与“禁止”级 | 两套级别 | 不改原类型（避免破坏 1.1 工具）；新增 `PermLevel = L0–L3 + forbidden`，由 `permLevelOf(tool)` 从原级别 + kind 推出（system_file/delete/新建子 Agent/启用外部工具 → L3；FORBIDDEN_TOOL → 禁止） | super.test E2 |
| A6 | 一键暂停 | 无；只有单次运行的“停止” | 全部暂停 / 单项暂停 | — | 新增 `RunRegistry`（所有运行登记 AbortController），“停止”= 取消一个，“全部暂停”= 取消全部 + 写 `paused` 到控制平面；恢复只能手动 | super.test E5 |
| A7 | 平台 | `PLATFORMS` 注册表（代码，web/src/data/platforms.ts 的 CENTERS） | 用户平台 `platforms/<id>/PLATFORM.md` | 两个来源 | `mergePlatforms(builtin, user)`：内置 + 用户两源合并，id 冲突时内置优先、用户平台改名提示；内置平台生成只读模板副本（readonly: true） | super.test E11 |
| A8 | 平台写法 | 1.1 起只在技能 `skills/<平台>/SKILL.md` | 自定义平台的写法技能 | 可能出现第二份写法（PLATFORM.md 里写规格） | PLATFORM.md 只放**规格与清单**（字数、比例、检查清单），**写法只在技能**；single-source S4 继续守护 | single-source-check S4；super.test E11 |
| A9 | 软件入口 | 已登记的软件（kv localApps，AddAppSheet） | 自定义软件入口（可属于平台或独立工具） | 两处登记 | 不另起存储：软件入口仍写 localApps（AddAppSheet 唯一写入点），新增 `platformId` / `standalone` 两个可选字段；指挥台只读展示 | super.test E13 |
| A10 | 数据源 | prefs.hotSources（热点来源，sources.tsx 唯一写入）+ 1.0 接口 Key 表单 | RSS / 公开页 / CSV 映射 / 官方接口四类 + 授权给子 Agent | 两套“来源” | 热点来源仍是 prefs.hotSources；1.2 数据源登记表存 `config/super.json.dataSources`，只存 URL、映射、`secretRef`（Key 仍走安全存储）；授权 = 子 Agent 的 `dataSources` 白名单 | super.test E13 |
| A11 | 定时 | 本机提醒（只通知、不执行，ADR-009） | 工作流定时 | 两种定时 | 工作流定时复用提醒的“只通知”规则：App 打开时执行到期任务，关闭时只发通知，点开再执行；不新增后台执行 | super.test E14 |
| A12 | @ 菜单 | v10 AtMenu：@ 草稿 / 素材 / 文件 | @子Agent 名 | 同一个 @ 符号 | 同一菜单加“团队”分组；解析规则 `@<子Agent名> ` 优先匹配已启用子 Agent 名，匹配不到再走原 @ 引用 | super.test E17 `parseMention` |
| A13 | “我的”入口数 | 12 项（1.1 收敛） | 指挥台 | 往“我的”加入口会破坏 ≤12 | 指挥台作为独立空间（侧栏 / 抽屉固定项“指挥”，`#command`），“我的”不增加任何入口 | v11 D9 + super.test E18 |
| A14 | 核心文件 AGENTS.md | 高风险文件，1.0 起改动需确认 | “指挥职责”章节 | 直接改默认值 = 违反“高风险文件只写入 proposals” | 不修改 AGENTS.md 默认正文；指挥职责以独立文件 `super/SUPER.md`（非核心，超级 Agent 加载）提供，AGENTS.md 的引用改动写入 proposals-v1.2 P1，并在 App 内生成一条“修订建议”等确认（deviations V12-01） | super.test E1 |
| A15 | 审计 | 1.0 audit 集合（AuditKind 16 种） | 授权判定、暂停、子 Agent 生命周期、MCP / A2A 调用 | 新事件要不要另建日志 | 不另建：AuditKind 不变，统一记为 `tool_call` / `approval` / `run_state` / `setting_change`，`detail.agentId` 标明哪个 Agent | super.test E2 审计 |
| A16 | 特性开关 | FLAGS 已冻结（12 个） | `a2a.client`、`a2a.server`、`super.workflows.schedule` | — | 在 flags.ts 冻结前注册，默认关闭；A2A 两个开关 beta | super.test E16 |
| A17 | 备份 | VFS + kv 导出 | agents/ platforms/ workflows/ config/super.json | 新数据是否进备份、是否带凭据 | 全部在 VFS，随备份导出；MCP / A2A / 官方接口凭据只存 secretRef，不进 VFS（VFS 写入前密钥扫描兜底） | super.test E19 |

## B. 不处理（记录理由）

| # | 项 | 理由 |
|---|---|---|
| B1 | 服务端 `server/src/boundaries.ts` 的 HARD_BOUNDARIES 与 BOUNDARIES.md 两份 | 1.1 已记为待人工（proposals-v1.1 P1），属硬边界改动，本轮不动 |
| B2 | 旧 `agents/*.md` 角色说明是否删除 | 删除属于对核心目录的破坏性改动，保留只读 |
