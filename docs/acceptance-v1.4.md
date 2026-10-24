# 1.4.0 逐项验收（acceptance-v1.4）

由 `node scripts/accept-v1.4.mjs --strict` 生成（证据：本地现场生成的单测结果 out/vitest-{shared,server,web,evals}.json、i18n-audit、walkthrough-v1.4、截图矩阵 docs/shots/shots-v1.4.json、self-review-v1.4、MiMo 实测 evals/real/mimo-v1.4.json、refs-v1.4、proposals-v1.4、回归验收 accept-v9 / v10 / v11 / v1 / v1.1 / v1.2 / v1.3、源码与文档）。结论只有：通过 / 部分 / 待 Key / 待资质 / 待人工 / 待真机 / 失败；待真机、待资质、待 Key、待人工项按事实标注，不写成“通过”。

## 统计

按验收项（26 项，G1–G25 + 第十九部分 G26，每项一个结论）：

| 通过 | 部分通过 | 待 Key | 待资质 | 待人工 | 待真机 | 失败 |
|---|---|---|---|---|---|---|
| 25 | 1 | 0 | 0 | 0 | 0 | 0 |

按条目内检查项：待真机 1 · 待资质 1 · 待人工 0 · 待 Key 0。

- 部分 1 项：G25（GitHub Actions 被账单拦截：CI 结论、APK、桌面包、产物字节数与 sha256 均未取回；六个 package.json 已为 1.4.0，versionCode 按规则 1×10000+4×100+0 = 10400）。
- G25 内另有待真机 1（APK 在安卓手机安装、Windows / Mac 双击安装）、待资质 1（Windows 代码签名证书、Apple 开发者账号）。
- G21 本次通过：proposals-v1.4 已写入章程、DOA、独立性规则、治理成本上限（另含商机评审门槛 P5）。
- 待 Key 0：MiMo 实测已用注入的 Key 真实跑通（G24 通过）。
- 脚本未计入、但需要你做的事：proposals-v1.4 P1–P5 待你在 App 内确认（P6 可选）；不确认不影响上市公司模式使用。

## 本次证据（2026-10-24 本地）

- 单测：shared 486/486；server 78/78；web 354 项 = 通过 348、跳过 6、失败 0；evals 70/70，eval-report 60/60。合计 988 条结果（全部本次现场生成）。
- lint 0 错误（2 条既有警告：未用的 eslint-disable）；i18n-audit --strict 通过（id 2203，英文缺失 0，未知 id 0，写死中文 0）；single-source-check 通过；vfs-doctor 0 问题（105 个文件，51 个文件夹）；密钥扫描（跟踪文件、git 历史分 3 片）未发现疑似密钥（docs/release/regression-v1.4.md）。
- walkthrough-v1.4：新用户 21/21、1.3 集团用户升级 20/20（docs/walkthrough/walkthrough-v1.4.json）。
- 截图矩阵 shots-v1.4（封面改纯色后重截）：120 张（手机 / 平板 / 桌面 × 浅深 × 中英 × 10 页）+ 关键数字卡 12 张；溢字 / 挤压 / 溢出 / 重叠 / 截断 / 小触控 / 控制台 / 页面报错 / axe 严重 / axe 重要 均 0；英文中文残留 398 处仅报告（V14-06）。self-review-v1.4 未处理 0。
- MiMo 实测（scripts/real-v1.4.mjs）：董事会 / 内审 / 季报 / 发布会各一次，CEO 与报告正文 mimo-v2.6-pro，独立董事 / 内审 / 分析师 mimo-v2.6-flash 并标“独立性弱”；最终一次 ¥0.013623 / 12 次调用、13 项检查通过；三次合计 ¥0.047826 / 36 次（上限 ¥3）；trace 0 Key。
- 回归：accept-v9 通过 45 · 部分 7 · 待真机 2 · 待 Key 2 · 失败 0；accept-v10 通过 18 · 部分 1 · 待真机 7 · 失败 0；accept-v11 通过 20 · 待 Key 4 · 待人工 1 · 失败 0；accept-v1 通过 17 · 待资质 2 · 待人工 2 · 待真机 2 · 失败 0；accept-v1.1 通过 14 · 部分 2 · 待人工 1 · 失败 0；accept-v1.2 通过 19 · 部分 1 · 待人工 1 · 待真机 1 · 失败 0；accept-v1.3 通过 21 · 部分 1 · 失败 0。
- CI：GitHub Actions 被账单拦截，本次不以 CI 为证据；未为 CI 改代码。

## 逐项

| 编号 | 验收项 | 结论 | 证据 |
|---|---|---|---|
| G1 | 股东会（年度大会）流程完整 | 通过 | ✓ G1 股东会（年度大会）流程完整：1 项，通过 1（vitest-shared.json）<br>✓ G16 / G17 / G18 接班、集团大学、学堂在 App 里：2 项，通过 2（vitest-web.json） |
| G2 | 董事会组成、独立性规则、议事规则、表决理由、董事长否决留痕 | 通过 | ✓ G2 董事会组成、独立性规则、议事规则、表决理由、董事长否决留痕：3 项，通过 3（vitest-shared.json）<br>✓ G2 / G21 董事会在 App 里：2 项，通过 2（vitest-web.json） |
| G3 | 战略、审计、提名与薪酬三个专门委员会，独立董事过半数 | 通过 | ✓ G3 战略、审计、提名与薪酬三个专门委员会，独立董事过半数：1 项，通过 1（vitest-shared.json） |
| G4 | 三道防线与风险登记册 | 通过 | ✓ G4 三道防线与风险登记册：2 项，通过 2（vitest-shared.json） |
| G5 | 内审：抽查、六类检查、报告直送、整改跟踪 | 通过 | ✓ G5 内审：抽查、六类检查、报告直送、整改跟踪：3 项，通过 3（vitest-shared.json）<br>✓ G5 / G7 / G8 / G11 / G12 / G13 一个月的模拟数据：1 项，通过 1（vitest-web.json） |
| G6 | 内控矩阵（COSO 五要素）与自动测试 | 通过 | ✓ G6 内控矩阵（COSO 五要素）与自动测试：1 项，通过 1（vitest-shared.json）<br>✓ 内控矩阵按 COSO 五要素，声明“不构成法律意见” |
| G7 | 月度经营分析（平衡计分卡 + 五列差距表），只用可验证数据 | 通过 | ✓ G7 月度经营分析（平衡计分卡 + 五列差距表），只用可验证数据：1 项，通过 1（vitest-shared.json） |
| G8 | 全面预算、偏差预警、调整审批 | 通过 | ✓ G8 全面预算、偏差预警、调整审批：3 项，通过 3（vitest-shared.json） |
| G9 | 投入产出看板 | 通过 | ✓ G9 投入产出看板：1 项，通过 1（vitest-shared.json） |
| G10 | 董事长简报 | 通过 | ✓ G10 董事长简报：2 项，通过 2（vitest-shared.json） |
| G11 | 季报、年报 11 个章节，数字可追溯，导出 PDF 与 docx，使用笔名 | 通过 | ✓ G11 季报、年报 11 个章节，数字可追溯，导出 PDF 与 docx，使用笔名：6 项，通过 6（vitest-shared.json）<br>✓ walkthrough 两条路径导出季报 PDF 与 docx |
| G12 | 一致性检查阻止错误报告 | 通过 | ✓ G12 一致性检查阻止错误报告：2 项，通过 2（vitest-shared.json）<br>✓ 1.4 MiMo 实测发现的回归 > 花费 at 不是 ISO 开头也计入损益：1 项，通过 1（vitest-shared.json） |
| G13 | 业绩发布会 | 通过 | ✓ G13 业绩发布会：2 项，通过 2（vitest-shared.json）<br>✓ 1.4 MiMo 实测发现的回归 > 发布会：1 项，通过 1（vitest-shared.json） |
| G14 | 战略规划（BLM 八步、战略地图、三情景、拆解为 OKR） | 通过 | ✓ G14 战略规划（BLM 八步、战略地图、三情景、拆解为 OKR）：4 项，通过 4（vitest-shared.json） |
| G15 | 提名、薪酬（资源激励）规则公开 | 通过 | ✓ G15 提名、薪酬（资源激励）规则公开：2 项，通过 2（vitest-shared.json） |
| G16 | 接班人计划：影子上岗、盲评、交接、回滚 | 通过 | ✓ G16 接班人计划：影子上岗、盲评、交接、回滚：2 项，通过 2（vitest-shared.json） |
| G17 | 集团大学：案例库、入职培训测验、最佳实践、知识健康度 | 通过 | ✓ G17 集团大学：案例库、入职培训测验、最佳实践、知识健康度：4 项，通过 4（vitest-shared.json） |
| G18 | 董事长学堂：20 张以上卡片、每周一课、徽章、术语悬停 | 通过 | ✓ G18 董事长学堂：20 张以上卡片、每周一课、徽章、术语悬停：4 项，通过 4（vitest-shared.json） |
| G19 | 治理分区界面三种布局截图 0 问题，axe 0 严重 | 通过 | ✓ G19 治理分区界面：1 项，通过 1（vitest-web.json）<br>✓ 截图矩阵 12 组合 × 10 页 = 120 张（含经营收入页）：溢出 0 重叠 0 截断 0 小触控 0 溢字 0 挤压 0 控制台 0 报错 0；英文中文残留（仅报告）398<br>✓ axe 严重 0 / 重要 0 |
| G20 | 上市公司模式默认关闭，可启用、可退回；诚实声明 | 通过 | ✓ G20 上市公司模式默认关闭，可启用、可退回；诚实声明：1 项，通过 1（vitest-web.json）<br>✓ G20 上市公司模式默认关闭（状态）：1 项，通过 1（vitest-shared.json）<br>✓ 诚实声明原文在 shared |
| G21 | 治理成本上限；治理不提升权限；硬边界决议被拒；不泄露 Key 与隐私 | 通过 | ✓ G21 治理成本上限；治理不提升权限；硬边界决议被拒；不泄露 Key 与隐私：3 项，通过 3（vitest-shared.json）<br>✓ G2 / G21 董事会在 App 里：2 项，通过 2（vitest-web.json）<br>✓ proposals-v1.4.md 含章程 / DOA / 独立性规则 / 治理成本上限（高风险改动只进 proposals） |
| G22 | 8 个历史版本的备份完成迁移与降级 | 通过 | ✓ G22 8 个历史版本备份：恢复 → 迁移 → 使用 → 降级：8 项，通过 8（vitest-web.json） |
| G23 | walkthrough 两条路径通过；self-review 无未处理项 | 通过 | ✓ walkthrough：fresh 21/21；legacy 20/20<br>✓ self-review-v1.4.md 未处理项 0 |
| G24 | MiMo 实测通过，花费 ≤ ¥3 | 通过 | ✓ MiMo：通过，最终一次 ¥0.013623、12 次；三次合计 ¥0.047826、36 次（≤¥3）；董事会 / 内审 / 季报 / 发布会齐全；Key 扫描 0<br>✓ 独立董事模型 mimo-v2.6-flash ≠ CEO mimo-v2.6-pro，标注“独立性弱（同一服务商的另一个模型）” |
| G25 | 全部回归通过；版本 1.4.0 / 10400；CI 恢复后取回 APK、zip、桌面包并记录字节数与 sha256（未取回如实标“部分”） | 部分 | ✓ package.json 1.4.0<br>✓ shared/package.json 1.4.0<br>✓ server/package.json 1.4.0<br>✓ web/package.json 1.4.0<br>✓ desktop/package.json 1.4.0<br>✓ mobile/package.json 1.4.0<br>✓ server 依赖 @content-agent/shared 1.4.0<br>✓ web 依赖 @content-agent/shared 1.4.0<br>✓ package-lock 工作区版本 1.4.0<br>✓ server /api/health 1.4.0（server/src/app.ts）<br>✓ A2A Agent Card 版本 1.4.0（server/src/app.ts）<br>✓ 本机 /api/health 1.4.0（web/src/local/router.ts）<br>✓ 备份 APP_VERSION 1.4.0<br>✓ versionCode = x*10000+y*100+z（1.4.0 → 10400）（mobile/scripts/apply-native.mjs）<br>✓ CI 跑 accept-v1.4 --strict（.github/workflows/ci.yml）<br>✓ CI 报告产物 reports-1.4.0（.github/workflows/ci.yml）<br>✓ 未使用 android-actions/setup-android<br>✓ CI 不部署 154.8.183.93<br>✓ accept-v9：失败 0<br>✓ accept-v10：失败 0<br>✓ accept-v11：失败 0<br>✓ accept-v1：失败 0<br>✓ accept-v1.1：失败 0<br>✓ accept-v1.2：失败 0<br>✓ accept-v1.3：失败 0<br>✓ i18n：英文缺失 0、未知 id 0<br>△ CI 结论未取回（GitHub Actions 被账单拦截，以本地验证为准）<br>△ APK 未取回（CI 被账单拦截）<br>△ 桌面包未取回（CI 被账单拦截）<br>△ 产物字节数与 sha256 未记录（CI 被账单拦截，未产出安装包）<br>📱 待真机：APK 在安卓手机安装、Windows / Mac 双击安装（未签名）<br>📜 待资质：Windows 代码签名证书、Apple 开发者账号（签名 / 公证 / TestFlight） |
| G26 | 经营收入与全球商机（损益表、商机卡、评审→提案→批准→工单、报告更新、越界拒绝、walkthrough） | 通过 | ✓ G26 经营收入与全球商机：7 项，通过 7（vitest-shared.json、vitest-web.json）<br>✓ G26 经营收入与全球商机（App 接线）：1 项，通过 1（vitest-web.json）<br>✓ walkthrough 两条路径含经营收入一步<br>✓ refs-v1.4 含商机官方来源（1 个文件） |
