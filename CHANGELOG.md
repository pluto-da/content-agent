# 变更日志

## 1.2.0（2026-10-24）超级 Agent 指挥体系：你管超级 Agent，超级 Agent 管子 Agent、平台、工作流与外部工具
- **控制平面**（shared/src/super/governance.ts）：权限分级 L0 只读 / L1 本机写 / L2 花钱·外联 / L3 核心 + 禁止级，工具注册表全部标级，按“调用者授权 ∩ 工具级别”判定并写审计，子级权限永远是父级子集；按 Agent 预算（全局月度 → 子 Agent 默认 ¥3/月 → 单次上限 ¥1），超额度暂停并进审批、不挪用；审批收件箱 6 类（花钱超阈值、L3 动作、核心文件修订、新建子 Agent、新平台技能、外部工具启用），批准 / 拒绝 / 修改后批准；一键“全部暂停”取消运行、排队、定时与外部工具（walkthrough 实测 53 / 101 ms），恢复只能手动；单项暂停；目标与进度只用录入或导入的数据，没有数据写“待录入”，周复盘草稿。
- **超级 Agent 身份**：指挥职责写在非核心文件 super/SUPER.md（随新安装提供并加载）；AGENTS.md 的“指挥职责”引用只以修订建议存在（proposals-v1.2 P1，App 内进审批收件箱，批准后才写）。
- **子 Agent**：agents/<id>/AGENT.md（权限 ≤L2、工具白名单、技能、模型、预算、shared / private 记忆、日程、平台、createdBy）；8 个内置模板（选题研究员、平台适配编辑、视觉与配音制作、合规审核员、数据复盘分析师、收益分析师、评论回复草稿员、素材管理员）；从模板启用、一句话起草、.agent.zip 导入导出（Key 扫描、权限上限收窄、硬边界校验）；Orchestrator：深度 ≤3、并发 1–5（默认 3）、交接契约 Schema 校验、验收不合格退回一次、父级取消级联；任务板 待办 → 进行中 → 待验收 → 待你批准 → 完成 / 失败；独立成长记录（完成数、退回率、平均花费、采纳率），职责与权限改动走 L3，闲置 30 天只提示。
- **自定义平台**：platforms/<id>/PLATFORM.md 清单；三种创建方式（14 个模板复制 / 一句话起草 / 导入 .platform.zip），新平台写法技能进审批；PLATFORMS 改为“内置 + 用户”两源合并，用户平台存 VFS、随备份导出（不含 Key）；能力与内置平台完全一致，只有打开、复制、发布前检查、分屏、写法适配、数据导入，界面写明“发布与互动都由你本人在官方 App 内完成”。模板规格只有 YouTube、Instagram 的字段已核实（附来源与核对日期），其余标“待核实”。
- **软件与数据源**：任意 App / 网页入口（属于某平台或独立工具，能力只有打开）；四类数据源：RSS / Atom、守 robots 的公开页（只抓指定 URL、限频）、你自己的 CSV / Excel 导出（按平台映射模板）、官方开放接口（只存 secretRef）；数据源可授权给子 Agent。
- **工作流**：workflows/<id>.yaml（YAML 1.2 的 JSON 兼容写法），节点 Agent 步骤 / 条件 / 并行 / 人工审批 / 等待；手动、定时（启用需 L3；只在 App 打开时执行到期任务）、事件（素材箱新内容、导入新数据、草稿通过审核）三类触发；模板：每日选题晨报、一稿多发、周复盘；超级 Agent 可把一次成功的多步任务提议保存为工作流（L1 草稿）。
- **MCP 客户端**：Streamable HTTP，2026-07-28 无状态核心（server/discover、input_required 多轮）并兼容 2025-11-25（initialize 握手 + 会话头）；添加时列出全部工具逐个勾选、默认 L2、写入外部系统默认关闭且逐次确认；点赞 / 评论 / 私信 / 关注 / 发帖 / 批量操作社交账号类工具注册即拒，调用时二次检查；凭据只存引用、调用时现取。
- **A2A（beta，默认关闭）**：a2a.client / a2a.server 开关；客户端读取 /.well-known/agent-card.json 并校验 v1.0 必填字段，外部 Agent 受同等治理；服务端只在“连接自己的服务器”模式、A2A_SERVER=1 且口令 ≥16 位时开放，只暴露勾选技能、Bearer 鉴权、请求进待批列表不自动执行。
- **指挥台**（#command，侧栏 / 抽屉固定“指挥”）：我的团队、任务板、工作流、审批收件箱、目标与进度、连接；首页指挥条（运行中、待批、本月花费 / 预算、全部暂停 / 恢复）；对话中 @子Agent 直接交办，回复写明交给了谁、花了多少、结果在哪。“我的”仍为 12 项。
- **迁移**：migrateV12 幂等、迁移前快照、可回滚；0.9 / 0.10 / 0.11 / 1.0 / 1.1 / 1.2 六个版本备份 恢复 → 迁移 → 使用 → 降级 全过。ADR-015–018（子 Agent 体系、权限分级、MCP、A2A）。
- **自检**：walkthrough-v1.2 新用户 17/17、1.1 老用户 19/19；截图矩阵 96 张问题 0、axe 严重 / 重要 0；self-review-v1.2 未处理 0。
- **真实 MiMo 实测**（scripts/real-v1.2.mjs）：超级 Agent 写母稿 → 平台适配编辑（小红书 + B 站）→ 合规审核员（退回一次后通过）→ 审批节点，工作流完成；花费 ¥0.005294（上限 ¥2），trace 无 Key。
- **验收与回归**：scripts/accept-v1.2.mjs（E1–E22，进 CI --strict，报告产物 reports-1.2.0）：通过 19 · 部分 1 · 待人工 1 · 待真机 1 · 失败 0。本地：shared 382/382、server 78/78、web 314 通过 + 6 跳过、evals 70/70；accept-v9 / v10 / v11 / v1 / v1.1 失败 0。GitHub Actions 被账单拦截，CI 结论与安装包未取回。
- 已知限制：定时工作流只在 App 打开时运行；App 关闭时的工作流提醒通知尚未接入系统通知，待接入后真机验证；服务器执行定时工作流未实现（deviations-v1.2 V12-05–07）。
- 版本 1.2.0 / Android versionCode 10200。逐项验收 design/acceptance-v1.2.md，偏离 design/deviations-v1.2.md，待确认修订 design/proposals-v1.2.md。

## 1.1.0（2026-10-24）一个入口、一种写法：模型页归一、自由创作、一稿多平台、“我的”收敛到 12 项
- **模型页归一（我的 → 模型）**：去掉“角色 / 快速小模型 / 深度推理”等独立行，改为主模型卡 + 能力覆盖一览（对话、思考、看图、生图、改图、配音、转写、视频 8 格，接入后自动识别点亮，空格点“补一个”）+ 我的服务商 + 高级（按任务指定、备用模型、省钱档、检索、Key 共用、自定义服务商）。未配置时只有一个“接入第一个模型”按钮；接入走三步向导（选服务商 → 填 Key → 选模型），首启引导用的是同一个向导。对话输入框新增“深度思考”开关，关闭时请求不带思考，trace 与记账按实际返回记录。
- **唯一选模型链**：shared resolveModel(task, need)（按任务指定 → 主模型 → 同服务商 → 其他 → 补一个），runner.resolveTarget 只是别名；模型设置 schemaVersion 3 → 4（主模型 = 出现最多的对话模型，其余绑定转为按任务指定），迁移前快照可回滚。服务商能力表 docs/models-v1.1.md（每格附官方来源，核对 2026-10-24）。
- **自由创作**：新技能 free-writing 成为默认写法，写稿时平台可选；旧“写作助手”代码与入口删除，平台写法只从 Agent 技能读（“发到××时怎么写”）。1.0 里改过的写作助手覆盖自动迁移为技能修订（进版本历史、可回滚），模型覆盖转为按任务指定 write:<平台>；账号画像唯一真相源为 user/profile.md。
- **一稿多平台**：草稿“适配到平台”（draft_adapt）一次勾多个平台，每个平台各生成一篇适配稿，原稿作为母稿保留不变。
- **“我的”22 → 12 项**：模型、平台与软件（含数据源与热点来源）、账号画像、设定与硬边界（BOUNDARIES.md 只读）、记忆与技能、成长（含收益）、提醒、花钱、记录（日志 + 审计，顶部运行健康，筛选最近任务 / 失败 / 审批 / 花费 / 设定改动）、数据（备份 + 存储）、通用设置（含实验开关、重新开始引导）、连接自己的服务器。旧路由全部重定向，命令面板搜旧名称仍能找到。
- **单一来源检查**：scripts/single-source-check.mjs（S1“我的”≤12 无同义入口、S2 每个概念一个设置入口、S3 模型只走 resolveModel、S4 平台写法只从技能读、S5 硬边界与 BOUNDARIES.md 同源），进 CI；冲突矩阵 design/conflict-audit-v1.1.md（26 条）。
- **走查与截图**：scripts/walkthrough-v1.1.mjs（新用户 12/12、1.0 备份用户 15/15）；scripts/shots-v1.1.mjs 截图矩阵 180 张（手机 / 平板 / 桌面 × 浅 / 深 × 中 / 英），溢出、截断、重叠、控制台错误均 0；自审 docs/self-review-v1.1.md 25 条无未处理项。桌面触控目标按 WCAG 2.2 AA 24px 判定（手机与平板仍 44px，deviations V11-09）。
- **真实 MiMo 实测**：scripts/real-v1.1.mjs（自由创作、思考开关开 / 关、看图、配音）5/5 通过，花费 ¥0.001708，trace 密钥命中 0。
- 版本 1.1.0 / Android versionCode 10100 / iOS CFBundleVersion 10100。逐项验收 design/acceptance-v1.1.md（scripts/accept-v1.1.mjs：通过 14 · 部分 2 · 待资质 0 · 待人工 1 · 待真机 0 · 失败 0），偏离 design/deviations-v1.1.md，待确认修订 design/proposals-v1.1.md。accept-v1 的 X1、accept-v9 的 C40 改为版本回归写法。

## 1.0.0（2026-10-23）可以放心长期用：费用护栏、存储治理、可访问性与多语言、进化分级、三端安装包
- **费用护栏**（shared/agent/policy.ts，我的 → 设置）：月度预算、按能力的日上限、异常花费只提醒；超预算的每一次花钱一定先问、不能“记住此类”，对话开跑前也先问；每笔花费写审计并指向用量记录。
- **存储治理**（我的 → 存储）：媒体索引与配额（默认 1 GB）、清理任务（启动 15 秒后 + 每 6 小时，默认只提醒，被引用 / 最近 / 保留的不清）、设定文件版本修剪可视化。1 GB 不可压缩媒体压测：首屏中位 480 ms（沙盒 Chromium、CPU 4 倍降速，目标 < 2 s）。
- **可访问性与多语言**：界面文案统一 id 制（1274 个 id），英文缺失 0、写死中文 0；读屏标签；axe 扫描 27 页 × 手机浅 / 深 / 电脑 × 中 / 英，critical 0 / serious 0；ADR-007 重审；CI 加 i18n-audit --strict。
- **进化分级（ADR-014）**：记忆、技能、lesson 低风险改进校验后自动生效（写审计、成长记录标“自动采纳”、一键回滚、可关）；SOUL / AGENTS / SYSTEM 等核心设定与花钱策略仍须你确认。默认系统文件同步改写（每轮最多一个问题、不展示系统提示原文、低落时先共情），见 design/proposals-v1.0.md。
- **判官复测（真实 MiMo）**：BQ-20、BQ-24 改为通过；BQ-03、BQ-12 仍不通过（编号列表 / 一句要三项 = 变相连问），修订建议 P-1 待你确认；新出 BQ-10、BQ-23 两条（偶发异常输出 / 评测不给工具），如实记录。本次花费 ¥0.114。
- **桌面安装包（未签名）**：Windows NSIS、macOS dmg（Apple 芯片）。后端用 esbuild 打成单文件，不再整份打包 node_modules。CI 在 windows-latest / macos-latest 上构建 → 静默安装 → 首启 → 备份导出 → 恢复 → 卸载，并截图；产物推到 desktop-build-win / desktop-build-mac 分支。Key 用系统钥匙串（electron-safeStorage）。没有代码签名证书：Windows 会提示“未知发布者”，macOS 首次需右键打开（docs/desktop.md）。
- **iOS**：Capacitor iOS 工程由 CI 生成；新原生插件 SecureKeys（iOS 版，SecretBackend ios-keychain：主密钥存钥匙串、仅本机、CryptoKit AES-256-GCM）；内置网页用 SFSafariViewController（@capacitor/browser）；CI 在 macOS 上做无签名模拟器构建并截图（ios-build 分支）。TestFlight / 真机待 Apple 开发者账号（docs/ios.md）。
- **CI 修绿**：run 39949500676 的 accept:v10 / v11 失败是因为前面 lint 失败、单测与评测步骤被跳过（没有 out/vitest-*.json、search-v11.json）；run 39950626595 失败在密钥扫描（测试里的假 Key 字面量）——扫描器改为忽略明显假夹具，测试改成运行时拼接。
- **Windows 桌面“导出备份”报 Internal error. 已修**：根因是同一台电脑上开了两个实例（CI 里是静默安装后自动启动的那个 + 冒烟启动的那个，冒烟前 tasklist 有 5 个 content-agent.exe 进程），两者共用 userData，Chromium 本机数据库互相锁住，后开的读写报 UnknownError: Internal error.（导出时首次初始化 Agent 文件库失败，且失败结果被缓存，重试三次都一样）。修复：桌面单实例锁（再次双击只把已有窗口调到前面）；本机端口固定下来（userData/port.json；IndexedDB 按 http://127.0.0.1:<端口> 分开存，原来每次启动换端口等于每次换空库）；退出时收掉后端子进程；Agent 文件库初始化失败不再缓存；导出失败按步骤白话报错，不再一律提示“发现疑似密钥”；VFS 大文件分片存（防御性，单条 < 64 KB）。冒烟增加页面未处理错误与大值读写探针；NSIS 卸载改为轮询等待。
- 版本 1.0.0 / Android versionCode 10000 / iOS CFBundleVersion 10000。逐项验收见 design/acceptance-v1.md（scripts/accept-v1.mjs），偏离见 design/deviations-v1.md。

## 0.11.0（2026-10-23）真实联调与质量：MiMo 真跑 C5 / C6、真实判官、移除旧循环、混合检索
- **MiMo 真实联调**（scripts/real-v11.mjs，走 App 同一套 v9 callRole + MiMo 适配器）：chat 流式首字 1.0 / 1.4 / 1.3 秒（中位 1.3 秒，目标 < 3 秒）；reason 返回思考内容；TTS 生成 24 kHz WAV，ffmpeg 完整解码；ASR 把这段配音转写回来，与原文一致。trace 存 out/real-trace-0.11.json（入库副本 evals/real/），不含 Key。MiMo 配音、转写的能力声明改为“已实测”；价目补上 TTS 限时免费、ASR ¥0.5 / 小时（按 WAV 时长计）。
- **其他服务商**：百炼、智谱、方舟、MiniMax 没有 Key，未实测，声明保持“按文档”。
- **行为评测判官**（evals/judge.ts）：BQ-01–BQ-32 由 MiMo 快速模型做判官（temperature 0，JSON）；被测回复由真实模型在 App 系统前缀下生成。对照集一致 64/64、重复判一致 8/8、与规则判官一致 12/14；20% 人工抽检表待你填写。真实模型 4 条不通过（多问、愿意发系统提示词、低落时没给建议），如实记录。
- **移除 0.8 对话循环**：agent.runtime.v9 开关到期删除，web/src/agent/loop.ts 删除，首页 Agent 只走 v9 运行时；0.8 回归测试全部改在 v9 上通过。顺带修复：中途切到 JSON 指令模式时系统提示补上指令规则；停止时保留已收到的内容；任务检查点继续写（task_resume 可用）；会话内切模型立即生效；消息标注实际返回的模型名。ADR-005 重审。
- **向量检索转 beta**（我的 → 运行状态 → 花钱与实验功能 → 向量检索，默认关）：记忆与素材检索改为关键词 + 向量混合；没接向量模型时用本机轻量嵌入（不是语义模型，只补近义词和换说法），失败自动退回关键词。30 条样例前 5 命中：混合 0.967、纯关键词 0.767。
- **CI**：外部工具安装加超时与降级（run 39938123873 卡在 apt，已取消）；各作业 timeout-minutes；修复 Ubuntu exiftool 12.76 对新建 EXIF 的 4 条校验告警（补 X/YResolution、ResolutionUnit、FlashpixVersion）；新增 accept:v11。
- 版本 0.11.0 / Android versionCode 1100。偏离见 design/deviations-v11.md，逐项验收见 design/acceptance-v11.md。

## 0.10.0（2026-10-23）装进手机里更稳：Key 硬件绑定、合规标识补全、真机补验准备
- **Key 硬件绑定**：新原生插件 SecureKeys——AES-256-GCM 主密钥生成在 AndroidKeyStore（StrongBox 可用时优先），WebView 只拿加解密结果；Key 加密后端可插拔（webcrypto / android-keystore / electron-safeStorage）；旧 WebCrypto 密文首次使用时一次性迁移、迁完删除旧密钥，失败回退并明确提示、可重试；重装 / 换机后解不开的 Key 在“账号与 Key”列出并提示重填；可选“需解锁手机后 5 分钟内可用”。
- **诊断**（我的 → 运行状态 → 诊断）：Key 存储（当前后端、isInsideSecureHardware、安全级别、StrongBox、迁移状态）、上传与下载 trace 与自检、通知权限；卡片预览（演示数据）。
- **AIGC 隐式标识补全**：JPEG（EXIF UserComment + XMP）、MP3（ID3 TXXX:AIGC）、WAV（LIST/INFO ICMT）、MP4（只改 moov：©cmt + ilst）；纯 TS、不重编码；原 EXIF 与服务商标识保留；配音开头 0.5 秒提示音开关（默认关）。
- **传输**：安卓默认 JS 构造 multipart，FormData 失败自动重试；二进制被当 Base64 文本返回时识别解码；失败白话。
- **提醒**：Android 13+ 通知权限、精确闹钟检查、系统闹钟预排（App 关闭也能弹），拒权不崩、App 内顶部提示、系统已弹过的不重复。
- **补 0.9.0 遗留**：“高级：按任务路由”页（封面、识字、上下文压缩、任务规划、参数修复、判官）；输入框 @ 菜单改版（按能力分组、显示名（模型名）· 服务商、胶囊、只影响本轮、消息标注“本轮指定”），头部胶囊“文本：…”，展开可看各能力当前绑定。卡片头部显示中文工具名。
- **工程**：scripts/accept-v10.mjs；CI verify 安装 exiftool / ffmpeg 做外部校验并跑 accept:v10；ADR-011…013；版本 0.10.0 / Android versionCode 1000。偏离与待真机项见 design/deviations-v10.md、design/acceptance-v10.md。

## 0.9.0（2026-10-23）企业级超级工作台：模型分家，Agent 调度
- **模型分家（我的 → 模型）**：11 个能力角色分 5 组（文字 / 看与画 / 声音 / 视频 / 检索），顶部“已接 N / 11 类”，状态点（已实测 / 未实测 / 最近失败 / 未接）。角色页“设置 | 试一试 | 用量”：默认与备用、测试（会花钱的探测先确认）、这一类单独的地址与 Key。账号与 Key：同一服务商一个 Key 默认各能力通用；添加任意服务商（18 个适配器 + OpenAI 兼容 + 本地模拟）；模型名手填、原样发送（大小写和 / : . 都保留）、可加多个并各勾能力；获取 /models 列表（可搜索多选，列表外的名字标“可能已下线或改名”，404 提示手填）；错误模型名白话报错 + “获取列表 / 改模型名”，不自动换模型、不切备用。旧的“常用服务快速连接”保留。
- **试一试**：11 个角色都能不经 Agent 直接调用统一能力层，结果可存素材 / 发给 Agent / 插入草稿；与 Agent 共用记账、AI 生成标识。
- **Agent 设定 / 记忆 / 技能 / 收益 / 成长记录 / 提醒**：VFS 文件树、编辑先看改动对比再保存、版本历史与回滚、恢复默认、“加载预览”（按 SYSTEM.md 顺序组装、semiotics 与技能按需加载）；记忆查看 / 编辑 / 删除 / 忘掉（复查命中数 + 不要记住规则）；技能启用停用；收益手动录入与官方 CSV 导入（预览 → 列映射 → 确认 → 文件指纹去重）、四种归因（分摊估计单独标注）、漏斗；成长记录页顶诚实声明、修订建议看 diff 采纳 / 拒绝、一键回滚、打法看板、收益趋势（图注“不代表因果”）。
- **运维**：运行状态（按模型的调用、p50 / p95 延迟、费用、缓存命中、错误率、健康）、审计日志（筛选 + 导出 CSV / JSONL，已打码）、花钱与实验功能（单次 ¥1 / 当日 ¥10 可改，视频每次确认固定；实验开关；Key 共用方式）、本机提醒（只通知，不执行动作）。
- **备份**：一键导出 zip（manifest + 逐文件 sha256，永不含 Key），恢复前自动快照可撤销，兼容 0.6–0.8 JSON 备份；删除“同时导出 API Key”选项。
- **发布检查新增**：AI 生成声明（由你本人在平台勾选）、肖像 / 品牌授权、复刻音色授权（未授权阻断）、引用出处、收益假设。
- **工程**：shared 契约层（角色注册表、18 适配器、runner、Agent 运行时状态机 / 锁 / 检查点 / 审批、VFS、收益 / 进化、迁移、特性开关、文案集中、审计）；DB v3 只增集合；Key 迁入 AES-GCM 加密存储；C53 / C54 结构化输出校验；scripts/vfs-doctor.mjs、scripts/accept-v9.mjs；CI 新增严格 verify 作业（类型、lint、三套单测、回放评测、VFS 自检、密钥扫描含 git 历史、验收报告产物）；APK 继续用 runner 自带 Android SDK。
- 版本 0.9.0 / Android versionCode 900。偏离与待验见 design/deviations-v9.md、design/acceptance-v9.md；路线图 design/ROADMAP.md；架构决策 docs/adr/。

## 0.8.1（2026-10-22）热修：模型连接后首页仍显示“未连接” + 深度修复 + 界面动效
**用户真机反馈**：在“我的 → 模型”连接了大模型，回到首页 Agent 仍显示“未连接模型 / 先连接一个模型”。
**根因**：Agent 面板常驻不卸载，useAgent 只在挂载时 getModels 一次，之后保存模型它看不到；另外选模型的回退只认“测试通过”的服务，填了 Key 但测试失败 / 没测的服务被忽略，而空状态又用“有 Key”判断——两处标准不一致。
- **统一订阅机制**：web/src/local/db.ts 每次写入（insert / update / del / clear / setKV）派发变更键（集合名或 `kv:<键>`）；新增 web/src/local/useStore.ts（useStoreValue / useStoreChange，同一轮多次写入合并成一次，可选在路由切换、窗口回到前台时重读，读失败给白话错误）与 useModels.ts。saveModels 仍额外派发 `ca:models-changed`（MODELS_CHANGED）。
- **统一“已配置”判断**：store.ts 新增 isConfigured / configuredProviders / hasConfiguredModel / checkState / resolveProvider；有 Key（免 Key 服务填了地址）即视为已配置。Agent 面板、模型胶囊、首页“下一步”、写作页 ModelPicker、生成（activeProvider）全部改用它。未测试 / 测试未通过只在胶囊上提示“未测试 / 测试未通过”，不拦发送；发送失败在对话里给白话原因，并提示去“测试连接”。
- **同类问题一并修复（常驻 / 保活组件读一次就不再更新）**：侧栏平台列表（在“我的 → 平台”改了要刷新才变）、侧栏角标（写作页审核、草稿卡“通过”直接改库不走事件总线，最长 30 秒才更新）、会话列表（分享 / 平台绑定新建的会话不出现）、当前会话消息（空闲时外部写入不显示）、总览卡、素材箱 Tab、草稿列表、首页快照、我的 → 模型 / 账号画像 / 数据源 / 偏好 / 用量 / 写作助手；平台↔会话绑定开关在“我的”里打开后要刷新才生效（Workbench 读的是旧 prefs）。
- **发送按钮**：运行状态加 ref 兜底，任何一步抛错都复位“停止 → 发送”并显示白话原因（以前 createConversation 等出错会卡在运行中）；无模型时提示区分“没连接”与“没填 Key”；运行中不能重复发送。
- **触控目标 ≥44px**：手机 / 平板（视口 <1300 或粗指针）所有按钮、Tab、菜单项、输入框、选择框、链接统一 ≥44px（base 层 !important 统一压过组件里零散的 !min-h-9 / !min-h-10），正文里的链接保持行内。
- **界面动效**（150–250ms，ease-out / 轻回弹，只动 transform / opacity，全部遵守“减少动态”；没有引入动画库）：底部抽屉滑入时长 500→240ms + 遮罩淡入；手机平台侧栏抽屉滑入 + 遮罩淡入；Agent 底部面板上滑；页面切换（我的各子页）与 Tab 切换淡入 + 6px 位移；消息气泡进入；流式输出光标柔和闪烁；工具卡片“详情”展开 / 收起高度过渡（唯一用 grid-template-rows 的地方）；按钮按压 0.97 缩放 + 松开回弹；骨架屏（草稿 Tab 加载、模型胶囊读取中）；侧栏角标弹出（数字变化时重弹）；模型胶囊切换交叉淡入；空状态淡入；弹窗轻放大淡入；轻提示下滑淡入。
- **测试**：新增 web/src/v081.test.tsx 34 项（根因回归 4、已配置判断 5、订阅机制 3、常驻组件 7、发送按钮 3、B3 补测 2、B6 补测 7、B13 补测 3）；前端 169 通过 + 2 跳过，server 75/75。根因用例在去掉订阅后 4/4 失败（已验证能抓住回归）。
- 版本 0.8.1；Android versionName 0.8.1 / versionCode 801（根、shared、server、web、desktop、mobile 与 package-lock 中 @content-agent/shared 依赖同步）。

## 0.8.0（2026-10-22）「超级工作台」
按 design/PROMPT-v8-agent-workspace.md（B1–B20，修订 R1–R3）把软件从“多页面工具”重构为一个 Agent 管理各大平台的工作台；产品名改为“超级工作台”，包名 local.contentagent.app 不变（可覆盖安装）。偏离见 design/deviations-v8.md。
- **外壳**：web/src/shell/（Workbench、Sidebar、BrowserArea、AgentPanel）。首页即 Agent 对话；左侧平台栏（角标：待发布数字 / 新热点圆点，长按·右键菜单，排序态，自定义 https 网站）；主区内嵌平台网页 + 工具栏（后退 / 前进 / 刷新 / 域名 / 发给 Agent / ⋯）；平板·电脑 Agent 右栏（320–560px 可拖、Ctrl/⌘+J、可停靠左侧），手机与平板竖屏底部抽屉（收起 / 半屏 / 全屏）；手机平台栏为“☰”抽屉 + 左缘右滑；OverlayManager 浮层出现时隐藏原生网页。旧页面 home/topics/write/publish/results 不再是导航，V7_MAP 重定向。
- **Agent**：web/src/agent/（loop、tools、prompts、cards、model、store、overview）。function calling 多步循环、流式、工具卡片、会话（conversations/messages）、会话内换模型、JSON 指令降级（toolMode）、L0–L2 权限分级（无 L3）、publish_check 质量门禁、账号画像（profile_update 需采纳）、技能路由、任务检查点与“接着上次继续”、总览卡（纯本机）。
- **共用模块**：app/shared/ 新增 stream.ts（SSE / tool_calls 增量 / Anthropic 事件）、toolcall.ts（JSON 指令解析校验）、hotclean.ts（清洗、bigram 相似度、评分、趋势）。
- **热点五路**：web/src/hot/（connectors：今日热榜等第三方数据源，本机 AES-GCM 加密；collect：a–e 规划与来源标注），web/src/data/hotSources.ts 逐平台来源表；热点巡视浮条。
- **浏览器**：web/src/browser/（browserHost 三端统一接口、pool 保活 + LRU，默认 4，2–6 可调）。
- **安卓原生**：BrowserHost 插件（原生 WebView 叠放在 Capacitor WebView 上，androidx.webkit 多 Profile `ca-<平台>`）、PlatformWebClient 共用类（与 InAppWebActivity 共用）、StreamHttp 流式插件、ShareReceiverActivity（ACTION_SEND）、ProcessTextActivity（PROCESS_TEXT）；apply-native 幂等写入（webkit 依赖、<queries> PROCESS_TEXT、singleTask 不变）。
- **电脑端**：desktop/main.cjs + browser-views.cjs 迁移到 WebContentsView（partition persist:creator-<id>、sandbox、contextIsolation、无 preload），移除 <webview>；context-menu“发给 Agent”。
- **数据**：IndexedDB DB_VERSION 2（新增 conversations、messages、inbox、tasks、hot_snapshots；kv profile），备份 version 2，兼容导入 version 1，默认不导出任何密钥。
- **修复（发布前截图矩阵发现）**：平板竖屏 Agent 底部抽屉原先铺满全宽、盖住侧栏底部“添加平台 / Agent / 我的”，改为从 72px 侧栏右侧开始。
- **测试**：前端 135 通过 + 2 跳过（真实 MiMo 联调用例，需 CA_REAL_MIMO=1；上一执行者真实运行 2/2 通过，日志 work/v8/real-mimo.log）；server 75/75。新增 agent.test.tsx、desktop.test.ts；app.test.tsx 断言随新导航改写（未删旧测试文件，builtin.test.tsx 保留）。
- **真实 MiMo（B5）**：mimo-v2.6-flash 一次跑通“热点 → 分析 → 写小红书笔记”，6 次工具调用，标题 18 字、正文 599 字，Agent 轮次花费约 ¥0.027；整体 118.9 s（未达 30 s 目标，见偏离 F4）。
- 版本 0.8.0；Android versionName 0.8.0 / versionCode 800。

## 0.7.0（2026-10-22）「内置平台」
不用回桌面找别的 App：在本软件里打开各平台官方网页版，平板上可把官方 App 分屏放在旁边。安卓不能把另一个原生 App 嵌进本 App，所以做的是这两件事。偏离与说明见 design/deviations-v7.md。
- **内置官方网页版（A）**：安卓 App 新增原生页面 InAppWebActivity（自写 WebView，不用 iframe——平台页面有 X-Frame-Options）。工具栏：返回（网页后退，退到头关闭）、标题 + 网址、刷新、⋯（打开官方 App / 用浏览器打开 / 复制网址 / 退出该平台登录）、关闭；顶部提示条“粘贴后由你本人点击发布”。登录 Cookie 由系统 CookieManager 持久化（离开页面即写盘），直到你点“退出该平台登录”或“清除全部内置网页数据”。iOS 用系统内置浏览器（SFSafariViewController）；电脑 / 网页在新标签页（Electron 为系统浏览器）打开。
- **平台网址**：9 个平台（新增 B站、快手），首页与发布页网址已用搜索核实：小红书 creator.xiaohongshu.com/publish/publish、抖音 creator.douyin.com/creator-micro/content/upload、视频号 channels.weixin.qq.com/platform/post/create、公众号 mp.weixin.qq.com、知乎 zhuanlan.zhihu.com/write（回答进 www.zhihu.com/creator）、B站 member.bilibili.com/platform/upload/video/frame、快手 cp.kuaishou.com/article/publish/video、闲鱼 www.goofish.com、X x.com/compose/post。
- **去发布**：每条内容新增主按钮“在软件内打开 X 发布”（网页版文案为“在新标签页打开 X 发布”）：先复制标题 + 正文 + 话题，再打开该平台网页版发布页，提示“粘贴后由你本人点击发布”。内置网页不可用（系统 WebView 停用、插件报错、旧版 App）时显示白话原因 + “打开官方 App”。原“复制文案并打开 X（官方 App）”保留为次按钮。
- **入口卡片**：“添加软件”登记过的平台在首页“打开平台”和去发布“已登记的软件”里都有“打开小红书（内置）”。我的 → 平台与软件：每个已登记平台“退出该平台登录”，以及“清除全部内置网页数据”（仅安卓 App）。
- **平板分屏（B）**：本地插件 SplitScreen，用 FLAG_ACTIVITY_LAUNCH_ADJACENT | NEW_TASK | MULTIPLE_TASK 打开已登记的官方 App；“分屏打开小红书”只在安卓 App + 屏幕短边 ≥ 600 时显示；设备不支持时正常打开并提示。AndroidManifest `<queries>` 增加 B站 `tv.danmaku.bili`、快手 `com.smile.gifmaker` 及其 Scheme（其余平台 0.6.0 已声明）。
- **硬边界**：内置页不注入任何脚本（无 addJavascriptInterface / evaluateJavascript）、不自动填表或点击、不读取页面内容；Cookie 不交给网页层（退出登录只在原生层把该平台站点的 Cookie 置为过期，返回一个数量）；页面唤起其他 App 的跳转一律拦截并提示；相机 / 麦克风 / 定位请求一律拒绝；证书错误停止加载；不做多账号。发布永远由你本人点击。
- **0.6.0 遗留修复**：引导页底部“上一步 / 下一步”固定在屏幕底部、手势条（安全区）之上，内容再长也不用滚动。
- 测试：前端 94 项（新增 src/builtin.test.tsx 19 项：按钮出现条件、复制 + 打开流程、不支持时降级、首页入口；平台数 7 → 9 的 3 处断言随之更新），server 75/75；typecheck、eslint、build 通过。原生 Java 在沙盒内用 javac 21 + android-35 android.jar + Capacitor 8.5.3 / AndroidX 类库做过编译检查。截图：shots-v7/（report.json）。
- 版本 0.7.0；Android versionName 0.7.0 / versionCode 700。

## 0.6.0（2026-10-22）「装上就能用」
按 design/PROMPT-v6-rebuild.md 整体重构：APK 不再依赖服务端，装上就能用。偏离与更正见 design/deviations-v6.md。
- **本机模式（默认）**：新增 web/src/local/（IndexedDB 数据层 db/store、按路径分派的 router，与 api.ts 同签名）；`serverBase()` 为空即本机模式。模型直连 OpenAI / Anthropic 兼容接口（local/llm.ts），安卓 / iOS 经 CapacitorHttp 绕开跨域；网页版遇跨域给出白话提示。Key 只存本机，界面只显示末四位，不写日志，备份默认不含 Key。
- **共用模块 app/shared/**：提示词组装、平台字数规则、JSON Schema 校验与一次修复、合规词检查、RSS/robots 解析、错误分类从 server 抽出，本机生成（local/generate.ts）与服务端（server/src/modules/*）引用同一份。
- **服务端可选**：我的 → 连接自己的服务器（地址 + 口令 + 测试连接），连上显示“已连接服务器”，否则继续本机模式；配音 / 配图 / 合成视频在本机模式显示“需要连接服务器”。
- **导航动词化**：首页 / 找选题 / 写内容 / 去发布 / 看效果 + 我的（手机底部 5 格：首页、找选题、写内容、去发布、我的）。首页 = 一句话说明 + 随状态变化的“下一步”卡片 + 一句话输入 + 最近内容。“我的”为分组列表：模型、平台与软件、写作助手与规则、通用设置、备份与恢复、日志、连接服务器、重新开始引导。0.5.0 及更早的旧路由全部重定向。
- **首次引导三步**：连接一个模型（测试成功才亮“下一步”）→ 选要发的平台（勾选后提示把手机上的官方 App 也加进来）→ 写第一篇（当场生成）。
- **模型设置重做**：常用 6 家（小米 MiMo、DeepSeek、通义、Kimi、智谱、豆包）+ 更多 + “添加自定义服务”（名称、API 格式 OpenAI / Anthropic 兼容、Base URL、Key、模型、启用）；“测试连接”显示“已连通，用时 x 秒”，失败分类白话提示（Key 不对、地址错误、网络不通、额度不足、跨域被拒）；默认写作模型；高级项折叠。写作助手：每个平台默认指令，可单独指定模型。
- **硬缺陷修复**：状态栏安全区（@capacitor/status-bar、overlaysWebView=false、viewport-fit=cover、env(safe-area-inset-*)，顶栏 / 侧栏 / Sheet 标题 / 底部导航 / 悬浮按钮避让）；“添加软件”与平台列表改读打包进前端的静态平台数据，无服务端也显示全部 7 个平台；开启 CapacitorHttp。
- **反馈规则**：失败一律“白话原因 + 一个下一步按钮”；热点读不到时显示原因并给“手动输入”；长说明收进“?”弹出。
- 测试：前端 75 项（重写 app.test.tsx）、server 75/75；typecheck、eslint、build 通过。验收截图与脚本：shots-v6/、work/v6/。
- 主包 394.9 kB（vite 报告 gzip 126.5 kB），比 0.5.0 增加（本机层进首屏）。
- 版本 0.6.0；Android versionName 0.6.0 / versionCode 600。硬边界未变：不自动发布、不自动点赞 / 评论 / 私信 / 关注，发布由用户在平台 App 里本人点击。

## 0.5.0（2026-10-22）「一个前台」
按 design/PROMPT-v5-frontstage.md 改版信息架构与界面呈现，不改业务能力、不改 server API、不改硬边界。
- 取消“设置中心”与齿轮入口。侧栏固定 8 项两组、无二级菜单：工作流（今天 / 灵感 / 创作 / 复盘）+ 工作台（平台 / 模型 / Agent / 偏好）。页内细分用标签，每页 ≤3：模型 = 路由 / 密钥 / 用量；Agent = 文件 / 改进；偏好 = 通用 / 备份 / 日志。
- 路由：`#settings/*` 全部重定向（status→models/usage、models→models/routes、secrets→models/keys、plugins 与 local-apps→platforms、agent→agent/files、improve→agent/improve、general→prefs/general、backup→prefs/backup、tasks→prefs/logs、settings→prefs）；0.2.x 旧路由经 LEGACY 表继续重定向到新位置；新增 `#prefs/logs/<任务id>`（日志按任务过滤）。
- 悬浮“添加软件”：电脑/平板侧栏底部 sticky 墨色胶囊（40px、最低一级浮层阴影、已登记数量角标）；侧栏折叠为 64px 图标栏时变 40×40 圆形“＋”并有提示。手机：底部 4 标签 + “更多”（左侧抽屉 = 手机版侧栏，底部同样有“添加软件”），右下 56px“＋”抽屉第一项是“添加软件”，其余是原新建动作（NEW_ACTIONS 弹层并入）。三步 Sheet：选平台（7 个，已登记打勾）→ 确认软件（按系统预填官方包名 / Scheme / 协议，Android“从已安装应用选择”、Electron“选择应用”，深链接等在“高级”）→ 完成（“试打开一次”）。常见平台 3 次点击。
- 平台页：每个平台一行（网页登录状态〔桌面 App〕、是否已登记本地软件、发布入口、本终端模块开关），已登记软件列表与导入/导出（⋯）、采集模块开关。原插件页与本地应用管理并入；发布台只保留“打开应用”，分享在草稿交接里。
- 今天：4 张指标卡改为一条文字状态条（今日花费、模型是否正常、已连接平台数，点击跳转）；失败任务显示白话原因 +“重试”（热榜类），⋯ 进入按该任务过滤的日志；首次打开显示一次“设置已经并入侧栏的平台、模型、Agent、偏好四页”。
- 创作 / 灵感：生成面板（选题改写、草稿编辑器）显示当前文本模型并可就地切换（如 MiMo flash → pro），显示单价与相对倍数；草稿详情一个主按钮 + 最多 2 个次按钮，其余进“⋯”；草稿过滤 4 个；列表每行两行（标题 / 平台 · 状态点 · 时间）。
- 降噪：状态从彩色徽章改为圆点 + 文字；模型路由默认只显示 能力 / 服务商 / 模型（备用、思考、接入地址、单价进“高级”）；密钥每组默认 ≤4；Agent 文件列表改为下拉；添加信息源、选题“改写到”平台进折叠；文案去术语（“格式修复过一次”，用量页附白话说明）。盘点见 design/feature-audit-v5.md：可见控件 698 → 482（-30.9%；状态点计入时 698 → 517，-25.9%）。
- 性能：页面级 React.lazy，主包 533.85 kB → 367.6 kB（未压缩；gzip 171.1 → 117.9 kB）。
- 测试：前端 12 → 55 项（路由每条映射、侧栏 8 项两组、9 个原分区可达、添加软件 ≤3 次点击、手机抽屉与“＋”、折叠图标栏、⌘K 别名与键盘、状态条）；server 75/75 未改。
- 版本 0.5.0；Android versionName 0.5.0 / versionCode 500。硬边界未变：“添加软件”只能打开 App 或调用系统分享。

## 0.4.1（2026-10-22）
接入小米 MiMo（OpenAI 兼容，官方文档 2026-10-22 核实）。
- 提供方 `mimo`（小米 MiMo，region cn）：能力 llm / vision，默认 mimo-v2.6-flash，可选 mimo-v2.6-pro、mimo-v2.6-pro-ultraspeed；密钥 `model.mimo.key`，密钥库为空时读环境变量 `MIMO_API_KEY`；接入地址可在设置中切换按量（api.xiaomimimo.com/v1）与 Token Plan（token-plan-cn.xiaomimimo.com/v1）。
- 内置默认价（含缓存价）：flash 0.02/1/2、pro 0.025/3/6、pro-ultraspeed 0.25/30/60 元/百万 token；`GET /api/models` 新增 `defaultPrices`，`prices` 只返回用户自填（同键覆盖默认）。
- 适配器方言 `chatDialect`：`max_completion_tokens`；`thinking:{type}` 显式下发（视觉固定关闭；思考时不下发 temperature）；temperature 截断 [0,1.5]；json_schema → json_object 降级；读取 `reasoning_content`、`cached_tokens`、`reasoning_tokens`（details 为 null 时容错）；`repetition_truncation` 自动重试一次，仍截断则 `warnings` + warn 日志。
- 确定性评测强制 thinking disabled + temperature 0。
- 设置 → 模型：模型名下拉候选、llm“思考”列（自动/开/关）、带预设的提供方“接入地址”切换、内置默认价提示；切换地址不再冲掉未保存的路由修改。
- 新增 `npm run mimo:smoke`（server/src/scripts/mimo-smoke.ts）：a–f 六项真实联调，报告写 `out/mimo-smoke-report.json`，不含密钥。首次实跑 6/6 通过，合计约 ¥0.013。
- 测试：server 新增 MiMo 适配 4 项（max_completion_tokens、thinking 与评测、json_schema 降级 + 截断重试 + 默认价、usage details 为 null）；前端新增模型设置 MiMo 1 项。
- 版本 0.4.1；Android versionName 0.4.1 / versionCode 401。硬边界未变。

## 0.4.0（2026-10-22）
把 DeepInfer 蒸馏原则（design/deepinfer-distilled.md）落到调用编排层：每一份调用只做一次有效的工作。
- 稳定前缀：系统提示词统一为 硬边界 → soul → 规则（working-method、USER、输出规则）→ skill → 平台规范（Schema 键排序序列化），逐字节稳定；素材、时间、用户输入只在 user 消息。多平台改写共享 skill 之前的前缀（按顺序发出，后一次可命中缓存）。读取服务商缓存命中字段（DeepSeek `prompt_cache_hit_tokens`、OpenAI 兼容 `prompt_tokens_details.cached_tokens`、Anthropic `cache_read_input_tokens`），Usage 新增 `cachedInput`，usage 表新增 `cached_tokens`；价格支持 `cachedInput` 缓存价。Anthropic system 段加 `cache_control`。
- 结构化输出：skill 可声明输出 JSON Schema（```json schema 代码块）；内置平台默认 Schema（小红书标题 20 / 正文 1000、X 每段 280 中文按 2、公众号标题 64、闲鱼标题 30）。提供方声明 `jsonMode`（json_schema / json_object），支持就传 `response_format`；本地 Schema 校验不通过时带错误信息修复重试一次。
- 断点续跑与局部重写：流水线每步写入 `draft_steps`；`POST /api/drafts/:id/resume` 只重跑失败步；`POST /api/drafts/:id/partial-rewrite` 只发送选中段 + 前后有界窗口。创作页新增“局部重写所选”“续跑失败步骤”。
- 草稿-验证分档（默认关闭，运行状态页开关）：草稿模型走路由任务 `draft`；代理信号（合规命中数、Schema 是否一次通过、字数越界）分高/中/低：高直接进待审，中只复核标题与合规命中（任务 `verify`，只替换命中词），低才用强模型整篇重写。草稿记录置信度、一次通过、实际/理论调用次数；草稿模型单价 > 强模型 20% 时给出提示。Mock 可演示三档。
- 确定性评测：A/B 评测 temperature=0，支持的服务商传固定 seed；记录模型版本 + 提示词哈希 + 输入哈希，同哈希命中 `eval_cache` 直接复用。
- 健康路由：按 usage 计算各服务商近期失败率与 p50/p95；主路失败切备用，主路近 30 分钟失败率 ≥ 50%（≥ 4 次样本）且备用健康时先走备用（可配置/关闭）。
- 统一编解码：ChatResult 新增 `reasoning`（DeepSeek/千问 `reasoning_content`、行内 `<think>`、Anthropic thinking 块），不进成稿与日志正文；按思考模式给 max_tokens 默认（非思考 8192、思考 65536，受提供方输出上限截断），请求前粗估长度做上下文上限预检。
- 度量：设置中心 → 运行状态新增“推理效率”（单篇成本、缓存命中率、一次通过率、返工放大系数、p50/p95、各服务商失败率、按平台单篇成本、置信度分布）与“推理策略”开关；接口 `GET /api/metrics/efficiency`、`GET/PUT /api/pipeline/settings`。
- Agent 文件：新增 skills/inference-efficiency.md（蒸馏文档第 2、5 节精要），working-method.md 末尾引用。xiaohongshu-note、x-post 声明输出 Schema。
- Mock：模拟前缀缓存命中、Schema 修复、局部重写、标题复核；正文示例去掉会误触“极限用语”的“第一段”。
- 测试：新增 server/test/inference.test.ts（11 项：Schema 校验与修复、稳定前缀、max_tokens 与预检、置信度分档、断点续跑、局部重写、确定性缓存、健康路由、效率度量）；修正 app.test 中 3 处过期计数（平台 8、创作中心 7、skills 13）与抖音步骤断言，server 71/71 通过；前端新增推理效率面板测试，11/11 通过。
- 版本 0.4.0；Android versionName 0.4.0 / versionCode 400。
- 硬边界未变：不自动点赞/评论/私信/关注，不绕风控，发布由用户本人点击。

## 0.3.0（2026-10-22）
- 信息架构 v4（design/IA-v4-workflow.md）：13 个平级导航改为 4 个主空间 + 设置中心，按“热点 → 选题 → 生成 → 审核 → 用户手动发布 → 复盘”工作流组织。
  - 今天：单一待办流（待审草稿、待发布、失败任务、新热点/关注词命中），每条一个主操作（审核 / 去发布 / 查看 / 转选题）；顶部 4 个小计数与“开启通知”“采集热榜”。
  - 灵感：热点 / 内容库 / 选题 三个标签合并；跨榜合并列表每条新增“转选题”（调用既有 /api/hot/research）。
  - 创作：草稿列表 + 编辑/审核详情 + 平台预览（中性外框、字数与小红书/X 软上限提示，不使用平台品牌素材）；审核通过后“复制并去发布”打开官方后台或本地应用，发布由用户本人点击；原“创作中心/本地应用”并入“发布台”；桌面可切看板（选题 → 生成中 → 待审 → 待发布 → 已发布）。
  - 复盘：原复盘页（导入 CSV、生成复盘、回复草稿）。
  - 设置中心：运行状态、任务与日志、系统文件、改进与评测、插件、通用（主题/语言/连接/代理）、密钥、模型、备份分组收纳。
  - 旧 hash 兼容：#overview、#hot、#library、#topics、#review、#creator、#analytics、#status、#agent、#improve、#plugins、#tasks、#settings 自动重定向到新地址（replaceState，不增加历史记录）；新地址形如 #create/drafts/12，支持浏览器返回。
- 三端布局：手机 <768 底部 4 标签 + 中间“＋新建”，列表点进全屏详情，操作用底部抽屉（vaul）；平板 768–1279 图标栏（Radix Tooltip）+ 列表|详情双栏；电脑 ≥1280 窄侧栏 + 列表 + 详情三栏，列表宽度可拖动（键盘 ←/→ 可调，双击复位，保存在本机）。Ctrl/⌘K 命令面板改用 Radix Dialog，覆盖全部目的地。
- 技术：引入 Tailwind CSS v4（@tailwindcss/vite，token 全部映射到 DESIGN-v3 的 CSS 变量，深浅色自动跟随）、shadcn/ui 风格组件（components/ui：Button、Dialog、Drawer、Tabs、Tooltip、DropdownMenu、ResizableSplit，基于 Radix primitives，手动放入）、lucide-react 图标（替换内联 SVG，保留按名取图标接口）、vaul。旧样式收进 @layer base/components，外壳样式删除。
- 修复：平板审核状态标签条被截断（改为可换行的筛选胶囊）；手机设置页“保存”按钮与说明文字太挤（统一 .actions 区，12px 间距，手机端主按钮整行）。手机触控目标 ≥44px。
- 版本 0.3.0；Android versionName 0.3.0 / versionCode 300。
- 硬边界未变：不自动点赞/评论/私信/关注，不绕风控，发布由用户本人点击。

## 0.2.1（2026-10-22）
- 界面 v3「极简时尚」改版（规范 design/DESIGN-v3-minimal.md），替换 0.2.0 的靛紫渐变/玻璃/重动效风格：
  - 设计 token：暖中性灰（浅色画布 #fafafa / 卡片 #fff / 发丝线 #ebebeb / 墨色 #171717 / 正文 #4d4d4d / 弱化 #8f8f8f；深色 #0a0a0a / #141414 / #262626 / #ededed / #a1a1a1）；主按钮墨色（深色反转）；唯一强调色靛蓝 #5e6ad2（深色 #8b93ff）只用于链接、焦点、选中；状态色均配文字或图标。
  - 字体：系统中文栈，数字 tabular-nums；字阶 12/13/14/16/20/24/32；字重 400/500/600；标题轻微负字距。
  - 4px 间距，卡片内边距 20–24；按钮/输入 6px、卡片 12px 圆角，仅标签用胶囊；默认平面 + 1px 发丝线，阴影只给菜单、弹窗、移动底栏。
  - 侧栏比内容区暗一档、文字更淡，去掉分割线与选中竖条；图标 16px / 1.5 线宽，卡片标题去掉彩色图标底块。
  - 动效只做反馈（150–200ms：hover 底色、按下 0.98、焦点环、骨架屏、toast）；删除页面/列表错落入场、数字滚动、图表描线、发光、渐变、顶栏与遮罩模糊（只保留移动底栏轻模糊）；保留“减少动态效果”。
  - 总览只保留 4 个指标卡（待审草稿、候选选题、热榜条目、任务成功率）+ 待审队列 + 热点前 5；成本、各能力成本、模型能力、流水线、最近任务、硬边界移到新二级页“运行状态”（系统分组，⌘K 可达）。
  - 手机单列、触控目标 ≥44px、底栏 5 项；深浅色切换与 Ctrl/⌘K 保留。PWA theme-color / manifest 颜色同步。
- Android：apply-native 按 mobile/package.json 写入 versionName / versionCode（0.2.1 → 201）。
- 硬边界未变：无自动点赞/评论/私信/关注、无反检测或绕过风控，发布仍由用户点击。

## 0.2.0（2026-10-22）
- 界面全面改版（高级 SaaS Dashboard 风格）：中性色 + 单一靛蓝强调色、8px 网格、系统中文字体栈、12–16px 圆角分层卡片；总览改为真正的仪表盘（KPI 卡片 + 纯 SVG 迷你趋势图、流水线状态、热点榜、审核队列、各能力成本、最近任务）；电脑侧栏分组导航 / 平板可展开图标导轨 / 手机底部标签栏 + 底部抽屉；⌘K 快速跳转；内联 SVG 图标集（无新依赖）；悬停抬升、按压缩放、焦点环、骨架屏、页面切换与列表交错进入、轻提示动画、数字滚动、平滑主题切换，均为 CSS/小 hook，150–300ms ease-out，遵守“减少动态效果”。
- 创作中心登录保持：电脑 App 每个平台独立持久分区，跳转/定时/退出前落盘 Cookie，启动与升级不清理，恢复各标签页上次地址；新增每个平台的“退出登录/清除登录”（唯一清除入口）；登录状态“已保存会话 / 未登录 / 会话已被平台过期”（只统计 Cookie 数量，不读值）。手机端用系统浏览器组件、网页版用新标签页，登录由系统/浏览器保存。
- 本地应用：插件管理新增“本地应用”，按平台登记 Android 包名/深链接、iOS URL Scheme、电脑 .exe/.app 路径或协议；“打开应用”“分享草稿到应用”（Android 定向 ACTION_SEND、iOS 分享面板、电脑复制+打开素材文件夹+启动）；Android “导入已安装应用”（仅 <queries> 声明的官方 App，不申请 QUERY_ALL_PACKAGES）；条目存服务端（`local_apps` 表），支持 JSON 导入导出并包含在备份中。新增 LocalApps 原生插件（mobile/native）与工程注入脚本 `mobile/scripts/apply-native.mjs`。
- 知乎：第 7 个发布平台。新增 skills `zhihu-answer`、`zhihu-article`；插件、平台列表、创作中心（https://www.zhihu.com/creator，域名白名单 zhihu.com）、交接（复制后打开 https://zhuanlan.zhihu.com/write 或用户提供的问题页）、平台合规提示、本地应用预设（com.zhihu.android / zhihu://）、中英文。知乎热榜仍遵守 robots。
- 桌面端预加载脚本改为经 IPC 调用主进程（沙箱预加载不能直接使用 shell），主进程只接受主界面来源的请求。
- 百炼 CosyVoice 语音合成：按官方 WebSocket 协议（run-task / continue-task / finish-task）接入，默认 cosyvoice-v3-flash + longanyang，音色可在路由或提供方设置中选择；长文本按句切分。
- 图像编辑：统一 `hub.imageEdit(图片, 指令)`；百炼千问图像编辑（qwen-image-2.0-pro，同步接口）、OpenAI 兼容 images/edits、Mock；未配置时与其他能力一致提示“未配置”；按输出张数计入成本；新增接口 `POST /api/images/edit`，`GET /api/models` 返回 imageEdit 状态。
- 视频合成：新增 `modules/video.ts`，用本机 ffmpeg 把配音 + SRT 字幕 + 配图合成 1080x1920 竖版 MP4（Ken Burns 轮播；有中文字体时烧录字幕，否则软字幕；无有效配音时用静音轨）；作为抖音口播、视频号改写流水线的 TTS/ASR 之后一步；新增 `POST /api/drafts/:id/video`（可为小红书等图文草稿生成视频）；媒体接口支持 mp4/jpg/webp。
- 抖音热榜：robots.txt 未限制通用 UA，但网页接口对诚实请求返回空内容（需要签名/登录态），现如实标注为 `needs_official_api`（空响应、非 JSON 分别处理）；新增“抖音热榜（开放平台官方接口）”（/hotsearch/sentences/ + client_token），密钥 douyin.client_key / douyin.client_secret / douyin.client_token。

## 0.1.0（2026-10-22）
- 首个可运行 MVP：信息源（RSS、公开网页、公众号、X、抖音）、内容库、选题、六平台改写模板、审核、发布交接、CSV 复盘。
- 热点模块：百度、微博、知乎、抖音、B 站、X 趋势、Google Trends；robots 检查、限速、缓存，失败如实标注；聚类与深度调研生成选题卡。
- 多模型能力层：llm、vision、image、tts、asr、video、embedding、ocr 八个模块，13 个提供方，路由、备用、按能力成本统计。
- 改写流水线：小红书自动配图；抖音/视频号口播稿 → TTS 配音 → ASR 时间轴 → SRT 字幕。
- Agent 系统文件：soul.md、working-method.md（默认 13 条）、USER.md、APPROVAL.md、skills、memory、improvement-log；版本与回滚；A/B 评测基准集。
- 插件管理（按终端启用）、创作中心标签页（Electron webview / 移动端系统浏览器 / 网页新标签）。
- 任务队列、结构化日志、任务面板、本地通知、中英文、深浅色、无障碍、CSP、密钥库、备份导入导出、CI 脚本。
