# 1.1.0 逐项验收（acceptance-v1.1）

由 `node scripts/accept-v1.1.mjs` 生成（证据：本地现场生成的单测结果 out/vitest-*.json、single-source-check、i18n-audit、walkthrough-v1.1、MiMo 实测 evals/real/mimo-v1.1.json、截图矩阵报告、回归验收 accept-v9 / v10 / v11 / v1、源码与文档）。结论只有：通过 / 部分 / 待资质 / 待人工 / 待真机 / 失败。缺证书、缺开发者账号的项永远不记“通过”；人工与真机项不由执行者代填。

## 统计

按验收项（17 项，每项一个结论）：

| 通过 | 部分通过 | 待真机 | 待资质 | 待人工 | 失败 |
|---|---|---|---|---|---|
| 14 | 2 | 0 | 0 | 1 | 0 |

按条目内检查项（不另计结论，只说明“部分”里还缺什么）：待真机 1 · 待资质 1 · 待人工 1。

- 部分 2 项：D16（CI 结论未取回：GitHub Actions 当前被账单拦截，docs/release/ci-v1.1.json 未写入）、D17（APK / 桌面包 / 产物 sha256 未取回，同一原因；六个 package.json 已为 1.1.0，versionCode 按规则计算为 10100）。
- 待人工 1 项：D10（服务端 HARD_BOUNDARIES 改为从 BOUNDARIES.md 派生属硬边界改动，等你确认 proposals-v1.1 P1，见 deviations V11-05）。
- D17 内的待真机：APK 在安卓手机安装、Windows / Mac 双击安装；待资质：Windows 代码签名证书、Apple 开发者账号。

## 本次证据（2026-10-24 本地，提交 538dedc 之上的 1.1.0 升版）

- 单测：shared 330/330（14 文件）；server 75/75（5 文件）；web 304 项 = 通过 298、跳过 6、失败 0（19 文件，分 5 批跑后合并为 out/vitest-web.json）；evals 70/70（4 文件），eval-report 60/60。合计 779 条结果。
- lint 0 错误（2 条警告：未用的 eslint-disable）；typecheck 通过；i18n-audit --strict 通过（id 1370，英文缺失 0，未知 id 0）；single-source-check S1–S5 全部通过；完整 build 通过。
- walkthrough-v1.1：新用户 12/12、1.0 老用户 15/15（截图 shots-v1.1/walkthrough/，报告 docs/walkthrough/walkthrough-v1.1.json）。
- 回归：accept-v1 通过 17 · 部分 0 · 待资质 2 · 待人工 2 · 待真机 2 · 失败 0；accept-v11 通过 20 · 待 Key 4 · 待人工 1 · 失败 0；accept-v10 通过 18 · 部分 1 · 待真机 7 · 失败 0；accept-v9 通过 45 · 部分 7 · 待真机 2 · 待 Key 2 · 失败 0。
- accept-v1 的 X1 与 accept-v9 的 C40 已改为回归写法（版本 ≥1.0.0 / ≥0.9.0）；accept-v10 / v11 原已是回归写法。
- CI：GitHub Actions 被账单拦截，本次不以 CI 为证据。

## 逐项

| 编号 | 验收项 | 结论 | 证据 |
|---|---|---|---|
| D1 | conflict-audit-v1.1.md 覆盖 2.2 全部冲突，每条有处理与测试 | 通过 | ✓ conflict-audit-v1.1.md 存在（docs/ 或 ../design/）<br>✓ 2.2 冲突覆盖：10/10<br>✓ 条目 26（A 组 12，自查 14），含“穷尽依据”<br>✓ 每条都有处理与测试 |
| D2 | single-source-check 通过 | 通过 | ✓ single-source-check：S1 ✓、S2 ✓、S3 ✓、S4 ✓、S5 ✓<br>✓ CI 运行 single-source-check（.github/workflows/ci.yml） |
| D3 | 模型页无“角色 / 快速小模型 / 深度推理”独立行；未配置时只有一个主按钮 | 通过 | ✓ 未配置时只有一个主按钮：1 项，通过 1（vitest-web.json）<br>✓ 新模型页 ModelsHub 存在<br>✓ 模型页源码无“角色 / 快速小模型 / 深度推理”文案<br>✓ 界面无“快速小模型”独立行 |
| D4 | 接入多能力模型后能力覆盖一览自动点亮 | 通过 | ✓ 接入多能力模型后覆盖一览自动点亮：1 项，通过 1（vitest-web.json）<br>✓ 接入一个多能力模型后，覆盖一览自动点亮对应能力：1 项，通过 1（vitest-shared.json） |
| D5 | 思考开关在对话中可用，关闭时不走思考，计费与 trace 一致 | 通过 | ✓ 思考开关：关闭时请求不带思考、计费按实际返回记账：1 项，通过 1（vitest-shared.json）<br>✓ 思考是档位：1 项，通过 1（vitest-shared.json） |
| D6 | resolveModel 唯一调用链，单测覆盖五级优先级 | 通过 | ✓ resolveModel 五级优先级：8 项，通过 8（vitest-shared.json）<br>✓ resolveTarget 只是 resolveModel 的别名：1 项，通过 1（vitest-shared.json） |
| D7 | 旧写作助手代码与入口已删除；覆盖迁移为技能修订，可回滚 | 通过 | ✓ web/src/data/assistants.ts 已删除<br>✓ 源码无 AgentSub / AssistantEdit<br>✓ D7 旧写作助手删除：2 项，通过 2（vitest-web.json） |
| D8 | 写作默认自由创作；指定平台按技能适配；一稿多适配保留母稿 | 通过 | ✓ D8 自由创作为默认：2 项，通过 2（vitest-web.json）<br>✓ 自由创作技能 free-writing 存在 |
| D9 | “我的”入口 ≤12，旧路由重定向，命令面板旧词可搜 | 通过 | ✓ D9 “我的”≤12 项：1 项，通过 1（vitest-web.json） |
| D10 | 硬边界只读且与 BOUNDARIES 同源，代码中无第二份常量 | 待人工 | ✓ D10 硬边界只读：1 项，通过 1（vitest-web.json）<br>✓ 前端无第二份硬边界常量<br>👤 待人工：服务端 server/src/boundaries.ts 的 HARD_BOUNDARIES 改为从 BOUNDARIES.md 派生属于硬边界改动，等你确认 proposals-v1.1 P1（deviations V11-05） |
| D11 | 无截字标题；截图矩阵溢出、截断、重叠、控制台错误均为 0 | 通过 | ✓ 源码无截字标题（title/description/name… .slice(0,N)，N≥2）<br>✓ 截图矩阵 180 张（phone 360×800 / tablet 834×1194 / desktop 1440×900 × 浅深 × 中英）：横向溢出 0、重叠 0、截断 0、触控区<44px 0、控制台错误 0、页面报错 0、axe 严重 0 / 重要 0 |
| D12 | 四个历史版本备份迁移与降级测试通过 | 通过 | ✓ D12 四个历史版本备份：4 项，通过 4（vitest-web.json）<br>✓ schemaVersion 3 → 4 迁移与降级：2 项，通过 2（vitest-shared.json） |
| D13 | walkthrough 新用户与老用户两条路径全部通过并有截图 | 通过 | ✓ scripts/walkthrough-v1.1.mjs 存在<br>✓ 新用户：12/12 步通过，截图 12 张<br>✓ 1.0 备份用户：15/15 步通过，截图 15 张<br>✓ 老用户迁移后重复入口 0 |
| D14 | self-review-v1.1.md 无未处理项 | 通过 | ✓ self-review-v1.1.md：25 条，未处理 0 |
| D15 | MiMo 实测通过，花费 ≤¥1，无 Key 泄漏 | 通过 | ✓ 步骤：M0 ✓、free-writing ✓、thinking ✓、vision ✓、tts ✓<br>✓ 花费 ¥0.001708（上限 ¥1，按 shared/models/pricing.ts 价目 × 实际 usage 计（TTS 限时免费记 ¥0））<br>✓ trace 密钥命中 0，Key 片段出现在 trace：否 |
| D16 | 全部回归、扫描与 CI 作业 success | 部分 | ✓ CI 跑 accept-v1.1 --strict（.github/workflows/ci.yml）<br>✓ CI 报告产物 reports-1.1.0（.github/workflows/ci.yml）<br>✓ CI 在 accept 之前现场生成 out/vitest-*.json<br>✓ 未使用 android-actions/setup-android<br>✓ CI 不部署 154.8.183.93<br>✓ accept-v9：失败 0<br>✓ accept-v10：失败 0<br>✓ accept-v11：失败 0<br>✓ accept-v1：失败 0<br>✓ i18n：英文缺失 0、未知 id 0<br>△ CI 结论尚未取回（docs/release/ci-v1.1.json，CI 全绿后写入） |
| D17 | 版本 1.1.0 / 10100；APK、zip、桌面包已取回并记录字节数与 sha256 | 部分 | ✓ package.json 1.1.0<br>✓ shared/package.json 1.1.0<br>✓ server/package.json 1.1.0<br>✓ web/package.json 1.1.0<br>✓ desktop/package.json 1.1.0<br>✓ mobile/package.json 1.1.0<br>✓ versionCode = x*10000+y*100+z（1.1.0 → 10100）（mobile/scripts/apply-native.mjs）<br>△ APK 尚未取回（docs/release/apk-manifest-v1.1.json）<br>△ 桌面包尚未取回（docs/release/desktop-manifest-v1.1.json）<br>△ 产物字节数与 sha256 尚未记录（docs/release/artifacts-v1.1.json）<br>📱 待真机：APK 在你的安卓手机上安装、Windows / Mac 双击安装（未签名：SmartScreen“未知发布者”、Gatekeeper 需右键打开）<br>📜 待资质：Windows 代码签名证书、Apple 开发者账号（签名 / 公证 / TestFlight） |
