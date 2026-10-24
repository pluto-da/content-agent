# 1.3.0 逐项验收（acceptance-v1.3）

由 `node scripts/accept-v1.3.mjs --strict` 生成（证据：本地现场生成的单测结果 out/vitest-{shared,server,web,evals}.json、single-source-check、i18n-audit、walkthrough-v1.3、截图矩阵 docs/shots/shots-v1.3.json、self-review-v1.3、MiMo 实测 evals/real/mimo-v1.3.json、回归验收 accept-v9 / v10 / v11 / v1 / v1.1 / v1.2、源码与文档）。结论只有：通过 / 部分 / 待 Key / 待资质 / 待人工 / 待真机 / 失败；待真机、待资质、待 Key 项按事实标注，不写成“通过”。

## 统计

按验收项（22 项，每项一个结论）：

| 通过 | 部分通过 | 待 Key | 待资质 | 待人工 | 待真机 | 失败 |
|---|---|---|---|---|---|---|
| 21 | 1 | 0 | 0 | 0 | 0 | 0 |

按条目内检查项：待真机 1 · 待资质 1 · 待人工 0 · 待 Key 0。

- 部分 1 项：F22（GitHub Actions 被账单拦截：CI 结论、APK、桌面包、产物字节数与 sha256 均未取回；六个 package.json 已为 1.3.0，versionCode 按规则 1×10000+3×100+0 = 10300）。
- F22 内另有待真机 1（APK 在安卓手机安装、Windows / Mac 双击安装）、待资质 1（Windows 代码签名证书、Apple 开发者账号）。
- 待 Key 0：MiMo 实测已用注入的 Key 真实跑通（F21 通过）。
- 脚本未计入、但需要你做的事：proposals-v1.3 P1–P4（集团章程默认值、DOA 默认阈值、AGENTS.md 一行引用、会议花费 30% 提醒）待你在 App 内确认（deviations-v1.3 V13-10）；不确认不影响集团模式使用。

## 本次证据（2026-10-24 本地）

- 单测：shared 430/430；server 78/78；web 338 项 = 通过 332、跳过 6、失败 0；evals 70/70，eval-report 60/60。合计 916 条结果（全部本次现场生成）。
- lint 0 错误（2 条既有警告：未用的 eslint-disable）；typecheck 通过；i18n-audit --strict 通过（id 1885，英文缺失 0，未知 id 0，写死中文 0）；gen-vfs-defaults --check 通过（105 文件）；single-source-check S1–S5 通过；vfs-doctor 0 问题；完整 build 通过；密钥扫描（跟踪文件、git 历史、web / shared / server dist）未发现疑似密钥。
- walkthrough-v1.3：新用户 17/17、1.2 老用户 18/18，控制台错误 0（截图 shots-v1.3/walkthrough/，报告 docs/walkthrough/walkthrough-v1.3.json）。
- 截图矩阵 shots-v1.3：108 张（手机 / 平板 / 桌面 × 浅深 × 中英 × 9 页），溢字 / 挤压 / 溢出 / 重叠 / 截断 / 小触控 / 控制台 / 页面报错 / axe 严重 / axe 重要 均 0；英文中文残留 110 处仅报告。逐张看图复核见 self-review-v1.3（发现 12 项，未处理 0）。
- MiMo 实测（scripts/real-v1.3.mjs，mimo-v2.6-flash 讨论 + mimo-v2.6-pro 综合与决议，Key 由网络层注入）：临时会话 4 条后 √ 解散；三方三轮评审会 34 条发言、质询覆盖 100%、独立陈述互不可见、最长 300 字、决议未触碰硬边界；两匹马赛马盲评不露 Agent。第二次实测通过，¥0.143791 / 57 次调用；两次合计 ¥0.286274（上限 ¥3）；findSecrets 0，未记录请求头。
- 回归：accept-v9 通过 45 · 部分 7 · 待真机 2 · 待 Key 2 · 失败 0；accept-v10 通过 18 · 部分 1 · 待真机 7 · 失败 0；accept-v11 通过 20 · 待 Key 4 · 待人工 1 · 失败 0；accept-v1 通过 17 · 待资质 2 · 待人工 2 · 待真机 2 · 失败 0；accept-v1.1 通过 14 · 部分 2 · 待人工 1 · 失败 0；accept-v1.2 通过 19 · 部分 1 · 待人工 1 · 待真机 1 · 失败 0。
- accept-v1.2 的报告产物名检查改为回归写法（≥ reports-1.2.0）；CI 已加 accept-v1.3 --strict 与 reports-1.3.0。
- CI：GitHub Actions 被账单拦截，本次不以 CI 为证据。

## 逐项

| 编号 | 验收项 | 结论 | 证据 |
|---|---|---|---|
| F1 | 融合组织：4 职能部门 + 4 事业部 + 共享能力中心 + 5 委员会，可增删改合并 | 通过 | ✓ F1 融合组织：3 项，通过 3（vitest-shared.json）<br>✓ 组织模型 shared/src/group/org.ts 存在<br>✓ F9 / F10 / F11 / F12 / F13 在 App 里：1 项，通过 1（vitest-web.json） |
| F2 | DEPT / COMMITTEE 清单与编制上限 | 通过 | ✓ F2 DEPT / COMMITTEE 清单与编制上限：3 项，通过 3（vitest-shared.json）<br>✓ F16 集团模式默认关闭，可启用与退回 > 默认关闭；启用写入：1 项，通过 1（vitest-web.json） |
| F3 | 10 项制度齐全，注明参照来源；修改走 L3，可回滚 | 通过 | ✓ F3 10 项制度齐全：3 项，通过 3（vitest-shared.json）<br>✓ 制度注明“参照公开报道，非任何公司官方制度”<br>✓ proposals-v1.3.md 含集团章程与 DOA 默认值（高风险文件只进 proposals） |
| F4 | DOA 引擎执行，越权拦截并审计 | 通过 | ✓ F4 DOA 引擎执行：4 项，通过 4（vitest-shared.json）<br>✓ DOA 引擎 存在 |
| F5 | 集团上下文流与 OKR 公开、对齐请求；私密不泄漏 | 通过 | ✓ F5 集团上下文流与 OKR 公开：4 项，通过 4（vitest-shared.json）<br>✓ F5 / F6 目标 → 冲突：1 项，通过 1（vitest-web.json） |
| F6 | 临时会话 6 种触发、自动推荐成员、上限 / TTL / √ 解散、小结转工单、可升级为会议 | 通过 | ✓ F6 临时会话：6 项，通过 6（vitest-shared.json）<br>✓ F5 / F6 目标 → 冲突：1 项，通过 1（vitest-web.json） |
| F7 | 7 个常设会议室，含预约、会前文档、白板、主持、纪要、旁听介入、回放 | 通过 | ✓ F7 7 个常设会议室：4 项，通过 4（vitest-shared.json）<br>✓ F7 / F8 会议在 App 里：1 项，通过 1（vitest-web.json） |
| F8 | 讨论协议六步、独立陈述、质询全覆盖、防空转、表达规范打分 | 通过 | ✓ F8 讨论协议六步：4 项，通过 4（vitest-shared.json） |
| F9 | 赛马（≤3 匹、专项预算、盲评、落选入库、效果统计） | 通过 | ✓ F9 赛马：3 项，通过 3（vitest-shared.json）<br>✓ F9 / F10 / F11 / F12 / F13 在 App 里 > 赛马：1 项，通过 1（vitest-web.json） |
| F10 | 灰度试行与自动回滚 | 通过 | ✓ F10 灰度试行与自动回滚：2 项，通过 2（vitest-shared.json）<br>✓ 灰度：20% 试行：1 项，通过 1（vitest-web.json） |
| F11 | 否决、申诉、升级路径、董事长终裁 | 通过 | ✓ F11 否决、申诉、升级路径、董事长终裁：2 项，通过 2（vitest-shared.json）<br>✓ F11 否决须引用条款：1 项，通过 1（vitest-shared.json） |
| F12 | 复盘四步与 lesson 沉淀 | 通过 | ✓ F12 复盘四步与 lesson 沉淀：1 项，通过 1（vitest-shared.json）<br>✓ 季度复盘、360、政委建议：1 项，通过 1（vitest-web.json） |
| F13 | 360 评议、政委（只建议不指挥）、任免流程 | 通过 | ✓ F13 360 评议、政委、任免：3 项，通过 3（vitest-shared.json） |
| F14 | “统领”页 7 个子页完整，三布局截图 0 问题，axe 0 严重 | 通过 | ✓ F14 “统领”页 7 个子页：1 项，通过 1（vitest-web.json）<br>✓ F14 驾驶舱与指挥条入口：1 项，通过 1（vitest-web.json）<br>✓ 截图矩阵 12 组合 108 张：溢出 0 重叠 0 截断 0 小触控 0 溢字 0 挤压 0 控制台 0 报错 0；英文中文残留（仅报告）110<br>✓ axe 严重 0 / 重要 0 |
| F15 | @部门 / @委员会 / 拉群 / 开会 / 赛马 指令正确 | 通过 | ✓ F15 @部门 / @委员会 / 拉群 / 开会 / 赛马 指令：1 项，通过 1（vitest-shared.json）<br>✓ F15 对话指令：1 项，通过 1（vitest-web.json） |
| F16 | 集团模式默认关闭，可启用与退回 | 通过 | ✓ F16 集团模式默认关闭，可启用与退回：2 项，通过 2（vitest-shared.json、vitest-web.json） |
| F17 | 会话 / 会议 / 决议不提升权限；硬边界决议被拒 | 通过 | ✓ 会话不提升权限：1 项，通过 1（vitest-shared.json）<br>✓ 硬边界决议被拒：2 项，通过 2（vitest-shared.json）<br>✓ F17 / F18 全部暂停对集团生效：1 项，通过 1（vitest-web.json） |
| F18 | 开会花费占比与 30% 提醒 | 通过 | ✓ F18 开会花费占比与 30% 提醒：1 项，通过 1（vitest-shared.json） |
| F19 | 8 个历史版本备份迁移与降级通过 | 通过 | ✓ F19 8 个历史版本备份：8 项，通过 8（vitest-web.json） |
| F20 | walkthrough 两条路径通过；self-review 无未处理项 | 通过 | ✓ walkthrough：fresh 17/17；legacy 18/18<br>✓ self-review-v1.3.md 未处理项 0 |
| F21 | MiMo 实测通过，≤ ¥3，无 Key 泄漏 | 通过 | ✓ MiMo：通过，花费 ¥0.143791（≤¥3），57 次调用，Key 扫描 0 |
| F22 | 全部回归与 CI 通过；1.3.0 / 10300；APK、zip、桌面包取回并记录字节数与 sha256 | 部分 | ✓ package.json 1.3.0<br>✓ shared/package.json 1.3.0<br>✓ server/package.json 1.3.0<br>✓ web/package.json 1.3.0<br>✓ desktop/package.json 1.3.0<br>✓ mobile/package.json 1.3.0<br>✓ server 依赖 @content-agent/shared 1.3.0<br>✓ web 依赖 @content-agent/shared 1.3.0<br>✓ package-lock 工作区版本 1.3.0<br>✓ server /api/health 1.3.0（server/src/app.ts）<br>✓ A2A Agent Card 版本 1.3.0（server/src/app.ts）<br>✓ 本机 /api/health 1.3.0（web/src/local/router.ts）<br>✓ versionCode = x*10000+y*100+z（1.3.0 → 10300）（mobile/scripts/apply-native.mjs）<br>✓ CI 跑 accept-v1.3 --strict（.github/workflows/ci.yml）<br>✓ CI 报告产物 reports-1.3.0（.github/workflows/ci.yml）<br>✓ 未使用 android-actions/setup-android<br>✓ CI 不部署 154.8.183.93<br>✓ accept-v9：失败 0<br>✓ accept-v10：失败 0<br>✓ accept-v11：失败 0<br>✓ accept-v1：失败 0<br>✓ accept-v1.1：失败 0<br>✓ accept-v1.2：失败 0<br>✓ i18n：英文缺失 0、未知 id 0<br>△ CI 结论未取回（GitHub Actions 被账单拦截，以本地验证为准）<br>△ APK 未取回（CI 被账单拦截）<br>△ 桌面包未取回（CI 被账单拦截）<br>△ 产物字节数与 sha256 未记录（CI 被账单拦截，未产出安装包）<br>📱 待真机：APK 在安卓手机安装、Windows / Mac 双击安装（未签名）<br>📜 待资质：Windows 代码签名证书、Apple 开发者账号（签名 / 公证 / TestFlight） |
