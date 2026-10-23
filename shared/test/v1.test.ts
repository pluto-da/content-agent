/** 1.0 第一部分：费用护栏（月度预算、按角色日上限、异常花费只提醒、超预算一定先问、不可记住）。 */
import { describe, it, expect } from 'vitest';
import { needsApproval, budgetReasons, readSpendGuard, summarizeSpend, spendAlerts, monthBudgetReached, DEFAULT_SPEND_GUARD, BUDGET_CONFIRM, type SpendGuard } from '../src/index.js';
import { makeHarness, replies } from '../../evals/harness.js';

const g = (o: Partial<SpendGuard> = {}): SpendGuard => ({ ...DEFAULT_SPEND_GUARD, ...o, anomaly: { ...DEFAULT_SPEND_GUARD.anomaly, ...(o.anomaly ?? {}) } });
const base = { tool: 'image_generate', level: 'L1' as const, kind: 'model' as const, role: 'image', spentToday: 0, mediaRole: true, thresholds: { perCallConfirmYuan: 1, perDayConfirmYuan: 10 }, remembered: [] };
const NOW = Date.parse('2026-10-23T12:00:00+08:00');

describe('费用护栏：规则', () => {
  it('默认月度预算 ¥30、无角色上限；读设置时夹紧与丢弃非法值', () => {
    expect(DEFAULT_SPEND_GUARD.monthBudgetYuan).toBe(30);
    const r = readSpendGuard({ monthBudgetYuan: -5, roleDayCapYuan: { image: 2, video: -1, tts: 'x' }, anomaly: { dayFactor: 0.2 } });
    expect(r.monthBudgetYuan).toBe(0); expect(r.roleDayCapYuan).toEqual({ image: 2 }); expect(r.anomaly.dayFactor).toBe(1.5);
    expect(readSpendGuard(null)).toEqual(DEFAULT_SPEND_GUARD);
  });
  it('本月已花 + 本次预计 > 预算 → budget_month；未超不触发；预算 0 = 不设', () => {
    expect(budgetReasons(g({ monthBudgetYuan: 30 }), { spentMonth: 29.9, spentTodayByRole: {} }, 'image', 0.2)).toEqual(['budget_month']);
    expect(budgetReasons(g({ monthBudgetYuan: 30 }), { spentMonth: 29, spentTodayByRole: {} }, 'image', 0.2)).toEqual([]);
    expect(budgetReasons(g({ monthBudgetYuan: 0 }), { spentMonth: 999, spentTodayByRole: {} }, 'image', 5)).toEqual([]);
  });
  it('单价未知：本月已到预算也要问', () => { expect(budgetReasons(g({ monthBudgetYuan: 10 }), { spentMonth: 10, spentTodayByRole: {} }, 'tts', null)).toEqual(['budget_month']); });
  it('按角色日上限：只看该角色今天已花', () => {
    const gg = g({ roleDayCapYuan: { image: 1 } });
    expect(budgetReasons(gg, { spentMonth: 0, spentTodayByRole: { image: 0.9 } }, 'image', 0.2)).toEqual(['role_day_cap']);
    expect(budgetReasons(gg, { spentMonth: 0, spentTodayByRole: { image: 0.9, chat: 5 } }, 'chat', 0.2)).toEqual([]);
  });
  it('超预算一定先问：即使低于单次 / 当日确认线、即使“记住此类”过也要问，且不可记住', () => {
    const r = needsApproval({ ...base, estCost: 0.05, remembered: [{ tool: 'image_generate', scope: '*' }], guard: g({ monthBudgetYuan: 1 }), spend: { spentMonth: 1, spentTodayByRole: {} } });
    expect(r.confirm).toBe(true); expect(r.reasons).toContain('budget_month'); expect(r.rememberable).toBe(false);
    const c = needsApproval({ ...base, estCost: 0.05, guard: g({ roleDayCapYuan: { image: 0.04 } }), spend: { spentMonth: 0, spentTodayByRole: {} } });
    expect(c.reasons).toEqual(['role_day_cap']); expect(c.rememberable).toBe(false);
    expect([...BUDGET_CONFIRM].sort()).toEqual(['budget_month', 'role_day_cap']);
  });
  it('不传护栏 = 旧行为不变（兼容 0.9–0.11）', () => { expect(needsApproval({ ...base, estCost: 0.2 }).confirm).toBe(false); });
  it('非模型工具不受预算影响', () => { expect(needsApproval({ ...base, kind: 'other', role: undefined, mediaRole: false, estCost: 0, guard: g({ monthBudgetYuan: 1 }), spend: { spentMonth: 5, spentTodayByRole: {} } }).confirm).toBe(false); });
});

describe('费用护栏：汇总与异常提醒（只提醒）', () => {
  const rec = (at: string, role: string, cost: number | null) => ({ at, role, cost });
  it('按 Asia/Shanghai 自然日 / 月汇总（UTC 前一天 16:00 后算今天）', () => {
    const s = summarizeSpend([rec('2026-10-22T16:30:00Z', 'image', 0.5), rec('2026-10-22T15:30:00Z', 'chat', 0.1), rec('2026-09-30T15:00:00Z', 'chat', 9), rec('2026-10-01T03:00:00Z', 'tts', null)], NOW);
    expect(s.month).toBe('2026-10'); expect(s.spentToday).toBeCloseTo(0.5); expect(s.spentMonth).toBeCloseTo(0.6); expect(s.spentTodayByRole).toEqual({ image: 0.5 }); expect(s.calls).toBe(3);
  });
  it('今天花费远高于近 7 天日均 → day_spike；单笔超过绝对线 → single_call；月 80% / 超出', () => {
    const rs = [1, 2, 3, 4, 5, 6, 7].map((d) => rec(new Date(NOW - d * 864e5).toISOString(), 'chat', 0.2));
    rs.push(rec(new Date(NOW - 3600e3).toISOString(), 'image', 2.5), rec(new Date(NOW - 7200e3).toISOString(), 'chat', 0.3));
    const a = spendAlerts(rs, g({ monthBudgetYuan: 5 }), NOW);
    const kinds = a.map((x) => x.kind);
    expect(kinds).toContain('day_spike'); expect(kinds).toContain('single_call'); expect(kinds).toContain('month_80');
    expect(spendAlerts(rs, g({ monthBudgetYuan: 3 }), NOW).map((x) => x.kind)).toContain('month_over');
    expect(new Set(a.map((x) => x.id)).size).toBe(a.length);
  });
  it('平稳花费不提醒', () => {
    const rs = [0, 1, 2, 3, 4, 5, 6, 7].map((d) => rec(new Date(NOW - d * 864e5 - 3600e3).toISOString(), 'chat', 0.2));
    expect(spendAlerts(rs, g({ monthBudgetYuan: 0 }), NOW)).toEqual([]);
  });
  it('单笔远高于该角色中位数 → call_spike', () => {
    const rs = [1, 2, 3, 4, 5, 6].map((d) => rec(new Date(NOW - d * 864e5).toISOString(), 'chat', 0.01));
    rs.push(rec(new Date(NOW - 60e3).toISOString(), 'chat', 0.2));
    expect(spendAlerts(rs, g({ monthBudgetYuan: 0, anomaly: { dayFactor: 100, callFactor: 5, minYuan: 1, singleCallYuan: 0 } }), NOW).map((x) => x.kind)).toEqual(['call_spike']);
  });
  it('monthBudgetReached', () => { expect(monthBudgetReached(g({ monthBudgetYuan: 2 }), { spentMonth: 2, spentTodayByRole: {} })).toBe(true); expect(monthBudgetReached(g({ monthBudgetYuan: 0 }), { spentMonth: 2, spentTodayByRole: {} })).toBe(false); });
});

describe('费用护栏：运行时', () => {
  it('本月预算已用完：对话开跑前先问；拒绝 → 不调用模型、不花钱', async () => {
    const h = await makeHarness([{ purpose: 'turn', text: '好的' }], { approve: () => 'deny', spendGuard: { guard: g({ monthBudgetYuan: 1 }), state: { spentMonth: 1.2, spentTodayByRole: {} } } });
    await h.runtime.send(1, '写一句早安文案');
    expect(h.pendings[0]?.reasons).toEqual(['budget_month']);
    expect(h.model.calls.length).toBe(0);
    expect(replies(h).at(-1)).toMatch(/没有调用模型，没有花钱/);
  });
  it('本月预算已用完：允许后照常回答', async () => {
    const h = await makeHarness([{ purpose: 'turn', text: '早安，今天也元气满满' }], { approve: () => 'allow', spendGuard: { guard: g({ monthBudgetYuan: 1 }), state: { spentMonth: 1.2, spentTodayByRole: {} } } });
    await h.runtime.send(1, '写一句早安文案');
    expect(h.model.calls.length).toBe(1); expect(replies(h).at(-1)).toContain('早安');
  });
  it('工具层：超出角色日上限的生图一定先问，选“记住此类”也不会被记住', async () => {
    const h = await makeHarness([{ purpose: 'turn', tools: [{ name: 'image_generate', args: { prompt: '秋天的小米田' } }] }, { purpose: 'turn', text: '图好了' }], { approve: () => 'remember', spendGuard: { guard: g({ monthBudgetYuan: 0, roleDayCapYuan: { image: 0.5 } }), state: { spentMonth: 0, spentTodayByRole: { image: 0.6 } } } });
    await h.runtime.send(1, '画一张秋天的小米田');
    const p = h.pendings.find((x) => x.tool === 'image_generate');
    expect(p?.reasons).toContain('role_day_cap');
    expect(h.remembered).toEqual([]);
  });
  it('未超预算：不多问（护栏不打扰正常使用）', async () => {
    const h = await makeHarness([{ purpose: 'turn', text: '好' }], { approve: () => 'deny', spendGuard: { guard: g({ monthBudgetYuan: 30 }), state: { spentMonth: 3, spentTodayByRole: {} } } });
    await h.runtime.send(1, '你好');
    expect(h.pendings.length).toBe(0); expect(h.model.calls.length).toBe(1);
  });
});
