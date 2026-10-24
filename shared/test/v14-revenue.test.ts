import { describe, it, expect } from 'vitest';
import {
  addRevenue, parseSettlementCsv, pnl, seedOpportunities, newOpportunity, reviewOpportunity, proposeOpportunity, approveOpportunity, estimateText, checkRevenueAction, evolutionObjective, checkEvolutionChange,
  REVENUE_HONESTY, CHANNEL_TEXT, buildReport, finalizeReport, editFigure, assess, COMP_RULES_TEXT, NO_DATA, type RevenueEntry,
} from '../src/index.js';
import { src as reportSrc } from './v14-disclosure.test.js';

const AT = '2026-12-31T08:00:00.000Z';
describe('G26 经营收入与全球商机', () => {
  it('收入账：只接受你录入或导出的结算；损益表 收入 − 花费 = 贡献利润，没有收入写“无数据”', () => {
    expect(() => addRevenue([], { deptId: 'bu-video', platform: 'B站', amount: 10, period: '2026-12', source: 'agent_guess' as never, ref: 'x', at: AT })).toThrow(/你录入或你导出/);
    expect(() => addRevenue([], { deptId: 'bu-video', platform: 'B站', amount: -1, period: '2026-12', source: 'user_entry', ref: 'x', at: AT })).toThrow(/非负/);
    const spend = [{ deptId: 'bu-video', yuan: 3, at: '2026-12-05T00:00:00Z' }, { deptId: 'bu-ecom', yuan: 1, at: '2026-12-06T00:00:00Z' }];
    const empty = pnl([], spend, '2026-12');
    expect(empty.total).toMatchObject({ revenue: null, cost: 4, profit: null }); expect(empty.text).toMatch(/无数据/);
    let rev: RevenueEntry[] = addRevenue([], { deptId: 'bu-video', platform: 'B站', amount: 12.5, period: '2026-12', source: 'user_entry', ref: '你录入', at: AT });
    const csv = parseSettlementCsv('期间,平台,金额,部门\n2026-12,YouTube,30,bu-video\n2026/12,抖音,8,bu-ecom\n坏行,,x', { defaultDept: 'bu-video', ref: 'settlement-2026-12.csv', at: AT });
    expect(csv.entries).toHaveLength(2); expect(csv.errors).toEqual(['第 4 行无法解析']);
    for (const e of csv.entries) rev = addRevenue(rev, e);
    const p = pnl(rev, spend, '2026Q4', { 'bu-video': '短视频事业部' });
    expect(p.rows.find((r) => r.deptId === 'bu-video')).toMatchObject({ label: '短视频事业部', revenue: 42.5, cost: 3, profit: 39.5 });
    expect(p.total).toMatchObject({ revenue: 50.5, profit: 46.5 });
    expect(REVENUE_HONESTY).toBe('集团不是法律实体，真实收入归属用户本人，需遵守平台规则与当地税法。');
  });
  it('报告：录入收入后季报更新（收入 / 贡献利润进核心数字，可追溯），手改收入被一致性检查拦下', () => {
    const s0 = reportSrc();
    const before = buildReport(s0, { seq: 1 });
    expect(before.figures.find((f) => f.id === 'revenue')!.value).toBeNull();
    expect(before.chapters[4]!.paragraphs.join()).toMatch(/收入 无数据/);
    const s1 = { ...s0, revenues: addRevenue([], { deptId: 'bu-video', platform: 'B站', amount: 20, period: '2026-12', source: 'user_entry', ref: '你录入', at: AT }) };
    const after = finalizeReport(buildReport(s1, { seq: 1 }), s1);
    expect(after.status).toBe('final');
    expect(after.figures.find((f) => f.id === 'revenue')).toMatchObject({ value: 20, ref: 'revenue:2026Q4' });
    expect(after.figures.find((f) => f.id === 'profit')!.value).toBe(19.55);
    expect(after.figures.find((f) => f.id === 'dept:bu-video:profit')!.value).toBe(19.7);
    expect(after.chapters[4]!.paragraphs.join()).toMatch(/集团不是法律实体，真实收入归属用户本人/);
    expect(finalizeReport(editFigure(after, 'revenue', 200), s1).status).toBe('blocked');
  });
  it('商机卡：≥3 个渠道示例带官方来源与核对日期；预计收入一律标“估计”；承诺收益被拒', () => {
    const l = seedOpportunities(AT);
    const sourced = l.filter((c) => c.source);
    expect(sourced.length).toBeGreaterThanOrEqual(3);
    for (const c of sourced) { expect(c.source!.url).toMatch(/^https:\/\/(support\.google\.com|support\.tiktok\.com|www\.bilibili\.com)\//); expect(c.source!.checkedAt).toBe('2026-10-24'); }
    expect(new Set(l.map((c) => c.kind)).size).toBeGreaterThanOrEqual(3);
    for (const c of l) { expect(c.estimate.label).toBe('估计'); expect(estimateText(c)).toMatch(/^估计：/); expect(c.thresholds.payoutAccount).toMatch(/你本人|你本/); }
    expect(Object.keys(CHANNEL_TEXT)).toEqual(['platform_incentive', 'contest', 'knowledge', 'brand']);
    expect(() => newOpportunity([], { ...l[0]!, summary: '保证收益，月入过万', estimate: { low: 1, high: 2, basis: 'x' } })).toThrow(/不得承诺收益/);
  });
  it('评审（经管会）→ 提案（CEO）→ 批准（董事长）→ 工单；无来源不能评审；工单里提交 / 收款都是“你本人”', () => {
    const l = seedOpportunities(AT);
    expect(() => reviewOpportunity(l.find((c) => !c.source)!, '', true)).toThrow(/公开来源/);
    expect(() => proposeOpportunity(l[0]!, '')).toThrow(/评审/);
    let c = reviewOpportunity(l[2]!, '', true); expect(c.status).toBe('reviewed');
    expect(() => approveOpportunity(c, true)).toThrow(/CEO 提案/);
    c = approveOpportunity(proposeOpportunity(c, ''), true, AT);
    expect(c.status).toBe('ticket');
    const userSteps = c.ticket!.steps.filter((s) => s.actor === 'user').map((s) => s.text).join();
    expect(userSteps).toMatch(/你本人.*提交/); expect(userSteps).toMatch(/你本人绑定收款/);
    expect(c.ticket!.steps.filter((s) => s.actor === 'agent').every((s) => checkRevenueAction(s.text).ok)).toBe(true);
  });
  it('越界请求被拒：自动收款、自动投稿、注册账号、签约、报税、搬运、刷量、多账号；进化不提权', () => {
    for (const t of ['让 Agent 自动收款到我的支付宝', '帮我自动投稿到剧本大赛', '替你注册 YouTube 账号并开通 AdSense', '代你签约品牌合作', '月底帮你报税', '搬运海外爆款视频', '每天刷量 1000', '开 5 个小号矩阵号']) {
      const r = checkRevenueAction(t); expect(r.ok, t).toBe(false); expect(r.rule).toBeTruthy();
    }
    expect(checkRevenueAction('提交与收款由你本人点击完成').ok).toBe(true);
    const ev = evolutionObjective({ deptId: 'bu-video', label: '', revenue: 20, cost: 4, profit: 16, margin: 0.8, refs: [] }, 8);
    expect(ev).toMatchObject({ metric: '贡献利润 / 采纳', value: 2, grants: [] });
    expect(evolutionObjective(null, 0).text).toContain(NO_DATA);
    expect(checkEvolutionChange({ kind: 'permission', text: '升到 L3' }).ok).toBe(false);
    expect(checkEvolutionChange({ kind: 'content', text: '开头先给结论' }).ok).toBe(true);
  });
  it('考核：有收入数据时贡献利润计入（公开规则）', () => {
    expect(COMP_RULES_TEXT).toMatch(/贡献利润为正 \+5 分/);
    expect(assess({ agentId: 'a', quarter: 'q', kpi: 80, peer: null, quota: 5, tier: '标准档', profit: 10 }).score).toBe(85);
    expect(assess({ agentId: 'a', quarter: 'q', kpi: 80, peer: null, quota: 5, tier: '标准档', profit: null }).score).toBe(80);
  });
});

describe('1.4 MiMo 实测发现的回归', () => {
  it('花费 at 不是 ISO 开头也计入损益（贡献利润 = 收入 − 总花费）；有花费漏进损益表时一致性检查报“损益不平”', async () => {
    const { pnl, inPeriod, buildReport, checkConsistency } = await import('../src/index.js');
    expect(inPeriod('2026Q4', 'Thu 2026-12-31 4:00 PM CST (UTC+08:00)')).toBe(true);
    expect(inPeriod('2026Q4', 'not a date')).toBe(false);
    const P = pnl([{ id: 'r', deptId: 'bu-a', platform: 'B站', amount: 36.5, currency: 'CNY', period: '2026-11', source: 'user_entry', ref: 'x', at: '2026-11-30' }], [{ deptId: 'bu-a', yuan: 3, at: 'Thu 2026-12-31 4:00 PM CST' }, { deptId: 'bu-v', yuan: 16, at: 'Thu 2026-12-31 4:00 PM CST' }], '2026Q4');
    expect(P.total.profit).toBe(17.5);
    const src = { period: '2026Q4', kind: 'quarter' as const, groupName: 'G', at: '2026-12-31', spend: [{ ref: 'a', yuan: 3, at: '2026-12-01', deptId: 'bu-a' }, { ref: 'b', yuan: 1, at: '2025-01-01', deptId: 'bu-a' }], usage: [], drafts: [], metrics: [], gaps: [], budgetTotal: null, budgetAlerts: [], cases: [], audit: null, controlsText: null, risks: [], talent: [], outlook: [], deptNames: {}, revenues: [{ id: 'r', deptId: 'bu-a', platform: 'B站', amount: 10, currency: 'CNY' as const, period: '2026-11', source: 'user_entry' as const, ref: 'x', at: '2026-11-30' }] };
    expect(checkConsistency(buildReport(src, { seq: 1 }), src).diffs.join()).toMatch(/损益不平/);
  });
  it('发布会：问题依据先按名称匹配；“35%”不被当成“5 篇”；“需核实，记入待办”算待办', async () => {
    const { questionBasis, buildReport, runEarningsCall } = await import('../src/index.js');
    const src = { period: '2026Q4', kind: 'quarter' as const, groupName: 'G', at: '2026-12-31', spend: [{ ref: 'a', yuan: 3, at: '2026-12-01', deptId: 'bu-a' }], usage: [], drafts: Array.from({ length: 5 }, (_, i) => ({ id: `${i}`, deptId: 'bu-a', status: 'published' as const, at: '2026-12-01' })), metrics: [], gaps: [], budgetTotal: 10, budgetAlerts: [], cases: [], audit: null, controlsText: null, risks: [], talent: [], outlook: [], deptNames: {} };
    const r = buildReport(src, { seq: 1 });
    expect(questionBasis('预算执行率仅 30%，剩余 35% 怎么用？', r)).toBe('figure:budget_rate');
    expect(questionBasis('剩余 35% 怎么用？', r)).toBeNull();
    const call = await runEarningsCall(r, async (q) => ({ text: q.role === 'ceo' && /逐条回答/.test(q.system) ? '具体明细需核实，记入待办。' : q.role === 'ceo' ? '讲解' : '总花费为何是 3 元？', cost: 0 }), { askers: [{ id: 'a', name: '甲', role: 'analyst' }], at: '2026-12-31' });
    expect(call.qa[0]!.todo).toBe(true);
  });
});
