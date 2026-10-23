# 0.11.0 逐项验收（acceptance-v11）

依据 design/ROADMAP.md「0.11 真实联调与质量」；由 `node scripts/accept-v11.mjs` 生成证据表（out/accept-v11.json / .md），CI verify 作业带 `--strict` 运行。偏离与说明见 design/deviations-v11.md。

**合计：通过 20 · 部分 0 · 待 Key 4 · 待人工 1 · 待真机 0 · 失败 0**（2026-10-23T11:03:54.403Z，本地；真实花费 ¥0.1424）

## 待 Key（用户未提供，未实测，未编造）
- P1 百炼 dashscope：文本 / 生图 / 配音 / 转写；P2 智谱；P3 火山方舟；P4 MiniMax。拿到 Key 后：在 App“我的 → 模型 → 账号与 Key”填写并“测试连接”，或经安全表单交给执行者，按 scripts/real-v11.mjs 的同一方式补 trace，把对应适配器 declare 的 verified 由 doc 改为 live。

## 待人工（由用户做）
- J4 判官与人工抽检一致率 ≥ 90%：打开 app/evals/real/judge-sample-v11.md，7 条（BQ-01, BQ-02, BQ-03, BQ-04, BQ-05, BQ-08, BQ-09）各填“通过 / 不通过”。执行者是 AI，没有代填。

## 仍待真机（沿用 0.10）
- 本版没有新增真机项；0.10 的 K7 / K8 / K9 / A6 / T2 / N2 / N3 仍待真机（design/acceptance-v10.md）。真实模型调用本轮在 Node 里经同一能力层完成，安卓 WebView 内的真实调用仍以 T2 为准。

## 证据表

| 编号 | 验收项 | 结论 | 证据 |
|---|---|---|---|
| E0 | CI：外部工具安装有超时与降级（run 39938123873 卡在 apt），各作业 timeout-minutes，不用 android-actions/setup-android | 通过 | ✓ 外部工具步骤：timeout-minutes 6 + continue-on-error + 非交互<br>✓ verify / check / android-debug-apk 均有作业级 timeout-minutes<br>✓ 未使用 android-actions/setup-android（uses 行）<br>✓ CI 跑 accept:v11（.github/workflows/ci.yml） |
| M1 | MiMo chat 流式：首字 < 3 s（真实调用，3 次取中位数） | 通过 | ✓ mimo-v2.6-flash：首字 1013 / 1376 / 1307 ms，中位数 1307 ms（2026-10-23T10:40:41.349Z） |
| M2 | MiMo reason：返回思考内容 | 通过 | ✓ mimo-v2.6-flash thinking=enabled：reasoning 1128 字、正文 160 字，用时 13859 ms，经 v9 callRole |
| M3 | MiMo TTS：音频可播 | 通过 | ✓ mimo-v2.5-tts：audio/wav，268844 字节，ffprobe pcm_s16le 24000 Hz，时长 5.600000 s，ffmpeg 完整解码 无错 |
| M4 | MiMo ASR：文本非空 | 通过 | ✓ mimo-v2.5-asr：转写“你好，这是超级工作台的配音测试，本段语音由人工智能合成。”，与 TTS 原文字符重合率 1 |
| M5 | trace 存 out/real-trace-0.11.json（入库副本 evals/real/），不含 Key；真实花费 ≤ ¥5 | 通过 | ✓ trace / 判官报告密钥模式命中 0（keyMode：网络层按主机注入（脚本未读取真实 Key））<br>✓ out/real-trace-0.11.json 存在<br>✓ 真实花费：联调 ¥0.002127 + 判官 ¥0.140297 = ¥0.1424（预算 ¥5；TTS 限时免费，ASR ¥0.5/h 按时长计）<br>✓ ASR 时长计费单测：6 项，通过 6（vitest-shared.json） |
| M6 | 能力声明：MiMo 已实测的 chat / reason / tts / asr 为 live；vision、voiceclone 未实测仍为 doc | 通过 | ✓ verified 单测：1 项，通过 1（vitest-shared.json）<br>✓ mimo.ts tts live（shared/src/models/adapters/mimo.ts）<br>✓ vision 仍 doc（shared/src/models/adapters/mimo.ts） |
| P1 | 百炼 dashscope（文本 / 生图 / 配音 / 转写）逐家实测 | 待 Key | 🔑 待 Key：用户未提供百炼 Key，未实测；能力声明保持 doc（不编造）<br>✓ 未实测保持 doc 单测：1 项，通过 1（vitest-shared.json） |
| P2 | 智谱 zhipu 至少 1 个角色实测 | 待 Key | 🔑 待 Key：用户未提供智谱 Key，未实测；能力声明保持 doc |
| P3 | 火山方舟 ark 至少 1 个角色实测 | 待 Key | 🔑 待 Key：用户未提供方舟 Key，未实测；能力声明保持 doc |
| P4 | MiniMax 至少 1 个角色实测 | 待 Key | 🔑 待 Key：用户未提供 MiniMax Key，未实测；能力声明保持 doc |
| J1 | evals/judge.ts：BQ-01–BQ-32 用真实快速模型做判官，temperature 0 | 通过 | ✓ evals/judge.ts 存在<br>✓ 判官模型 mimo-v2.6-flash（evals/judge.ts）<br>✓ 判官报告：32 条，temperature 0<br>✓ 判官离线单测：6 项，通过 6（vitest-shared.json） |
| J2 | 真实判官跑完 32 条（被测回复由真实模型在 App 系统前缀下生成） | 通过 | ✓ live：判 32 条，通过 28、不通过 4（BQ-03、BQ-12、BQ-20、BQ-24）<br>注：不通过的是真实模型行为问题（见 deviations-v11 V11-5），不是判官故障 |
| J3 | 判官一致率：对照集 / 规则判官 / 重复判（能测的都测） | 通过 | ✓ 对照集（合成标注）64/64 = 1<br>✓ 重复判 8/8 = 1<br>✓ 规则判官 12/14 = 0.857（分歧 2 条经查是规则过粗：只数问号，见 deviations-v11 V11-4） |
| J4 | 人工抽检 20%：判官结论与人工一致率 ≥ 90% | 待人工 | ✓ 抽检表 evals/real/judge-sample-v11.md 存在<br>👤 待人工：7 条（BQ-01、BQ-02、BQ-03、BQ-04、BQ-05、BQ-08、BQ-09）待用户填写“人工结论”；执行者是 AI，未代填 |
| L1 | agent.runtime.v9 开关到期，删除旧 agent/loop.ts 路径 | 通过 | ✓ web/src/agent/loop.ts 已删除<br>✓ flags.ts 无 agent.runtime.v9（shared/src/core/flags.ts）<br>✓ AgentPanel 只调 runTurnV9（web/src/shell/AgentPanel.tsx）<br>✓ 开关移除单测：1 项，通过 1（vitest-shared.json） |
| L2 | 全部 0.8 回归测试改为在 v9 运行时上通过 | 通过 | ✓ B5 / B8 / B10 / 停止：5 项，通过 5（vitest-web-a.json）<br>✓ B13 检查点（task_resume）：5 项，通过 5（vitest-web-a.json）<br>✓ 切模型标注：3 项，通过 3（vitest-web-a.json）<br>✓ agent.test 调 runTurnV9（web/src/agent.test.tsx）<br>✓ v081.test 调 runTurnV9（web/src/v081.test.tsx） |
| L3 | ADR-005 重审 | 通过 | ✓ ADR-005 重审段落（docs/adr/ADR-005.md）<br>✓ design/ADR/ADR-005.md 同步 |
| V1 | search.vector：experimental → beta；记忆与素材 BM25 + 向量混合（无向量 Key 用本机轻量嵌入，如实标注） | 通过 | ✓ 开关单测：1 项，通过 1（vitest-shared.json）<br>✓ hybridSearch（shared/src/vfs/search.ts）<br>✓ engine 检索接入（web/src/v9/engine.ts）<br>✓ 失败退回：1 项，通过 1（vitest-shared.json） |
| V2 | 检索前 5 命中率在 30 条样例上 ≥ 0.8 | 通过 | ✓ 30 条：混合 0.967 · BM25 0.767 · 纯向量 0.967；换说法类 BM25 0.3 → 混合 0.9（localEmbed（本机轻量嵌入：哈希 n-gram + 领域同义词表，非语义模型））<br>✓ 检索评测单测：1 项，通过 1（vitest-shared.json） |
| U1 | 保持 Hark 式 UI 与 i18n（本版无新界面文案；开关说明经 FLAGS 自动展示） | 通过 | ✓ i18n 单测：2 项，通过 2（vitest-shared.json）<br>✓ 未引入渐变等新视觉（web/src/styles.css） |
| D1 | 文档：acceptance-v11、deviations-v11、ADR、CHANGELOG、使用说明 .md/.docx、STATUS.md | 通过 | ✓ acceptance-v11.md 存在（design/acceptance-v11.md）<br>✓ deviations-v11.md 存在（design/deviations-v11.md）<br>✓ CHANGELOG 0.11.0（CHANGELOG.md）<br>✓ 使用说明.md 含 0.11（使用说明.md）<br>✓ 使用说明.docx 存在<br>✓ STATUS.md 含 0.11.0（CI 无项目根时跳过） |
| X1 | 版本 0.11.0 / versionCode 1100 | 通过 | ✓ package.json 0.11.0<br>✓ versionCode 按版本计算（0.11.0 → 1100）（mobile/scripts/apply-native.mjs）<br>✓ APK 尚未取回（CI 成功后写 out/apk-manifest-v11.json） |
| X2 | 回归：accept:v9、accept:v10 失败 0 | 通过 | ✓ accept-v9：{"pass":46,"partial":6,"pending_device":2,"pending_key":2,"fail":0}<br>✓ accept-v10：{"通过":19,"待真机":7} |
| X3 | 硬边界：不做多账号 / 自动互动 / 刷量 / 绕风控 / 抓私有数据；发布用户点击；回复只草稿；不部署 154.8.183.93 | 通过 | ✓ 内置工具无对外写入<br>✓ CI 不部署 154.8.183.93（.github/workflows/ci.yml）<br>✓ boundaries.ts 存在（server/src/boundaries.ts） |
