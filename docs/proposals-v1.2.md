# 1.2.0 修订建议（proposals-v1.2）——高风险文件，等你确认后再应用

> 规则：SOUL / AGENTS / SYSTEM / IDENTITY / USER / MEMORY / TOOLS / APPROVAL / BOUNDARIES 等核心文件、硬边界、花费策略的改动只写在这里；
> App 首次启动 1.2.0 时也会在“成长 → 修订建议”生成同样一条（P1），由你在 App 内批准或拒绝。本轮代码没有修改任何核心文件正文。

## P1 AGENTS.md：增加“指挥职责”引用（状态：待你确认）
- 原因：PROMPT-v1.2 §4.1 要求 AGENTS.md 增加“指挥职责”章节。
- 本轮做法：指挥职责正文放在非核心文件 `super/SUPER.md`（已随新安装提供，代码侧在加载组装末尾追加，预算 3000 字）。
- 建议改动（diff）：
```diff
 ## 每一轮的顺序
+0. 指挥：多步目标先按 super/SUPER.md 拆解、选执行者（自己做 / 交给子 Agent / 提议新建子 Agent）、交接、验收并对结果负责。
 1. 读懂（符号）：…
```
- 影响：只是引用，不改变任何权限与边界。拒绝也不影响 1.2 功能（SUPER.md 照常加载）。

## P2 SYSTEM.md：加载顺序表加一行 `super/SUPER.md`（状态：待你确认）
- 原因：目前由代码在组装末尾追加；写进加载表后可在“设定与硬边界 → 加载预览”里调整顺序与预算。
```diff
+| 14 | super/SUPER.md | 每次 | 3000 |
```

## P3 BOUNDARIES.md：补一句“子 Agent / 外部工具 / A2A 同样受硬边界约束”（状态：待你确认）
- 原因：硬边界对所有层级 Agent 生效（PROMPT-v1.2 第十五部分）。代码已强制（governance.ts `authorize`、mcp.ts 注册与调用二次检查），文件文字是否补充由你决定。
```diff
+- 以上边界对超级 Agent、全部子 Agent、外部工具（MCP）与外部 Agent（A2A）同样生效，任何层级都不能放宽。
```

## P4 花费策略：子 Agent 默认月额度 ¥3、单次上限 ¥1（状态：已按 Prompt 默认值实现，调整需你确认）
- PROMPT §4.3 给出默认 ¥3/月；单次上限 Prompt 未给默认值，本轮取 ¥1（deviations V12-03）。可在子 Agent 编辑里逐个调整。
