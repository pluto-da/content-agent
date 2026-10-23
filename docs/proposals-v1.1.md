# 1.1.0 高风险系统文件改动建议（等大哥确认后才应用，本轮未应用）

按 PROMPT-v1.1 第十二部分：SOUL、AGENTS、SYSTEM、IDENTITY、USER 的结构性规则、REVENUE、EVOLUTION、硬边界、花费策略的改动需要先看 diff 确认。以下改动是本轮发现“有必要但不能直接做”的。

## P1 硬边界只留一份（服务端常量改为从 BOUNDARIES.md 派生）
- 现状：`server/src/boundaries.ts` 的 `HARD_BOUNDARIES` 有 9 条（用于服务端提示词前缀 `boundaryPreamble()`、启动日志、`/api/boundaries`）；Agent 文件 `BOUNDARIES.md` 有 15 条（界面与 v9 运行时加载）。两份文本不一致。
- 建议：`HARD_BOUNDARIES` 在构建期从 `agent/v9/defaults/BOUNDARIES.md` 的编号条目生成（与 `gen-vfs-defaults.mjs` 同一步），服务端提示词前缀随之变为 15 条。
- 影响：送给模型的硬边界文本变化（只增不减：新增“不读取登录后页面”“不注入脚本”“只做真实流量”“不编造收入”“不承诺结果”等 6 条；原 9 条中“渠道白名单”“闲鱼只生成文案”两条在 BOUNDARIES.md 里没有逐字对应，需要大哥决定是否补进 BOUNDARIES.md）。
- diff 摘要：`- export const HARD_BOUNDARIES = Object.freeze([ …9 条… ])` → `+ export const HARD_BOUNDARIES = Object.freeze(BOUNDARY_LINES)  // 由 BOUNDARIES.md 生成`

## P2 旧生成路径的底座文件并入 VFS
- 现状：`web/src/local/generate.ts`（编辑器“改写”、Composer 一句话生成）的系统提示用构建时打包的 `agent/soul.md`、`agent/working-method.md`、`agent/USER.md`（0.8 文件），与 VFS 里的 SOUL.md / USER.md 不是同一份。
- 建议：改为读 VFS 的 SOUL.md、USER.md（与 v9 运行时同一份）。
- 影响：旧生成路径的语气与规则跟随大哥在“设定与硬边界”里的修改；属于 SOUL / USER 加载规则的改动，需确认。

## P3 USER.md 增加“画像详情见 user/profile.md（在我的 → 账号画像编辑）”的结构说明
- 现状：USER.md 第一行已写“详情见 user/profile.md”，但没有说明该文件由“我的 → 账号画像”维护、Agent 只能提议修改。
- 建议 diff：在 USER.md 标题下加一行 `- 账号定位、受众、风格、禁用词、红线：在“我的 → 账号画像”编辑，写入 user/profile.md（Agent 只能提议修改，你采纳后写入）`，并把“账号定位 / 目标受众：待填写”两行改为引用该文件。
- 影响：USER.md 结构性规则变化，需确认。
