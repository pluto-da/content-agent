import { describe, it, expect } from 'vitest';
import { BLM_STEPS, newStrategy, toCommittee, toBoard, boardDecision, strategyToOkrs, strategyReview, draftBlm, NO_DATA, type MapRow, type GovSpeaker } from '../src/index.js';

const MAP: MapRow[] = [
  { goal: '一年到 1 万粉', initiative: '口播短视频周更 3 条', dept: 'bu-video', metric: 'followers', target: 8000, unit: '粉', budget: 60 },
  { goal: '一年到 1 万粉', initiative: '图文笔记周更 2 篇', dept: 'bu-note', metric: 'followers', target: 2000, unit: '粉', budget: 20 },
];
const AT = '2026-12-20T00:00:00Z';

describe('G14 战略规划（BLM 八步、战略地图、三情景、拆解为 OKR）', () => {
  it('BLM 八步；空步骤写“无数据”；地图行不完整 / 硬边界被拒', async () => {
    expect(BLM_STEPS.map((s) => s.title)).toEqual(['差距分析', '市场洞察', '战略意图', '创新焦点', '业务设计', '关键任务', '组织与人才', '氛围与文化']);
    const p = newStrategy({ year: 2027, steps: await draftBlm('材料'), map: MAP, at: AT });
    expect(Object.keys(p.steps)).toHaveLength(8);
    expect(newStrategy({ year: 2027, steps: {}, map: MAP, at: AT }).steps.gap).toBe(NO_DATA);
    expect(() => newStrategy({ year: 2027, steps: {}, map: [{ ...MAP[0]!, dept: '' }], at: AT })).toThrow(/不完整/);
    expect(() => newStrategy({ year: 2027, steps: { innovation: '矩阵号批量养号' }, map: MAP, at: AT })).toThrow(/硬边界/);
  });
  it('三情景（乐观 / 基准 / 悲观）带假设与触发信号；参谋部 → 战略委员会 → 董事会；批准后拆成 OKR', () => {
    let p = newStrategy({ year: 2027, steps: {}, map: MAP, at: AT });
    expect(p.scenarios.map((s) => s.id)).toEqual(['optimistic', 'base', 'pessimistic']);
    expect(p.scenarios.map((s) => s.targets[0]!.target)).toEqual([13000, 10000, 6000]);
    expect(p.scenarios.map((s) => s.budget)).toEqual([88, 80, 64]);
    for (const s of p.scenarios) expect(s.assumptions.length && s.trigger).toBeTruthy();
    expect(() => toBoard(p, 'm1')).toThrow(/战略委员会/);
    expect(() => strategyToOkrs(p, '2027Q1')).toThrow(/董事会批准/);
    p = boardDecision(toBoard(toCommittee(p, ''), 'm1'), true, 'base');
    const okrs = strategyToOkrs(p, '2027Q1');
    expect(okrs.filter((o) => o.level === 'year')).toHaveLength(1);
    expect(okrs.filter((o) => o.level === 'dept').map((o) => o.owner)).toEqual(['bu-video', 'bu-note']);
    expect(okrs.find((o) => o.owner === 'bu-video')!.krs[0]).toMatchObject({ target: 2000, current: null });
    expect(okrs.every((o) => o.public)).toBe(true);
  });
  it('半年复盘：假设不成立 → 建议切换情景', () => {
    const p = boardDecision(toBoard(toCommittee(newStrategy({ year: 2027, steps: {}, map: MAP, at: AT }), ''), 'm'), true, 'base');
    const a = p.scenarios.find((s) => s.id === 'base')!.assumptions[0]!;
    const r = strategyReview(p, { [a]: { holds: false, note: '主力平台限流' } }, '2027-06-30T00:00:00Z');
    expect(r.broken).toEqual([a]); expect(r.suggestion).toMatch(/悲观/);
    expect(r.plan.reviews[0]!.holds.filter((h) => h.holds === null).length).toBe(2);
  });
  it('参谋部用模型起草时按“步骤名：内容”解析', async () => {
    const sp: GovSpeaker = async () => ({ text: '差距分析：上季度产出不足\n市场洞察：无数据\n战略意图：一年 1 万粉', cost: 0.001 });
    const d = await draftBlm('x', sp);
    expect(d).toEqual({ gap: '上季度产出不足', insight: '无数据', intent: '一年 1 万粉' });
  });
});
