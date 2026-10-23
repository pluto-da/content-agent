import { describe, it, expect } from 'vitest';
import { canStartRace, newRace, runRace, blindCards, scoreBlind, leaderboard, predictFromHistory, decideRace, archivedAssets, raceEffect, DEFAULT_RACE_BUDGET, newGray, inGray, observe, evaluateGray, type GrayTarget } from '../src/index.js';

const horses = [{ id: 'h1', agentId: 'bu-video-head' }, { id: 'h2', agentId: 'bu-article-head', model: 'mimo-v2.5' }, { id: 'h3', agentId: 'staff-head', skill: 'hook' }];
const ANG: Record<string, string> = { h1: '悬念开场', h2: '清单盘点', h3: '反差对比' };
const gen = async (h: { id: string }, topic: string) => ({ text: `${topic}：${ANG[h.id]}，口播前三秒给结论`, cost: 0.05 });

describe('F9 赛马', () => {
  it('融合规则：只对高价值且方向不确定的任务开；≤3 匹；单次与月度专项预算', () => {
    expect(canStartRace({ highValue: true, uncertain: false, horses: 2, monthSpent: 0, requestYuan: 0.1 }).ok).toBe(false);
    expect(canStartRace({ highValue: true, uncertain: true, horses: 4, monthSpent: 0, requestYuan: 0.1 }).ok).toBe(false);
    expect(canStartRace({ highValue: true, uncertain: true, horses: 3, monthSpent: 0, requestYuan: 0.7 }).reason).toMatch(/单次/);
    expect(canStartRace({ highValue: true, uncertain: true, horses: 3, monthSpent: 2.9, requestYuan: 0.3 }).reason).toMatch(/月度/);
    expect(canStartRace({ highValue: true, uncertain: true, horses: 3, monthSpent: 0, requestYuan: 0.3 }).ok).toBe(true);
    expect(DEFAULT_RACE_BUDGET).toEqual({ perRaceYuan: 0.6, monthYuan: 3 });
    expect(() => newRace({ topic: 't', deptId: 'bu-video', horses: [...horses, { id: 'h4', agentId: 'x' }], budgetYuan: 0.3 })).toThrow();
  });
  it('赛马预算上限：超出专项预算的马停下，不计入候选', async () => {
    const pricey = async (h: { id: string }) => ({ text: `方案 ${ANG[h.id]}`, cost: h.id === 'h2' ? 0.5 : 0.05 });
    const r = await runRace(newRace({ topic: '切入角度', deptId: 'bu-video', horses, budgetYuan: 0.3 }), pricey);
    expect(r.entries.find((e) => e.horseId === 'h2')!.status).toBe('over_budget');
    expect(r.spent).toBeLessThanOrEqual(0.3);
    expect(blindCards(r)).toHaveLength(2);
  });
  it('3 匹并行 → 盲评（只露代号）→ 数据中心预测（有历史才给）→ 董事长选定 → 落选方案入库 → 效果统计', async () => {
    let r = await runRace(newRace({ topic: '主推视频切入角度', deptId: 'bu-video', horses, budgetYuan: 0.3, id: 'race1' }), gen);
    const cards = blindCards(r);
    expect(cards.map((c) => c.alias).sort()).toEqual(['A', 'B', 'C']);
    expect(JSON.stringify(cards)).not.toMatch(/bu-video-head|mimo|h1|h2|h3/);
    r = scoreBlind(r, 'staff-head', { A: 8, B: 6, C: 7 });
    r = scoreBlind(r, 'data-center-head', { A: 9, B: 5, C: 7 });
    expect(leaderboard(r)[0]!.alias).toBe('A');
    expect(predictFromHistory(r, [])).toBeNull();
    r = { ...r, prediction: predictFromHistory(r, [{ keyword: '口播', metric: 0.42 }]) };
    expect(leaderboard(r)[0]!.predicted).toBe(0.42);
    expect(() => decideRace(r, 'A', 'ceo')).toThrow(/授权/);
    r = decideRace(r, 'A', 'chairman');
    expect(r.archived).toHaveLength(2);
    expect(archivedAssets(r).every((a) => a.tags.includes('落选'))).toBe(true);
    expect(raceEffect([r], [], 0.3).verdict).toMatch(/待录入/);
    expect(raceEffect([r], [{ raceId: 'race1', metric: 0.4 }], 0.3).avgLift).toBeCloseTo(0.333, 2);
  });
});

describe('F10 灰度试行与自动回滚', () => {
  const target: GrayTarget = { kind: 'skill', id: 'skills/douyin/SKILL.md', version: 3, prevVersion: 2 };
  it('20% 任务或一个事业部试行；章程与 DOA 不走灰度', () => {
    const g = newGray({ target, metric: '一次通过率' });
    const hits = Array.from({ length: 1000 }, (_, i) => inGray(g, { id: `task-${i}` })).filter(Boolean).length;
    expect(hits).toBeGreaterThan(120);
    expect(hits).toBeLessThan(280);
    expect(inGray(newGray({ target, metric: 'm', scope: { deptId: 'bu-video' } }), { id: 'x', deptId: 'bu-video' })).toBe(true);
    expect(() => newGray({ target: { kind: 'regulation_low', id: 'doa', version: 2, prevVersion: 1 }, metric: 'm' })).toThrow(/L3/);
  });
  it('灰度回滚：指标下降自动回滚；不降且满一周期全量', async () => {
    let g = newGray({ target, metric: '一次通过率', at: '2026-10-01T00:00:00Z' });
    for (const v of [0.8, 0.82, 0.79]) g = observe(g, v, false);
    for (const v of [0.6, 0.62]) g = observe(g, v, true);
    const rolled: GrayTarget[] = [];
    g = await evaluateGray(g, new Date('2026-10-03T00:00:00Z'), (t) => { rolled.push(t); });
    expect(g.status).toBe('rolled_back');
    expect(rolled[0]!.prevVersion).toBe(2);
    expect(g.reason).toMatch(/自动回滚到 v2/);
    let ok = newGray({ target, metric: 'm', at: '2026-10-01T00:00:00Z' });
    ok = observe(observe(ok, 0.8, false), 0.81, true);
    expect((await evaluateGray(ok, new Date('2026-10-03T00:00:00Z'), () => undefined)).status).toBe('trial');
    expect((await evaluateGray(ok, new Date('2026-10-09T00:00:00Z'), () => undefined)).status).toBe('full');
  });
});
