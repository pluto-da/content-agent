#!/usr/bin/env python3
"""1.2.0 指挥台文案：生成 / 校验 web/src/locales/{zh,en}.ts 中 ui.v12_* 与数据表中文的条目（幂等）。"""
import re, sys, json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
K = {
 'a2a': ('Agent 互通（A2A，实验）', 'Agent interop (A2A, beta)'),
 'a2a_off': ('A2A 是实验功能，默认关闭：到“我的 → 通用设置 → 实验功能”打开“A2A 客户端”后，才能添加外部 Agent。', 'A2A is a beta feature and is off by default. Turn on "A2A client" in Me → General → Experiments to add external agents.'),
 'a2a_on': ('外部 Agent 作为“外部子 Agent”被超级 Agent 调用：调用属 L2，受同样的预算、审批与审计约束；添加需你批准。', 'External agents are called by the super agent as "external sub-agents": calls are L2 and follow the same budget, approval and audit rules. Adding one needs your approval.'),
 'a2a_url': ('外部 Agent 地址（读取它的 Agent Card）', 'External agent URL (reads its Agent Card)'),
 'add': ('添加', 'Add'), 'add_data': ('记一条数据', 'Add data point'), 'add_goal': ('添加目标', 'Add goal'), 'add_source': ('添加数据源', 'Add data source'),
 'added': ('已添加', 'Added'), 'added_short': ('已添加', 'Added'),
 'all_paused': ('已全部暂停：所有运行、排队任务与定时工作流都已停止，外部工具已断开。恢复需要你手动。', 'Everything is paused: all runs, queued tasks and scheduled workflows have stopped, and external tools are disconnected. Resume manually.'),
 'api_key_note': ('官方接口用你自己的 Key：保存后到“我的 → 平台与软件 → 数据源”用安全表单填写（本机加密，这里只存引用）。', 'Official APIs use your own key: after saving, enter it in Me → Platforms & apps → Data sources with the secure form (encrypted on this device; only a reference is stored here).'),
 'approve': ('批准', 'Approve'), 'approve_edited': ('修改后批准', 'Approve with edits'), 'approved': ('已批准', 'Approved'),
 'apps_entry': ('软件入口（剪映、Canva 等）在“平台与软件”里添加', 'Add app entries (CapCut, Canva…) in Platforms & apps'),
 'avg_cost': ('平均花费', 'Avg cost'), 'awaiting_approval': ('待你批准', 'Awaiting approval'), 'based_on': ('依据', 'based on'),
 'board': ('任务板', 'Task board'),
 'boundary_line': ('超级 Agent 统领 App 内的模型、平台、数据源、技能、子 Agent 与工作流；发布与互动都由你本人在官方 App 内完成，不模拟点击、不自动互动、不抓登录后的数据。', 'The super agent runs models, platforms, data sources, skills, sub-agents and workflows inside this app. You publish and interact yourself in the official apps — no simulated taps, no auto-engagement, no scraping of logged-in data.'),
 'command': ('指挥', 'Command'), 'command_bar': ('指挥条', 'Command bar'),
 'command_desc': ('我的团队、任务板、工作流、审批收件箱、目标与进度、连接', 'Team, task board, workflows, approvals, goals and connections'),
 'concurrency': ('同时运行的子 Agent', 'Sub-agents running at once'), 'concurrency_hint': ('上限（1–5，默认 3）', 'Limit (1–5, default 3)'),
 'confirm_each': ('每次确认', 'Confirm each time'), 'connect': ('连接', 'Connect'), 'connect_list_tools': ('连接并列出工具', 'Connect and list tools'),
 'copy_from_template': ('从模板复制', 'Copy from template'), 'copy_template': ('复制这个模板', 'Copy this template'),
 'custom_platforms': ('自定义平台', 'Custom platforms'), 'data_points': ('条数据', 'data points'), 'data_sources': ('数据源', 'Data sources'), 'date': ('日期', 'Date'),
 'delete': ('删除', 'Delete'), 'delete_confirm': ('删除这个子 Agent？30 天内可在回收站恢复。', 'Delete this sub-agent? You can restore it from the trash within 30 days.'), 'deleted': ('已删除', 'Deleted'),
 'describe_agent': ('或者一句话描述，让超级 Agent 起草', 'Or describe it in one sentence and let the super agent draft it'),
 'describe_agent_ph': ('例如：专门做 B 站视频封面和配音的，叫封面小助手', 'e.g. one that only makes Bilibili covers and voice-overs, called Cover Helper'),
 'describe_platform': ('或者一句话描述一个新平台', 'Or describe a new platform in one sentence'),
 'describe_platform_ph': ('例如：加一个叫少数派的长文社区 https://sspai.com', 'e.g. add a long-form community called sspai, https://sspai.com'),
 'description': ('说明（做什么、何时用）', 'Description (what it does, when to use it)'), 'done_count': ('完成', 'Done'), 'duties': ('职责与工作方法', 'Duties and method'),
 'edit': ('编辑', 'Edit'), 'edit_then_approve': ('修改后批准', 'Edit, then approve'), 'empty': ('暂无', 'None yet'),
 'enable': ('启用', 'Enable'), 'enable_schedule': ('启用定时', 'Enable schedule'), 'enabled': ('已启用', 'Enabled'), 'enabled_short': ('已启用', 'Enabled'),
 'enter_data': ('录入数据', 'Enter data'), 'est_cost': ('预计 ', 'est. '), 'export': ('导出', 'Export'), 'external_tools': ('外部工具（MCP）', 'External tools (MCP)'),
 'from': ('发起：', 'From: '), 'from_date': ('开始', 'From'), 'from_template': ('从模板启用（可直接用，也可启用后编辑）', 'Enable from a template (use as is, or edit after enabling)'),
 'goal_ph': ('例如：本月小红书涨粉 500', 'e.g. +500 Xiaohongshu followers this month'), 'goal_title': ('目标', 'Goal'), 'goals': ('目标', 'Goals'),
 'idle': ('空闲', 'Idle'), 'idle_hint': ('已经很久没用了，要不要停用？不会自动删除。', 'Unused for a long time — pause it? Nothing is deleted automatically.'),
 'impact': ('影响：', 'Impact: '), 'import_agent': ('导入 .agent.zip', 'Import .agent.zip'), 'import_platform': ('导入 .platform.zip', 'Import .platform.zip'),
 'inbox': ('审批', 'Approvals'), 'inbox_empty': ('没有待批事项', 'Nothing to approve'), 'kind': ('类型', 'Type'),
 'l3_change_note': ('改职责、权限、工具或额度属于 L3，会先进审批收件箱，批准后生效；改名称、说明只保存新版本。', 'Changing duties, permissions, tools or budget is L3: it goes to the approval inbox first. Renames and descriptions are saved as a new version.'),
 'latest_output': ('最近产出：', 'Latest output: '), 'let_super_draft': ('让超级 Agent 起草', 'Let the super agent draft it'),
 'mcp_note': ('添加远程 MCP 服务器（Streamable HTTP，兼容 2026-07-28 与 2025-11-25）：列出全部工具后逐个勾选；默认 L2，写入外部系统的默认关闭并每次确认；点赞、评论、私信、关注、发帖类工具一律拒绝。', 'Add a remote MCP server (Streamable HTTP, 2026-07-28 and 2025-11-25): all tools are listed and you tick them one by one. Default L2; tools that write to other systems start off and need confirmation each time; like / comment / DM / follow / post tools are always refused.'),
 'mcp_url': ('服务器地址', 'Server URL'), 'metric': ('指标', 'Metric'),
 'metric_followers': ('涨粉', 'Followers gained'), 'metric_revenue': ('收益', 'Revenue'), 'metric_views': ('阅读 / 播放', 'Views'), 'metric_posts': ('发布篇数', 'Posts'),
 'month_budget': ('月额度（元）', 'Monthly budget (¥)'), 'my_team': ('我的团队', 'My team'), 'my_workflows': ('我的工作流', 'My workflows'), 'name': ('名称', 'Name'),
 'new_agent': ('＋ 新建子 Agent', '+ New sub-agent'), 'new_id_optional': ('新 id（可选）', 'New id (optional)'),
 'no_agents': ('还没有子 Agent。从模板启用一个，或一句话描述让超级 Agent 起草。', 'No sub-agents yet. Enable one from a template, or describe one and let the super agent draft it.'),
 'no_goals': ('还没有目标', 'No goals yet'), 'no_workflows': ('还没有工作流，从上面的模板添加一个', 'No workflows yet — add one from the templates above'),
 'only_real_data': ('目标进度只用你录入或导入的数据；没有数据就显示“待录入”，不推算。', 'Goal progress only uses data you enter or import; without data it shows "To be entered" and nothing is estimated.'),
 'open': ('打开', 'Open'), 'pause': ('暂停', 'Pause'), 'pause_all': ('全部暂停', 'Pause all'), 'paused': ('已暂停', 'Paused'),
 'paused_send_blocked': ('已全部暂停：先在指挥条点“恢复”再发送', 'Everything is paused — tap Resume in the command bar first'),
 'paused_toast': ('已暂停', 'Paused'), 'pending_approvals': ('待你批准', 'Waiting for you'), 'pending_short': ('待批', 'To approve'),
 'per_run_cap': ('单次上限（元）', 'Per-run cap (¥)'), 'permissions': ('权限（子 Agent 最多 L2，且不超过超级 Agent）', 'Permissions (sub-agents get at most L2, never more than the super agent)'),
 'platform_drafted': ('平台已保存；写法技能草稿已进审批收件箱', 'Platform saved; the writing-skill draft is in the approval inbox'), 'platform_optional': ('平台（可选）', 'Platform (optional)'),
 'preview': ('看清单 / 改动', 'View manifest / changes'), 'read_agent_card': ('读取 Agent Card', 'Read Agent Card'), 'read_only': ('只读', 'Read-only'),
 'recent_decisions': ('最近处理', 'Recent decisions'), 'reject': ('拒绝', 'Reject'), 'rejected': ('已拒绝', 'Rejected'), 'rejected_boundary': ('硬边界拒绝', 'Refused (hard boundary)'),
 'resume': ('恢复', 'Resume'), 'resumed': ('已恢复', 'Resumed'), 'return_rate': ('退回率', 'Return rate'), 'returned_once': ('退回过一次', 'returned once'),
 'run': ('运行', 'Run'), 'running': ('运行中', 'Running'), 'save': ('保存', 'Save'), 'saved': ('已保存', 'Saved'),
 'schedule_needs_ok': ('定时需你批准后生效', 'schedule takes effect after your approval'), 'sent_to_inbox': ('已进审批收件箱，等你批准', 'Sent to the approval inbox'),
 'steps_done': ('步完成', 'steps done'), 'super_agent': ('超级 Agent', 'Super agent'), 'target': ('目标值', 'Target'), 'team': ('团队', 'Team'), 'this_month': ('本月', 'This month'),
 'to_be_entered': ('待录入', 'To be entered'), 'to_date': ('结束', 'To'),
 'trigger_event': ('事件：', 'Event: '), 'trigger_manual': ('手动', 'Manual'), 'trigger_schedule': ('定时', 'Scheduled'),
 'unverified_fields': ('项规格待核实', 'spec fields to verify'), 'url': ('地址', 'URL'), 'value': ('数值', 'Value'),
 'weekly_review': ('生成周复盘草稿', 'Draft weekly review'), 'wf_started': ('工作流已运行', 'Workflow ran'), 'workflow_templates': ('工作流模板', 'Workflow templates'), 'workflows': ('工作流', 'Workflows'),
 'wf_running': ('运行中', 'Running'), 'wf_done': ('完成', 'Done'), 'wf_failed': ('失败', 'Failed'), 'wf_awaiting_user': ('待你批准', 'Waiting for you'), 'wf_waiting': ('等待中', 'Waiting'), 'wf_cancelled': ('已取消', 'Cancelled'),
 'you': ('你', 'You'),
}
# 数据表里的中文（t(变量) 反查）
D = [
 ('选题研究员', 'Topic researcher'), ('平台适配编辑', 'Platform adapter'), ('视觉与配音制作', 'Visuals & voice'), ('合规审核员', 'Compliance reviewer'), ('数据复盘分析师', 'Data analyst'), ('收益分析师', 'Revenue analyst'), ('评论回复草稿员', 'Reply drafter'), ('素材管理员', 'Asset librarian'),
 ('汇总合法来源（官方榜单、RSS、守 robots 的公开页）的热点，按账号画像出 3–5 个选题，每个附收益假设与来源链接。需要找选题、做晨报时用。', 'Gathers trends from lawful sources (official charts, RSS, robots-respecting public pages) and suggests 3–5 topics for your profile, each with a revenue hypothesis and source link. Use for topic hunting and morning briefings.'),
 ('把一篇母稿改写成多个平台的版本：按各平台写法技能与规格（字数、标签、封面要求）适配，母稿不改。需要一稿多发时用。', 'Rewrites one master draft for several platforms using each platform’s writing skill and specs (length, tags, cover); the master stays unchanged. Use for one-to-many publishing.'),
 ('为草稿写配图提示、生成封面与配图、配音和字幕；AIGC 显式标识默认开启。需要出图、配音时用。', 'Writes image prompts, generates covers and images, voice-overs and subtitles; visible AI labels on by default. Use when you need images or voice.'),
 ('检查草稿是否触碰硬边界、平台规则、敏感词、极限词，是否需要 AIGC 标识；只出审核意见，不改稿。发布前用。', 'Checks drafts against hard boundaries, platform rules, sensitive and superlative words, and AI-label needs; gives review notes only and never edits. Use before publishing.'),
 ('读用户录入或导入的数据，做复盘：先列观察到的模式，再提结构假设，标明证据强度；样本少直说。周复盘、看数据时用。', 'Reviews only data you entered or imported: patterns first, then structural hypotheses with evidence strength; says so when the sample is small. Use for weekly reviews.'),
 ('按漏斗（曝光 / 互动 / 关注 / 转化 / 收入）做收益归因，每个结论附反证与验证办法；只用真实收入记录。看收益、定下周打法时用。', 'Attributes revenue along the funnel (reach / engagement / follows / conversion / income), each conclusion with counter-evidence and a test; real income records only. Use to plan next week.'),
 ('根据用户粘贴进来的评论，起草回复草稿；只生成草稿，由用户自己去平台发，绝不代发。需要回评论时用。', 'Drafts replies to comments you paste in; drafts only — you post them yourself, never on your behalf. Use when replying to comments.'),
 ('整理素材箱：打标签、去重、找出可复用的图片与段落，提醒过期素材。整理素材、找旧素材时用。', 'Tidies the inbox: tags, de-duplicates, finds reusable images and passages, flags stale assets. Use to organise or find old assets.'),
 ('只读', 'Read-only'), ('本机写', 'Local write'), ('花钱 / 外联', 'Spend / external'), ('核心（需你确认）', 'Core (needs your OK)'), ('禁止（硬边界）', 'Forbidden (hard boundary)'),
 ('待办', 'To do'), ('进行中', 'In progress'), ('待验收', 'In review'), ('待你批准', 'Waiting for you'), ('完成', 'Done'), ('失败', 'Failed'),
 ('花钱超阈值', 'Spend over threshold'), ('L3 核心动作', 'L3 core action'), ('核心文件修订', 'Core file revision'), ('新建子 Agent', 'New sub-agent'), ('新平台写法技能', 'New platform writing skill'), ('外部工具启用', 'Enable external tool'),
 ('每日选题晨报', 'Daily topic briefing'), ('一稿多发', 'One draft, many platforms'), ('周复盘', 'Weekly review'),
 ('每天早上：选题研究员汇总合法来源热点 → 超级 Agent 汇总成 3 条 → 通知你', 'Every morning: topic researcher gathers lawful trends → super agent sums up 3 → notifies you'),
 ('写母稿 → 平台适配编辑 → 合规审核员 → 待你发布（发布由你本人点）', 'Master draft → platform adapter → compliance reviewer → ready for you to publish (you press publish)'),
 ('数据复盘 → 收益分析 → 超级 Agent 出下周计划 → 待你批准', 'Data review → revenue analysis → super agent plans next week → waiting for your approval'),
 ('素材箱收到新内容', 'New item in inbox'), ('导入了新数据', 'New data imported'), ('草稿通过审核', 'Draft approved'),
 ('RSS / Atom', 'RSS / Atom'), ('公开页（守 robots，限频）', 'Public page (robots-respecting, rate-limited)'), ('我的 CSV / Excel 导出', 'My CSV / Excel export'), ('官方开放接口（我自己的 Key）', 'Official API (my own key)'),
 ('发布与互动都由你本人在官方 App 内完成。', 'You publish and interact yourself in the official apps.'),
 ('指挥', 'Command'), ('我的团队、任务板、工作流、审批收件箱、目标、连接（平台 / 数据源 / 外部工具）', 'Team, task board, workflows, approvals, goals, connections (platforms / data sources / external tools)'),
 ('豆瓣', 'Douban'), ('小宇宙', 'Xiaoyuzhou'), ('微博', 'Weibo'), ('YouTube', 'YouTube'), ('Instagram', 'Instagram'),
]
def esc(s): return s.replace('\\', '\\\\').replace("'", "\\'")
def load(p): return open(os.path.join(ROOT, p)).read()
zh, en = load('web/src/locales/zh.ts'), load('web/src/locales/en.ts')
have_zh_vals = set(m.group(1) for m in re.finditer(r"^\s*'[^']+':\s*'((?:[^'\\]|\\.)*)',$", zh, re.M))
used = set(re.findall(r"ui\.v12_[a-z0-9_]+", ''.join(open(os.path.join(dp, f)).read() for dp, _, fs in os.walk(os.path.join(ROOT, 'web/src')) for f in fs if f.endswith(('.ts', '.tsx')) and 'locales' not in dp)))
missing = [u for u in used if u not in ('ui.v12_wf_', 'ui.v12_metric_') and u[7:] not in K]
if missing: print('缺少文案：', missing); sys.exit(1)
add_zh, add_en = [], []
for k, (z, e) in K.items():
    if f"'ui.v12_{k}':" not in zh: add_zh.append(f"  'ui.v12_{k}': '{esc(z)}',"); add_en.append(f"  'ui.v12_{k}': '{esc(e)}',")
for i, (z, e) in enumerate(D):
    if z in have_zh_vals or z.replace("'", "\\'") in have_zh_vals: continue
    kid = f"ui.v12_d{i:02d}"
    if f"'{kid}':" in zh: continue
    add_zh.append(f"  '{kid}': '{esc(z)}',"); add_en.append(f"  '{kid}': '{esc(e)}',")
def put(s, lines): return s.rstrip().rstrip('};').rstrip() + '\n' + '\n'.join(lines) + '\n};\n' if lines else s
open(os.path.join(ROOT, 'web/src/locales/zh.ts'), 'w').write(put(zh, add_zh))
open(os.path.join(ROOT, 'web/src/locales/en.ts'), 'w').write(put(en, add_en))
print(f'新增 {len(add_zh)} 条')
