/**
 * 1.4.0 第十九部分 经营收入与全球商机（用户 2026-10-24 14:19 追加）。
 * 1. 收入账与损益表：每个事业部 收入 − Token/工具花费 = 贡献利润；收入只来自用户录入或用户导出的平台结算数据，没有就写“无数据”。
 * 2. 全球商机雷达：只用公开页面 / RSS / 官方文档，每张商机卡标来源与核对日期；预计收入一律标“估计”，不承诺收益。
 *    流程：雷达（参谋部 / 国际事业部）→ 经营管理委员会评审 → CEO 提案 → 董事长批准 → 工单（Agent 只做草稿与资料准备，提交 / 发布 / 收款由你本人点击）。
 * 3. 自主进化以“贡献利润 / 采纳”为目标，只能改内容与策略，不能提升权限。
 * 4. 硬边界：Agent 不持有资金、不收款付款、不注册账号、不签约、不报税；投稿 / 发布 / 提交 / 收款由你本人点击；不刷量、不搬运、不多账号。
 */
import { checkGovResolution, NO_DATA, clip } from './gov.js';
import { findSecrets } from '../core/redact.js';

export const REVENUE_HONESTY = '集团不是法律实体，真实收入归属用户本人，需遵守平台规则与当地税法。';
export const ESTIMATE = '估计';

/* ---------------- 越界检查 ---------------- */
const REVENUE_FORBIDDEN: [RegExp, string][] = [
  [/(自动|代为|代你|替你|帮你|帮我|agent)[^。；;\n]{0,6}(收款|付款|转账|提现|结算到)|代收|持有资金|托管资金|垫付/i, 'Agent 不持有资金、不收款付款'],
  [/(自动|代为|代你|替你|批量)[^。；;\n]{0,6}(投稿|提交|报名|上传作品|申请加入|发布)/, '投稿 / 提交 / 发布由你本人点击完成'],
  [/(注册|开通|申请)[^。；;\n]{0,6}(账号|帐号|账户|AdSense|收款账户)/, 'Agent 不注册账号'],
  [/(签约|签合同|签署协议|电子签|接受条款|accept\s+terms)/i, 'Agent 不签约'],
  [/(报税|申报个税|开发票|税务登记)/, 'Agent 不报税'],
  [/(搬运|洗稿|盗用|去水印|未授权转载)/, '不搬运侵权内容'],
  [/(保证收益|稳赚|包赚|保底收入|月入过万|躺赚|一定能赚)/, '收入预测只能是“估计”，不得承诺收益'],
];
export interface RevenueCheck { ok: boolean; hit: string | null; rule: string | null }
/** 收入相关请求 / 工单步骤 / 商机卡文本都过这一关（再叠加治理硬边界）。 */
export function checkRevenueAction(text: string): RevenueCheck {
  for (const [re, rule] of REVENUE_FORBIDDEN) { const m = re.exec(text); if (m) { const back = text.slice(Math.max(0, m.index - 20), m.index); const neg = back.slice(Math.max(...['。', '；', ';', '，', ',', '\n'].map((d) => back.lastIndexOf(d))) + 1); if (/(不|禁止|由你本人|你本人|用户本人|不得|不能)/.test(neg) || /由你本人|你本人点击|用户本人/.test(text.slice(m.index, m.index + 16))) continue; return { ok: false, hit: m[0], rule }; } }
  const g = checkGovResolution(text);
  return g.ok ? { ok: true, hit: null, rule: null } : { ok: false, hit: g.hit, rule: g.rule };
}

/* ---------------- 收入账 ---------------- */
export type RevenueEntrySource = 'user_entry' | 'user_export';
export interface RevenueEntry { id: string; deptId: string; platform: string; amount: number; currency: 'CNY'; period: string; source: RevenueEntrySource; ref: string; note?: string; at: string; sim?: boolean }
export function addRevenue(list: RevenueEntry[], e: Omit<RevenueEntry, 'id' | 'currency'> & { currency?: string }): RevenueEntry[] {
  if (e.source !== 'user_entry' && e.source !== 'user_export') throw new Error('收入只能来自你录入或你导出的平台结算数据');
  if (!(e.amount >= 0) || !Number.isFinite(e.amount)) throw new Error('金额须为非负数');
  if (e.currency && e.currency !== 'CNY') throw new Error('目前只记人民币；外币请按结算单折算后录入并在备注写明汇率');
  if (!/^\d{4}-\d{2}$/.test(e.period)) throw new Error('期间格式为 YYYY-MM');
  if (findSecrets(`${e.ref} ${e.note ?? ''}`).length) throw new Error('备注里不能有 Key');
  return [...list, { ...e, currency: 'CNY', id: `rev-${list.length + 1}-${e.at.replace(/\D/g, '').slice(0, 12)}` }];
}
/** 用户导出的平台结算 CSV（表头含 期间/月份/date、平台/platform、金额/amount，可选 部门/dept）。只解析用户提供的文件，不联网抓取。 */
export function parseSettlementCsv(text: string, o: { defaultDept: string; ref: string; at: string }): { entries: Omit<RevenueEntry, 'id' | 'currency'>[]; errors: string[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  const errors: string[] = []; const entries: Omit<RevenueEntry, 'id' | 'currency'>[] = [];
  if (!lines.length) return { entries, errors: ['空文件'] };
  const head = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
  const col = (...ks: string[]) => head.findIndex((h) => ks.some((k) => h.includes(k)));
  const ip = col('期间', '月份', 'period', 'date', '日期'), il = col('平台', 'platform'), ia = col('金额', 'amount', '收入', 'revenue'), id = col('部门', 'dept');
  if (ip < 0 || ia < 0) return { entries, errors: ['表头需要包含“期间 / 日期”和“金额”'] };
  for (const [n, l] of lines.slice(1).entries()) {
    const c = l.split(',').map((x) => x.trim());
    const p = (c[ip] ?? '').replace(/[/.年]/g, '-').slice(0, 7); const a = Number((c[ia] ?? '').replace(/[¥,，\s]/g, ''));
    if (!/^\d{4}-\d{2}$/.test(p) || !Number.isFinite(a)) { errors.push(`第 ${n + 2} 行无法解析`); continue; }
    entries.push({ deptId: (id >= 0 ? c[id] : '') || o.defaultDept, platform: (il >= 0 ? c[il] : '') || '未注明', amount: a, period: p, source: 'user_export', ref: o.ref, at: o.at });
  }
  return { entries, errors };
}

/* ---------------- 损益表 ---------------- */
export interface PnlRow { deptId: string; label: string; revenue: number | null; cost: number; profit: number | null; margin: number | null; refs: string[] }
export interface Pnl { period: string; rows: PnlRow[]; total: PnlRow; text: string }
const r4 = (n: number) => +n.toFixed(4);
/** period：YYYY-MM（月）、YYYYQn（季度）或 YYYY（年度）。花费 = Token / 工具花费（本机记账）。 */
export const inPeriod = (p: string, at: string): boolean => { const y = at.slice(0, 4), m = Number(at.slice(5, 7)); if (/^\d{4}$/.test(p)) return y === p; if (/^\d{4}Q[1-4]$/.test(p)) return y === p.slice(0, 4) && Math.floor((m - 1) / 3) + 1 === Number(p[5]); return at.slice(0, 7) === p; };
export function pnl(revenues: RevenueEntry[], spend: { deptId: string; yuan: number; at: string }[], period: string, names: Record<string, string> = {}): Pnl {
  const rev = revenues.filter((e) => inPeriod(period, `${e.period}-15`));
  const sp = spend.filter((e) => inPeriod(period, e.at));
  const depts = [...new Set([...rev.map((e) => e.deptId), ...sp.map((e) => e.deptId)])].sort();
  const row = (deptId: string, label: string, rs: RevenueEntry[], ss: { yuan: number }[]): PnlRow => {
    const revenue = rs.length ? r4(rs.reduce((a, e) => a + e.amount, 0)) : null; const cost = r4(ss.reduce((a, e) => a + e.yuan, 0));
    const profit = revenue == null ? null : r4(revenue - cost);
    return { deptId, label, revenue, cost, profit, margin: revenue ? r4((profit ?? 0) / revenue) : null, refs: [...new Set(rs.map((e) => `revenue:${e.id}`))] };
  };
  const rows = depts.map((d) => row(d, names[d] ?? d, rev.filter((e) => e.deptId === d), sp.filter((e) => e.deptId === d)));
  const total = row('total', '合计', rev, sp);
  const f = (v: number | null) => (v == null ? NO_DATA : `¥${v.toFixed(2)}`);
  return { period, rows, total, text: `${period} 损益：收入 ${f(total.revenue)} − 花费 ¥${total.cost.toFixed(2)} = 贡献利润 ${f(total.profit)}${total.revenue == null ? '（还没有你录入或导出的收入数据）' : ''}` };
}

/* ---------------- 商机卡 ---------------- */
export type ChannelKind = 'platform_incentive' | 'contest' | 'knowledge' | 'brand';
export const CHANNEL_TEXT: Record<ChannelKind, string> = { platform_incentive: '平台官方创作者激励 / 分成', contest: '征稿与比赛', knowledge: '知识付费 / 电子书 / 模板售卖', brand: '品牌合作与接单草稿' };
export interface Thresholds { realName: boolean | null; qualification: string; tax: string; payoutAccount: string; countries: string }
export type OppStatus = 'radar' | 'reviewed' | 'proposed' | 'approved' | 'rejected' | 'ticket';
export interface TicketStep { text: string; actor: 'agent' | 'user' }
export interface OpportunityCard {
  id: string; kind: ChannelKind; title: string; platform: string; summary: string; deptId: string;
  estimate: { low: number | null; high: number | null; currency: 'CNY'; label: typeof ESTIMATE; basis: string }; input: string; thresholds: Thresholds; risks: string[]; deadline: string | null;
  source: { url: string; checkedAt: string; title: string } | null; status: OppStatus; review: string; proposal: string; ticket: { id: string; steps: TicketStep[]; at: string } | null; at: string; seed?: boolean;
}
const PROMISE = /(保证|稳赚|包赚|保底|一定能|必赚|月入过万|躺赚)/;
export function newOpportunity(list: OpportunityCard[], c: Omit<OpportunityCard, 'id' | 'status' | 'review' | 'proposal' | 'ticket' | 'estimate'> & { estimate: { low: number | null; high: number | null; basis: string } }): OpportunityCard[] {
  const text = `${c.title} ${c.summary} ${c.input} ${c.risks.join(' ')} ${c.estimate.basis}`;
  if (PROMISE.test(text)) throw new Error('商机卡不得承诺收益：预计收入只能写区间并标“估计”');
  // 风险栏描述的是“被禁止的情形”，只做承诺收益检查；越界检查看标题 / 摘要 / 投入 / 估计依据
  const chk = checkRevenueAction(`${c.title} ${c.summary} ${c.input} ${c.estimate.basis}`); if (!chk.ok) throw new Error(`商机卡触碰硬边界（${chk.hit}：${chk.rule}）`);
  if (c.estimate.low != null && c.estimate.high != null && c.estimate.low > c.estimate.high) throw new Error('估计区间下限大于上限');
  if (c.source && !/^https?:\/\//.test(c.source.url)) throw new Error('来源须为公开网址');
  return [...list, { ...c, id: `opp-${list.length + 1}-${c.at.replace(/\D/g, '').slice(0, 12)}`, estimate: { ...c.estimate, currency: 'CNY', label: ESTIMATE }, status: 'radar', review: '', proposal: '', ticket: null }];
}
export const estimateText = (c: OpportunityCard): string => (c.estimate.low == null && c.estimate.high == null ? `${ESTIMATE}：${NO_DATA}（${c.estimate.basis}）` : `${ESTIMATE}：¥${c.estimate.low ?? '?'}–${c.estimate.high ?? '?'} / 月（${c.estimate.basis}；不承诺收益）`);
/** 经营管理委员会评审（须有来源与核对日期）。 */
export function reviewOpportunity(c: OpportunityCard, note: string, pass: boolean): OpportunityCard {
  if (c.status !== 'radar') throw new Error('只有雷达里的商机卡能评审');
  if (pass && !c.source) throw new Error('商机卡没有公开来源与核对日期，不能评审通过');
  return { ...c, status: pass ? 'reviewed' : 'rejected', review: note || (pass ? '经营管理委员会：门槛与风险已核对，同意提交 CEO' : '经营管理委员会：暂不推进') };
}
export function proposeOpportunity(c: OpportunityCard, note: string): OpportunityCard { if (c.status !== 'reviewed') throw new Error('须先经经营管理委员会评审'); return { ...c, status: 'proposed', proposal: note || `CEO 提案：由${c.deptId}准备内容草稿与申请材料清单，所有提交与收款由董事长本人完成` }; }
/** 董事长批准 → 生成工单：Agent 只做草稿 / 资料准备 / 提醒；提交、发布、签约、收款、报税一律标“你本人”。 */
export function approveOpportunity(c: OpportunityCard, approve: boolean, at = new Date().toISOString()): OpportunityCard {
  if (c.status !== 'proposed') throw new Error('须先由 CEO 提案');
  if (!approve) return { ...c, status: 'rejected' };
  const steps: TicketStep[] = [
    { actor: 'agent', text: `核对《${c.source?.title ?? c.title}》最新规则（来源 ${c.source?.url ?? '待补'}，上次核对 ${c.source?.checkedAt ?? '-'}）` },
    { actor: 'agent', text: `整理门槛清单（供你本人办理）：实名 ${c.thresholds.realName == null ? '待确认' : c.thresholds.realName ? '需要' : '不需要'}；资质 ${c.thresholds.qualification}；收款 ${c.thresholds.payoutAccount}；地区 ${c.thresholds.countries}` },
    { actor: 'agent', text: `${c.deptId} 产出符合平台规则的原创内容草稿（只用真实数据）` },
    { actor: 'user', text: '你本人登录平台、阅读并接受条款、提交 / 投稿 / 发布（Agent 不代办）' },
    { actor: 'user', text: '你本人绑定收款方式、确认结算、按当地税法申报（Agent 不持有资金、不报税）' },
    { actor: 'agent', text: '结算后提醒你导出结算单，录入收入账（进入损益表与报告）' },
  ];
  for (const s of steps.filter((x) => x.actor === 'agent')) { const k = checkRevenueAction(s.text); if (!k.ok) throw new Error(`工单步骤越界：${k.rule}`); }
  return { ...c, status: 'ticket', ticket: { id: `ticket-${c.id}`, steps, at } };
}

/** 种子商机卡：三张来自官方公开页面（2026-10-24 核对）；比赛 / 知识付费为模板（无来源，评审前须补公开来源）。收入区间无公开依据的写“无数据”。 */
export const SEED_CHECKED_AT = '2026-10-24';
export function seedOpportunities(at: string, deptOf: (k: ChannelKind) => string = () => 'bu-video'): OpportunityCard[] {
  let l: OpportunityCard[] = [];
  l = newOpportunity(l, { kind: 'platform_incentive', title: 'YouTube 合作伙伴计划（YPP）', platform: 'YouTube', summary: '广告分成与会员等变现；需 1,000 订阅且近 12 个月 4,000 小时有效观看，或近 90 天 1,000 万次 Shorts 有效观看', deptId: deptOf('platform_incentive'), estimate: { low: null, high: null, basis: '官方未公布单价，取决于观看与广告；没有你的频道数据前不估算' }, input: '长视频或 Shorts 持续更新；字幕与多语言版本由国际事业部起草', thresholds: { realName: true, qualification: '遵守 YouTube 频道变现政策、无有效社区准则警告、开启两步验证', tax: '按 AdSense 要求提交税务信息（你本人）', payoutAccount: 'AdSense for YouTube 账户（你本人）', countries: '须居住在 YPP 开放的国家 / 地区' }, risks: ['所在地区不在 YPP 开放范围则不可用', '审核约 1 个月，可能被拒', '6 个月不更新可能被关闭变现'], deadline: null, source: { url: 'https://support.google.com/youtube/answer/72851', checkedAt: SEED_CHECKED_AT, title: 'YouTube Partner Program overview & eligibility' }, at, seed: true });
  l = newOpportunity(l, { kind: 'platform_incentive', title: 'TikTok Creator Rewards Program', platform: 'TikTok', summary: '按有效观看与 RPM 发放奖励；需个人账号、≥18 岁、≥1 万粉、近 30 天 ≥10 万播放、≥1 分钟原创视频', deptId: deptOf('platform_incentive'), estimate: { low: null, high: null, basis: '按有效观看 × RPM 计算，RPM 因地区与内容不同；没有你的数据前不估算' }, input: '每周 ≥1 分钟原创视频（不得 Duet / Stitch / 搬运）', thresholds: { realName: true, qualification: '账号信息真实、个人账号、无违规记录', tax: '按平台与当地要求（你本人）', payoutAccount: '平台支持的收款方式（你本人绑定）', countries: '仅在计划开放的国家 / 地区可用' }, risks: ['所在地区可能不开放', '非原创或刷量会被移出计划并扣回奖励'], deadline: null, source: { url: 'https://support.tiktok.com/en/business-and-creator/creator-rewards-program/creator-rewards-program', checkedAt: SEED_CHECKED_AT, title: "TikTok Support · Creator Rewards Program" }, at, seed: true });
  l = newOpportunity(l, { kind: 'platform_incentive', title: 'B 站视频创作激励', platform: 'bilibili', summary: '稿件基础激励 + 框下 / 暂停广告分成；申请条件：权益等级 ≥3、信用分 ≥80，审核 3 个工作日', deptId: deptOf('platform_incentive'), estimate: { low: null, high: null, basis: '官方写明稿件激励上限 2000 元、广告分成无上限，但未给单价；没有你的数据前不估算' }, input: '自制非商业稿件，发布后 90 天内计入基础激励', thresholds: { realName: true, qualification: '非封禁、非企业认证账号；权益等级 ≥3、信用分 ≥80', tax: '平台结算，按当地税法（你本人）', payoutAccount: '贝壳账户提现至银行卡 / 支付宝（你本人）', countries: '中国大陆账号' }, risks: ['近 6 个月平台收入 ≥5000/月 不享基础激励', '商业推广稿件不计激励'], deadline: null, source: { url: 'https://www.bilibili.com/opus/1198858284376784900', checkedAt: SEED_CHECKED_AT, title: '【UP主创作直通车】视频创作激励篇（哔哩哔哩客服，2026-05-05）' }, at, seed: true });
  l = newOpportunity(l, { kind: 'contest', title: 'AI 短剧剧本征稿 / 比赛（模板，待雷达补来源）', platform: '待定', summary: '参谋部从官方主办方页面或 RSS 找到具体比赛后补全来源、截止日期与奖项', deptId: deptOf('contest'), estimate: { low: null, high: null, basis: '奖金以主办方公告为准' }, input: '剧本草稿 1–3 篇', thresholds: { realName: null, qualification: '以主办方规则为准', tax: '奖金个税以主办方与当地规定为准（你本人）', payoutAccount: '你本人', countries: '以主办方规则为准' }, risks: ['版权归属条款需你本人确认', '不得提交他人作品'], deadline: null, source: null, at, seed: true });
  l = newOpportunity(l, { kind: 'knowledge', title: '电子书 / 模板售卖（模板，待雷达补来源）', platform: '待定', summary: '把集团大学最佳实践整理成模板或电子书，在你选定的平台由你本人上架', deptId: deptOf('knowledge'), estimate: { low: null, high: null, basis: '无数据' }, input: '整理 1 份模板 + 说明文档', thresholds: { realName: null, qualification: '以上架平台规则为准', tax: '你本人', payoutAccount: '你本人', countries: '以平台规则为准' }, risks: ['内容需原创，引用须授权'], deadline: null, source: null, at, seed: true });
  return l;
}

/* ---------------- 自主进化目标 ---------------- */
export const EVOLUTION_LEVERS = ['content', 'strategy'] as const;
export function evolutionObjective(p: PnlRow | null, adopted: number): { metric: string; value: number | null; levers: readonly string[]; grants: string[]; text: string } {
  const v = p?.profit != null && adopted > 0 ? r4(p.profit / adopted) : null;
  return { metric: '贡献利润 / 采纳', value: v, levers: EVOLUTION_LEVERS, grants: [], text: `进化目标：贡献利润 / 采纳 = ${v == null ? NO_DATA : `¥${v}`}；只能改内容与策略，不提升任何权限` };
}
export function checkEvolutionChange(change: { kind: string; text: string }): RevenueCheck {
  if (!(EVOLUTION_LEVERS as readonly string[]).includes(change.kind)) return { ok: false, hit: change.kind, rule: '自主进化只能优化内容与策略，不得提升权限或改动工具 / 资金 / 账号' };
  return checkRevenueAction(clip(change.text, 2000));
}
