/**
 * 1.4.0 董事长学堂（PROMPT-v1.4 第十一部分）：每个治理页面顶部一句大白话 + “1 分钟看懂”卡片（中英文，≥20 张）；
 * 每周一课（结合本周集团真实发生的事，已读不重复，可关闭）；成长徽章（只鼓励不打卡）；术语悬停（GLOSSARY → 卡片）。
 */
export interface AcademyCard { id: string; term: string; termEn: string; plain: string; plainEn: string; minute: string; minuteEn: string; page: string; aliases: string[] }
const C = (id: string, term: string, termEn: string, plain: string, plainEn: string, minute: string, minuteEn: string, page: string, aliases: string[] = []): AcademyCard => ({ id, term, termEn, plain, plainEn, minute, minuteEn, page, aliases });
export const ACADEMY_CARDS: AcademyCard[] = [
  C('agm', '股东会', 'Shareholders’ meeting', '你是唯一股东，股东会就是一年一次的“董事长大会”。', 'You are the only shareholder, so it is your yearly “chairman’s assembly”.', '每年开一次：审议年报、定下一年的使命愿景和目标、定预算总额、批准章程修改。四步按顺序走完才闭会。', 'Once a year: review the annual report, set next year’s mission and goals, set the total budget, approve charter changes — in that order.', 'board', ['年度大会', '年度董事长大会']),
  C('board', '董事会', 'Board of directors', '决定方向、批大事、盯着经营层的那张桌子。', 'The table that sets direction, approves big decisions and watches management.', '你是董事长，CEO 是执行董事，再加 2 名独立董事和 1 名董秘。战略、预算、组织大调整、章程与 DOA、接班交接都要过董事会；你有最终决定权。', 'You chair it; the CEO is an executive director, plus 2 independent directors and a secretary. Strategy, budget, big re-orgs, charter/DOA and model handovers go through it; you have the final say.', 'board'),
  C('independent', '独立董事', 'Independent director', '专门不听 CEO 的人，帮你挑毛病。', 'The one who doesn’t take the CEO’s word for it — paid to find problems.', '用和 CEO 不同的模型（最好不同服务商），只看原始记录不看 CEO 的总结，每项议案必须写“同意 / 反对 / 弃权 + 理由”。只有一个模型时会标“独立性弱”。', 'Runs on a different model (ideally a different vendor), reads raw records not the CEO’s summary, and must vote agree/oppose/abstain with a reason. With a single model it is flagged “weak independence”.', 'board', ['独董']),
  C('audit_committee', '审计委员会', 'Audit committee', '董事会里专管“查账、查流程”的小组，主席是独立董事。', 'The board group that checks the books and processes; chaired by an independent director.', '它直接听内审汇报、审核报告里的数字、盯整改。参照《公司法》，审计委员会可以代行监事会的监督职权。', 'It hears internal audit directly, checks report numbers and follows remediation. Modelled on PRC Company Law, where it can take over the supervisory board’s role.', 'oversight', ['审计委']),
  C('three_lines', '三道防线', 'Three lines', '业务自查、风控把关、内审独立复查，三层一起把问题拦在发布前。', 'Teams self-check, risk & compliance challenge, internal audit independently assures — together.', '第一道：事业部发稿前自检；第二道：法务合规部 + 风控岗；第三道：内审（独立模型，直接向你和审计委员会汇报）。三道同时运作，不是排队过关。', 'Line 1: teams self-check before publishing; line 2: legal/compliance and risk; line 3: internal audit on an independent model, reporting to you and the audit committee. All run at the same time.', 'oversight', ['三线模型', '第三道防线']),
  C('internal_audit', '内审', 'Internal audit', '每月随机抽查一次，看钱花得对不对、规矩守没守。', 'A monthly random check: was money spent right, were the rules followed?', '抽 10%，查六件事：花费账对不对、有没有越权、退回有没有引用条款、有没有碰硬边界、数据有没有出处、有没有编数据。报告直送你，CEO 只收抄送。', 'Samples 10% and checks six things: spend vs usage, authority bypass, rulings citing a clause, hard boundaries, data sources, fabrication. Reports go to you; the CEO is only cc’d.', 'oversight', ['内审报告']),
  C('internal_control', '内控', 'Internal control', '让“做对的事”变成流程，不靠人记得。', 'Turning “doing the right thing” into process instead of memory.', '按 COSO 五要素（控制环境、风险评估、控制活动、信息与沟通、监督）列关键控制点，每点有目标、做法、负责人、证据和测试方法，由自检脚本自动测试。', 'Key controls listed under COSO’s five components, each with an objective, activity, owner, evidence and a test — tested automatically.', 'oversight', ['内控矩阵', 'COSO']),
  C('ops_review', '经营分析会', 'Monthly business review', '每月一次，对着数字找差距、找原因、定动作。', 'Once a month: find the gaps in the numbers, the causes, and next actions.', '经管会主持、CEO 汇报，用“目标 – 实际 – 差距 – 原因 – 动作”五列表。没有数据就写“无数据”，绝不编。', 'Hosted by the management committee, presented by the CEO, using a target–actual–gap–cause–action table. No data means “no data” — never invented.', 'ops', ['经营分析', '月度经营分析会']),
  C('bsc', '平衡计分卡', 'Balanced scorecard', '不只看结果，还看受众、流程和成长。', 'Look beyond results: audience, process and growth too.', '本系统的四个维度：成果（产出、采纳、你录入的效果）、受众（反馈与画像）、流程（一次通过率、周期、退回率）、成长（技能、案例、模型）。', 'Four views here: outcome (output, adoption, results you log), audience, process (first-pass rate, cycle, returns) and growth (skills, cases, models).', 'ops'),
  C('budget', '全面预算', 'Comprehensive budget', '年初把钱分到季度、部门、项目，每天看花了多少。', 'Split the year’s money by quarter, team and project, and track it daily.', '执行率每天更新，偏差超过 20% 自动预警；超支要走请示；季度调整要董事会批准。', 'Execution updates daily; >20% deviation triggers an alert; overspending needs a request; quarterly changes need board approval.', 'ops', ['预算', '预算偏差']),
  C('reports', '季报与年报', 'Quarterly & annual reports', '像上市公司财报一样，定期把集团干得怎么样摊开给你看。', 'Like a listed company’s filings: a regular, honest look at how the group is doing.', '11 个章节，每个数字都能点开追溯到原始记录；和记账对不上就不让生成。封面用你的笔名，不含隐私。', '11 chapters; every number traces to a raw record; if it doesn’t match the ledger, generation is blocked. Pen name on the cover, no private data.', 'disclosure', ['季报', '年报']),
  C('earnings_call', '业绩发布会', 'Earnings call', '季报出来后，让分析师和独立董事当面“拷问”CEO。', 'After the quarterly report, analysts and independent directors grill the CEO.', 'CEO 讲 10 分钟，分析师 ×2 和独立董事提问，问题必须基于报告里的数字或“无数据”项；答不上来的记入待办。是为了逼出真问题，不是走过场。', 'The CEO talks for ten minutes; two analysts and an independent director ask questions grounded in the report’s numbers or gaps; unanswered ones become to-dos.', 'disclosure', ['发布会']),
  C('strategy_map', '战略地图', 'Strategy map', '一张表说清：目标 → 靠什么举措 → 谁负责 → 看什么指标 → 花多少钱。', 'One table: goal → initiative → owner → metric → budget.', '战略批准后会自动拆成 OKR；半年复盘一次，检查当初的假设还成不成立。', 'Once approved it becomes OKRs automatically; every six months we check whether the assumptions still hold.', 'strategy'),
  C('blm', 'BLM 业务领先模型', 'Business Leadership Model', '一套做年度战略的八步清单，从“差在哪”问到“怎么干”。', 'An eight-step checklist for yearly strategy, from “where are we short” to “how we execute”.', '差距分析 → 市场洞察 → 战略意图 → 创新焦点 → 业务设计 → 关键任务 → 组织与人才 → 氛围与文化。参照公开资料，不是任何公司的官方方法。', 'Gap → market insight → strategic intent → innovation focus → business design → critical tasks → organisation & talent → climate. Based on public material, not any company’s official method.', 'strategy', ['BLM', '战略沙盘']),
  C('okr', 'OKR', 'OKR', '目标（O）+ 可衡量的关键结果（KR），全员公开。', 'Objectives plus measurable key results, visible to everyone.', '你定年度目标，经管会拆到部门，部门拆到 Agent；进度只用录入的数据，没录就是“待录入”。', 'You set yearly goals, the management committee splits them by team and agent; progress only uses logged data.', 'strategy'),
  C('doa', 'DOA', 'Delegation of authority', '一张“谁能拍板什么”的表。', 'A table of who may decide what.', '花钱、对外、改规则、改权限、硬边界五类事有明确权限；越权会被拦下并记录，超权的事变成请示送到你这里。', 'Spending, external actions, rule changes, permission changes and hard boundaries each have set authority; overreach is blocked and logged.', 'board', ['决策权限表']),
  C('race', '赛马', 'Horse race', '方向不确定时，让 2–3 个方案同时跑，盲评选最好的。', 'When the direction is unclear, run 2–3 options in parallel and pick blind.', '只对“高价值 + 方向不确定”的事开，有专项预算；评审只看 A/B/C 代号，落选方案入素材库。', 'Only for high-value, uncertain work, with its own budget; reviewers only see A/B/C; losers go to the asset library.', 'talent'),
  C('gray', '灰度', 'Gradual rollout', '新做法先在一小部分任务上试，没变差再全面推开。', 'Try a new way on a small slice first; roll out only if nothing gets worse.', '一个事业部或 20% 任务试行一周期，指标下降就自动回滚。', 'One team or 20% of tasks for one cycle; automatic rollback if metrics drop.', 'talent'),
  C('commissar', '政委', 'Commissar (culture partner)', '只观察、只提建议，不指挥干活的“文化伙伴”。', 'A culture partner who only observes and suggests, never commands.', '看退回率、硬边界触碰、空转等信号，给培训或调整建议；下指令会被拒绝并记录。', 'Watches return rates, boundary hits and idling, and suggests training or changes; any command is refused and logged.', 'talent'),
  C('retro', '复盘', 'Retrospective', '做完一件事，回头看：目标、结果、原因、经验。', 'After a piece of work: goal, result, cause, lesson.', '复盘的结论会自动变成集团大学的案例卡，下次同类任务会被提醒。', 'Retro conclusions become case cards in the group university and are surfaced next time.', 'university'),
  C('succession', '接班人计划', 'Succession plan', '换模型前先“影子上岗”比一比，比不过就不换。', 'Before swapping models, shadow-run and compare; if it isn’t better, no swap.', '新模型和老模型并跑 10 个任务（≤¥0.5），独立董事盲评再看花费；达标才交接，交接后还能回滚。', 'The new model shadows the old on 10 tasks (≤¥0.5); independent directors judge blind, then costs; handover only if it passes, with rollback kept.', 'talent', ['影子上岗']),
  C('pnl', '损益表与商机卡', 'P&L and opportunity cards', '每个事业部挣了多少、花了多少、净赚多少；以及哪里还有公开、合规的赚钱机会。', 'What each unit earned, spent and kept — and where public, compliant ways to earn are.', '收入只来自你录入或导出的平台结算，收入 − Token / 工具花费 = 贡献利润；没有数据写“无数据”。商机卡来自官方公开页面并标核对日期，收入只写“估计”区间；经管会评审、CEO 提案、你批准后变成工单。投稿、发布、收款都由你本人点击，Agent 不碰钱、不签约、不报税。', 'Revenue only comes from what you enter or export from platform settlements; revenue minus token/tool cost is contribution profit; no data means “no data”. Opportunity cards cite official public pages with a check date and show estimates only; the management committee reviews, the CEO proposes, you approve, and it becomes a ticket. You submit, publish and get paid yourself; agents never touch money, sign or file taxes.', 'revenue', ['损益表', '贡献利润', '商机卡', '商机雷达']),
  C('equity', '股权激励', 'Equity incentives', '上市公司用股票奖励员工；这里没有真实股权。', 'Listed companies reward staff with shares; there is no real equity here.', '本系统里 Agent 的“薪酬”是预算配额、模型档位和并发优先级，规则公开。不涉及任何真实股权、证券或融资。', 'Here an agent’s “pay” is budget quota, model tier and priority, under public rules. No real equity, securities or financing.', 'talent', ['薪酬', '资源激励']),
];
export const MIN_CARDS = 20;
export const cardById = (id: string): AcademyCard | undefined => ACADEMY_CARDS.find((c) => c.id === id);
/** 术语悬停：术语（含别名）→ 卡片 id；按长度倒序匹配，避免“审计委员会”被“审计”截断。 */
export const GLOSSARY: Record<string, string> = Object.fromEntries(ACADEMY_CARDS.flatMap((c) => [[c.term, c.id], ...c.aliases.map((a) => [a, c.id])]));
export function findTerms(text: string): { term: string; id: string; index: number }[] {
  const keys = Object.keys(GLOSSARY).sort((a, b) => b.length - a.length);
  const out: { term: string; id: string; index: number }[] = []; const taken: [number, number][] = [];
  for (const k of keys) { let i = text.indexOf(k); while (i >= 0) { if (!taken.some(([a, b]) => i < b && i + k.length > a)) { out.push({ term: k, id: GLOSSARY[k]!, index: i }); taken.push([i, i + k.length]); } i = text.indexOf(k, i + k.length); } }
  return out.sort((a, b) => a.index - b.index);
}
export const PAGE_PLAIN: Record<string, string> = { board: 'board', oversight: 'three_lines', ops: 'ops_review', disclosure: 'reports', strategy: 'strategy_map', talent: 'succession', university: 'retro', academy: 'independent', revenue: 'pnl' };

/* ---------------- 每周一课 ---------------- */
export interface WeekEvent { kind: 'audit_finding' | 'budget_alert' | 'board_oppose' | 'override' | 'call_todo' | 'shadow' | 'training' | 'report_blocked' | 'race' | 'gray_rollback' | 'retro'; text: string }
const EVENT_CARD: Record<WeekEvent['kind'], string> = { audit_finding: 'three_lines', budget_alert: 'budget', board_oppose: 'independent', override: 'board', call_todo: 'earnings_call', shadow: 'succession', training: 'retro', report_blocked: 'reports', race: 'race', gray_rollback: 'gray', retro: 'retro' };
export interface WeeklyLesson { week: string; cardId: string; text: string; event: string | null }
export function isoWeek(d: Date): string { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = t.getUTCFullYear(); const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7); return `${y}-W${String(w).padStart(2, '0')}`; }
/** 结合本周真实事件挑一张没读过的卡；都读过或已关闭则不推。 */
export function weeklyLesson(events: WeekEvent[], read: string[], off: boolean, now: Date, lang: 'zh' | 'en' = 'zh'): WeeklyLesson | null {
  if (off) return null;
  const week = isoWeek(now);
  for (const e of events) { const id = EVENT_CARD[e.kind]; const c = cardById(id); if (c && !read.includes(id)) return { week, cardId: id, event: e.text, text: lang === 'en' ? `This week: ${e.text}. That is “${c.termEn}” at work — ${c.plainEn}` : `本周${e.text}，这就是“${c.term}”在起作用：${c.plain}` }; }
  const next = ACADEMY_CARDS.find((c) => !read.includes(c.id));
  return next ? { week, cardId: next.id, event: null, text: lang === 'en' ? `Card of the week: ${next.termEn} — ${next.plainEn}` : `本周小知识：${next.term}——${next.plain}` } : null;
}

/* ---------------- 成长徽章（只鼓励） ---------------- */
export const BADGES = [
  { id: 'starter', name: '入门董事长', nameEn: 'New chair', cards: 3, motions: 0 },
  { id: 'steady', name: '稳健董事长', nameEn: 'Steady chair', cards: 10, motions: 3 },
  { id: 'seasoned', name: '老练董事长', nameEn: 'Seasoned chair', cards: 20, motions: 10 },
] as const;
export function badgesOf(cardsRead: number, motionsDecided: number): { earned: string[]; next: { id: string; name: string; needCards: number; needMotions: number } | null; note: string } {
  const earned = BADGES.filter((b) => cardsRead >= b.cards && motionsDecided >= b.motions).map((b) => b.id);
  const nb = BADGES.find((b) => !earned.includes(b.id));
  return { earned, next: nb ? { id: nb.id, name: nb.name, needCards: Math.max(0, nb.cards - cardsRead), needMotions: Math.max(0, nb.motions - motionsDecided) } : null, note: '徽章只用来鼓励，没有打卡、没有连续天数要求。' };
}
