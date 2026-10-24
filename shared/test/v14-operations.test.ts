import { describe, it, expect } from 'vitest';
import { gapTable, monthlyReview, BSC_DIMS, BSC_TEXT, makeBudget, budgetExecution, overspendAsk, proposeAdjust, applyAdjust, roiBoard, NO_DATA, type Metric } from '../src/index.js';

const M = (key: string, dim: Metric['dim'], target: number | null, actual: number | null, src: boolean, direction: 'up' | 'down' = 'up'): Metric => ({ key, label: key, dim, direction, target, actual, unit: '', source: src ? { kind: 'metrics', ref: `2026-10#${key}` } : null });

describe('G7 月度经营分析（平衡计分卡 + 五列差距表），只用可验证数据', () => {
  it('四维度；五列；没有出处的实际值一律“无数据”，不编造', () => {
    expect(BSC_DIMS.map((d) => BSC_TEXT[d])).toEqual(['成果', '受众', '流程', '成长']);
    const rows = gapTable([M('outputs', 'outcome', 20, 12, true), M('fans', 'audience', 500, 9999, false), M('return', 'process', 0.2, 0.1, true, 'down'), M('cases', 'growth', 10, null, true)]);
    expect(rows[0]).toMatchObject({ target: '20', actual: '12', gap: '-8', behind: true, verifiable: true, ref: 'metrics:2026-10#outputs' });
    expect(rows[1]).toMatchObject({ actual: NO_DATA, gap: NO_DATA, verifiable: false, ref: null });
    expect(rows[1]!.cause).toMatch(/没有可核实的数据/);
    expect(rows[2]!.behind).toBe(false);
    expect(rows[3]!.actual).toBe(NO_DATA);
    const r = monthlyReview({ month: '2026-10', metrics: [M('outputs', 'outcome', 20, 12, true), M('fans', 'audience', 500, null, false)], at: '2026-10-31T00:00:00Z', budgetAlerts: ['偏差 35%'] });
    expect(r.host).toBe('经营管理委员会'); expect(r.reporter).toBe('CEO');
    expect(r.byDim.audience.noData).toBe(1);
    expect(r.actions.map((a) => a.title)).toEqual(['outputs：下月列为重点动作，指定负责人', 'fans：下月前补齐数据来源']);
    expect(r.budgetAlerts).toEqual(['偏差 35%']);
  });
});

describe('G8 全面预算、偏差预警、调整审批', () => {
  const b0 = makeBudget({ year: 2026, total: 120, deptWeights: { 'bu-video': 2, 'bu-ecom': 1, legal: 1 }, projects: { '直播试点': 10 }, at: '2026-01-01T00:00:00Z' });
  it('年度拆到季度 / 部门 / 项目；项目超总额被拒', () => {
    expect(b0.quarters).toEqual([30, 30, 30, 30]);
    expect(b0.depts).toEqual({ 'bu-video': 60, 'bu-ecom': 30, legal: 30 });
    expect(() => makeBudget({ year: 2026, total: 10, deptWeights: { a: 1 }, projects: { x: 11 } })).toThrow(/超过/);
  });
  it('执行率按日折算；偏差 >20% 预警；超支请示给董事长', () => {
    const now = new Date(2026, 10, 15); // Q4 过半
    const ledger = [{ deptId: 'bu-video', yuan: 12, at: new Date(2026, 9, 5).toISOString() }, { deptId: 'bu-ecom', yuan: 2.4, at: new Date(2026, 10, 1).toISOString() }, { deptId: 'legal', yuan: 3.2, at: new Date(2026, 10, 2).toISOString() }];
    const ex = budgetExecution(b0, ledger, now);
    const video = ex.lines.find((l) => l.key === 'dept:bu-video')!;
    expect(video.deviation!).toBeGreaterThan(0.2); expect(video.alert).toBe(true);
    expect(ex.lines.find((l) => l.key === 'dept:legal')!.alert).toBe(false);
    expect(ex.alerts.join()).toMatch(/bu-video 预算偏差 .*超支须走请示/);
    expect(overspendAsk(video, '热点追加').to).toBe('chairman');
  });
  it('季度调整须董事会批准；驳回不生效；硬边界理由被拒', () => {
    let b = proposeAdjust(b0, { quarter: 4, dept: 'bu-video', delta: 6, reason: '热点季追加' });
    expect(() => applyAdjust(b, 'adj-1', null)).toThrow(/董事会批准/);
    expect(() => applyAdjust(b, 'adj-1', { id: 'm', decision: 'approved', matter: 'strategy' })).toThrow(/董事会批准/);
    const rej = applyAdjust(b, 'adj-1', { id: 'm1', decision: 'rejected', matter: 'budget_adjust' });
    expect(rej.total).toBe(120); expect(rej.adjustments[0]!.status).toBe('rejected');
    b = applyAdjust(b, 'adj-1', { id: 'm2', decision: 'approved', matter: 'budget_adjust' });
    expect(b.total).toBe(126); expect(b.quarters[3]).toBe(36); expect(b.version).toBe(2);
    expect(() => proposeAdjust(b0, { quarter: 1, dept: 'x', delta: 1, reason: '用于刷量' })).toThrow(/硬边界/);
  });
});

describe('G9 投入产出看板', () => {
  it('花费 / 产出 / 采纳比；没有采纳的排最后', () => {
    const r = roiBoard([{ key: 'a', label: '短视频', spent: 3, outputs: 10, adopted: 6 }, { key: 'b', label: '电商', spent: 1, outputs: 2, adopted: 0 }, { key: 'c', label: '图文', spent: 1, outputs: 5, adopted: 4 }]);
    expect(r.map((x) => x.key)).toEqual(['c', 'a', 'b']);
    expect(r[0]).toMatchObject({ costPerOutput: 0.2, adoptRate: 0.8, costPerAdopted: 0.25 });
    expect(r[2]!.costPerAdopted).toBeNull();
  });
});
