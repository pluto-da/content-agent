# 1.2.0 逐项验收（acceptance-v1.2）

由 `node scripts/accept-v1.2.mjs --strict` 生成（证据：本地现场生成的单测结果 out/vitest-*.json、single-source-check、i18n-audit、walkthrough-v1.2、截图矩阵 docs/shots/shots-v1.2.json、self-review-v1.2、MiMo 实测 evals/real/mimo-v1.2.json、回归验收 accept-v9 / v10 / v11 / v1 / v1.1、源码与文档）。结论只有：通过 / 部分 / 待 Key / 待资质 / 待人工 / 待真机 / 失败。缺证书、缺开发者账号的项永远不记“通过”；人工、真机、Key 项不由执行者代填。

## 统计

按验收项（22 项，每项一个结论）：

| 通过 | 部分通过 | 待 Key | 待资质 | 待人工 | 待真机 | 失败 |
|---|---|---|---|---|---|---|
| 19 | 1 | 0 | 0 | 1 | 1 | 0 |

按条目内检查项：待真机 2 · 待资质 1 · 待人工 1 · 待 Key 0。

- 部分 1 项：E22（GitHub Actions 被账单拦截：CI 结论、APK、桌面包、产物字节数与 sha256 均未取回；六个 package.json 已为 1.2.0，versionCode 按规则 1×10000+2×100+0 = 10200）。
- 待人工 1 项：E1（proposals-v1.2 P1 AGENTS.md 指挥职责引用、P2 SYSTEM.md 加载表、P3 BOUNDARIES.md 补句，等你确认；代码没有改核心文件正文）。
- 待真机 1 项：E14（定时工作流只在 App 打开时执行到期任务；App 关闭时的工作流提醒通知尚未接入系统通知，接入后需真机验证，见 deviations-v1.2 V12-05 / V12-06）。
- E22 内另有待真机 1（APK / 桌面包安装）、待资质 1（Windows 代码签名、Apple 开发者账号）。
- 待 Key 0：MiMo 实测已用注入的 Key 真实跑通（E21 通过）。

## 本次证据（2026-10-24 本地，1.2.0 升版提交 184313e 之上）

- 单测：shared 382/382；server 78/78；web 320 项 = 通过 314、跳过 6、失败 0（21 文件，分 3 批：out/vitest-web-1/2/3.json）；evals 70/70，eval-report 60/60。合计 850 条结果。
- lint 0 错误（2 条既有警告：未用的 eslint-disable）；typecheck 通过；i18n-audit --strict 通过（id 1571，英文缺失 0，未知 id 0，写死中文 0）；gen-vfs-defaults --check 通过（105 文件）；single-source-check S1–S5 通过；vfs-doctor 0 问题；完整 build 通过；密钥扫描（跟踪文件、git 历史、web/shared/server dist）未发现疑似密钥。
- walkthrough-v1.2（1.2.0 构建重跑）：新用户 17/17、1.1 老用户 19/19，控制台错误 0、页面报错 0，全部暂停 53 / 101 ms，老用户“我的”12 项（截图 shots-v1.2/walkthrough/，报告 docs/walkthrough/walkthrough-v1.2.json）。
- 截图矩阵 shots-v1.2：96 张（手机 / 平板 / 桌面 × 浅深 × 中英），溢出 / 重叠 / 截断 / 小触控 / 控制台 / 页面报错 / axe 严重 / axe 重要 均 0；self-review-v1.2 未处理 0。
- MiMo 实测（scripts/real-v1.2.mjs，mimo-v2.6-flash，Key 由网络层注入）：超级 Agent 写母稿 → 平台适配编辑（小红书 + B 站）→ 合规审核员（退回一次后通过）→ 审批节点，工作流 done；花费 ¥0.005294（上限 ¥2）；findSecrets 0，未记录请求头。
- 回归：accept-v9 通过 45 · 部分 7 · 待真机 2 · 待 Key 2 · 失败 0；accept-v10 通过 18 · 部分 1 · 待真机 7 · 失败 0；accept-v11 通过 20 · 待 Key 4 · 待人工 1 · 失败 0；accept-v1 通过 17 · 待资质 2 · 待人工 2 · 待真机 2 · 失败 0；accept-v1.1 通过 14 · 部分 2 · 待人工 1 · 失败 0。
- accept-v1.1 的 D16 报告产物名、D17 版本改为回归写法（≥ reports-1.1.0、≥ 1.1.0）。
- CI：GitHub Actions 被账单拦截，本次不以 CI 为证据。

## 逐项

| 编号 | 验收项 | 结论 | 证据 |
|---|---|---|---|
| E1 | 超级 Agent 身份与指挥职责生效，核心文件改动仅以修订建议形式存在 | 待人工 | ✓ E1 超级 Agent 身份：1 项，通过 1（vitest-shared.json）<br>✓ 控制平面 shared/src/super/governance.ts 存在<br>✓ proposals-v1.2.md 含 AGENTS.md“指挥职责”修订建议（核心文件只以修订建议存在）<br>✓ 批准 P1 才写 AGENTS.md：1 项，通过 1（vitest-web-3.json）<br>👤 待人工：proposals-v1.2 中 P1 / P2 / P3 等你确认（核心文件修订，代码未改正文） |
| E2 | 权限分级 L0–L3 + 禁止级；工具全部标级；越权被拒并审计 | 通过 | ✓ E2 权限分级：3 项，通过 3（vitest-shared.json）<br>✓ E2 工具全部标级：1 项，通过 1（vitest-shared.json） |
| E3 | 按 Agent 预算；超额度暂停进审批 | 通过 | ✓ E3 按 Agent 预算：2 项，通过 2（vitest-shared.json）<br>✓ 超额度：暂停并给出审批事项：1 项，通过 1（vitest-shared.json）<br>✓ 超额度：不执行、暂停该子 Agent：1 项，通过 1（vitest-web-3.json） |
| E4 | 审批收件箱汇总 6 类事项，批准、拒绝、修改后批准均可用 | 通过 | ✓ E4 审批收件箱 >：2 项，通过 2（vitest-shared.json）<br>✓ E4 审批收件箱（App）：2 项，通过 2（vitest-web-3.json） |
| E5 | 全部暂停 ≤1 秒停止全部运行与定时；单项暂停可用 | 通过 | ✓ E5 全部暂停 >：2 项，通过 2（vitest-shared.json）<br>✓ E5 全部暂停（App）：1 项，通过 1（vitest-web-3.json）<br>✓ walkthrough 实测全部暂停耗时：[53,101] ms（≤1000） |
| E6 | 目标设定与进度，只显示有数据依据的数字 | 通过 | ✓ E6 目标与进度：2 项，通过 2（vitest-shared.json）<br>✓ 无数据写“待录入”（shared/src/super） |
| E7 | 子 Agent 增删改、模板 8 个、导入导出、权限为父级子集 | 通过 | ✓ E7 子 Agent 增删改与模板：5 项，通过 5（vitest-shared.json）<br>✓ 子级权限是父级子集：1 项，通过 1（vitest-shared.json）<br>✓ E7 / E8 / E9 子 Agent 在 App 里：3 项，通过 3（vitest-web-3.json） |
| E8 | 深度 ≤3、并发上限、交接契约 Schema 校验、退回一次 | 通过 | ✓ E8 深度、并发、交接契约、退回一次：6 项，通过 6（vitest-shared.json） |
| E9 | 任务板状态流转正确 | 通过 | ✓ E9 任务板状态流转：1 项，通过 1（vitest-shared.json）<br>✓ 任务板 待办→进行中→待验收→完成：1 项，通过 1（vitest-web-3.json） |
| E10 | 子 Agent 独立成长记录；低风险自动采纳，职责与权限改动需确认 | 通过 | ✓ E10 成长记录与改动分级：2 项，通过 2（vitest-shared.json） |
| E11 | 自定义平台三种创建方式；能力与内置平台一致且无自动发布 / 互动 | 通过 | ✓ E11 自定义平台：4 项，通过 4（vitest-shared.json）<br>✓ E11 / E13 自定义平台（App）：1 项，通过 1（vitest-web-3.json）<br>✓ 界面写明“发布与互动都由你本人在官方 App 内完成”（web/src/locales/zh.ts） |
| E12 | 平台模板规格附来源与核对日期，未核实字段标注 | 通过 | ✓ E12 平台模板规格附来源与核对日期：1 项，通过 1（vitest-shared.json）<br>✓ docs/refs-v1.2/platforms.md 含来源与核对日期，未核实字段标“待核实” |
| E13 | 自定义软件入口与四类数据源；数据源可授权给子 Agent | 通过 | ✓ E13 自定义软件入口与四类数据源：5 项，通过 5（vitest-shared.json） |
| E14 | 工作流：定义、三类触发、3 个模板、审批节点、提议保存 | 待真机 | ✓ E14 工作流 >：5 项，通过 5（vitest-shared.json）<br>✓ E14 工作流（App）：1 项，通过 1（vitest-web-3.json）<br>📱 待真机：定时工作流只在 App 打开时执行到期任务；App 关闭时的工作流提醒通知尚未接入系统通知，接入后需真机验证（deviations-v1.2 V12-05 / V12-06） |
| E15 | MCP 客户端兼容两版规范；逐工具授权；社交互动类工具被拒 | 通过 | ✓ E15 MCP 客户端：4 项，通过 4（vitest-shared.json）<br>✓ 本机模拟 MCP 服务器（两版规范） 存在 |
| E16 | A2A 客户端 / 服务端开关默认关闭，开启后受同等治理 | 通过 | ✓ E16 A2A（beta，默认关闭）：4 项，通过 4（vitest-shared.json）<br>✓ E16 A2A 服务端：3 项，通过 3（vitest-server.json） |
| E17 | 指挥台、指挥条、@子Agent；三布局截图 0 问题；axe 0 严重 | 通过 | ✓ E17 / E18 指挥台入口：1 项，通过 1（vitest-web-3.json）<br>✓ E17 @子Agent 点名：1 项，通过 1（vitest-shared.json）<br>✓ @子Agent：回复写明交给了谁：1 项，通过 1（vitest-web-3.json）<br>✓ 截图矩阵 96 张（phone 360×800 / tablet 834×1194 / desktop 1440×900 × 浅深 × 中英）：溢出 0、重叠 0、截断 0、触控<44 0、控制台 0、页面报错 0、axe 严重 0 / 重要 0 |
| E18 | “我的”仍 ≤12 项；single-source-check 通过 | 通过 | ✓ #command 是独立空间：1 项，通过 1（vitest-web-3.json）<br>✓ D9 “我的”≤12 项：1 项，通过 1（vitest-web-2.json）<br>✓ walkthrough 老用户“我的”入口 12（≤12）<br>✓ single-source-check：S1 ✓、S2 ✓、S3 ✓、S4 ✓、S5 ✓ |
| E19 | 六个历史版本备份迁移与降级通过 | 通过 | ✓ E19 六个历史版本备份：7 项，通过 7（vitest-web-3.json）<br>✓ 覆盖 0.9 / 0.10 / 0.11 / 1.0 / 1.1 / 1.2 六个版本（web/src/v12/migrate.test.tsx） |
| E20 | walkthrough 两条路径通过；self-review 无未处理项 | 通过 | ✓ scripts/walkthrough-v1.2.mjs 存在<br>✓ 新用户：17/17 步通过，截图 17 张，控制台错误 0，页面报错 0<br>✓ 1.1 备份用户：19/19 步通过，截图 19 张，控制台错误 0，页面报错 0<br>✓ self-review-v1.2.md：8 条，未处理 0 |
| E21 | MiMo 实测通过，花费 ≤¥2，无 Key 泄漏 | 通过 | ✓ 实测 通过：workflowDone ✓、twoSubAgentsDone ✓、adaptedHasBoth ✓、reviewOnlyNotes ✓、withinBudget ✓<br>✓ 子 Agent 任务：platform-adapter done、compliance-reviewer done（退回 1）<br>✓ 花费 ¥0.005294（上限 ¥2，按 shared/models/pricing.ts 价目 × 实际 usage 计）<br>✓ trace 密钥命中 0，findSecrets 0，记录请求头：否 |
| E22 | 全部回归与 CI 通过；1.2.0 / 10200；APK、zip、桌面包已取回并记录字节数与 sha256 | 部分 | ✓ package.json 1.2.0<br>✓ shared/package.json 1.2.0<br>✓ server/package.json 1.2.0<br>✓ web/package.json 1.2.0<br>✓ desktop/package.json 1.2.0<br>✓ mobile/package.json 1.2.0<br>✓ server 依赖 @content-agent/shared 1.2.0<br>✓ web 依赖 @content-agent/shared 1.2.0<br>✓ package-lock 工作区版本 1.2.0<br>✓ server /api/health 1.2.0（server/src/app.ts）<br>✓ A2A Agent Card 版本 1.2.0（server/src/app.ts）<br>✓ 本机 /api/health 1.2.0（web/src/local/router.ts）<br>✓ versionCode = x*10000+y*100+z（1.2.0 → 10200）（mobile/scripts/apply-native.mjs）<br>✓ CI 跑 accept-v1.2 --strict（.github/workflows/ci.yml）<br>✓ CI 报告产物 reports-1.2.0（.github/workflows/ci.yml）<br>✓ CI 在 accept 之前现场生成 out/vitest-*.json<br>✓ 未使用 android-actions/setup-android<br>✓ CI 不部署 154.8.183.93<br>✓ accept-v9：失败 0<br>✓ accept-v10：失败 0<br>✓ accept-v11：失败 0<br>✓ accept-v1：失败 0<br>✓ accept-v1.1：失败 0<br>✓ i18n：英文缺失 0、未知 id 0<br>△ CI 结论未取回（GitHub Actions 被账单拦截，以本地验证为准；docs/release/ci-v1.2.json 待 CI 恢复后写入）<br>△ APK 未取回（CI 被账单拦截；docs/release/apk-manifest-v1.2.json）<br>△ 桌面包未取回（CI 被账单拦截；docs/release/desktop-manifest-v1.2.json）<br>△ 产物字节数与 sha256 未记录（docs/release/artifacts-v1.2.json）<br>📱 待真机：APK 在安卓手机安装、Windows / Mac 双击安装（未签名）<br>📜 待资质：Windows 代码签名证书、Apple 开发者账号（签名 / 公证 / TestFlight） |
