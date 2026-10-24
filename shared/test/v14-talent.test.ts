import { describe, it, expect } from 'vitest';
import { nominate, approveNomination, COMP_RULES_TEXT, assess, newSuccession, runShadow, blindPairs, blindReview, handover, rollbackSuccession, mockShadowGen, mockBlindJudge, judgeWith, type GovSpeaker } from '../src/index.js';

const AT = '2026-12-01T00:00:00Z';
describe('G15 提名、薪酬（资源激励）规则公开', () => {
  it('提名与薪酬委员会出候选方案（模型 / 技能 / 权限 / 预算），董事会或董事长批准；权限超上限被拒', () => {
    const n = nominate({ name: '直播策划组负责人', role: 'head', dept: 'live', model: 'mimo-v2.6-flash', skills: ['直播脚本'], perms: ['L0', 'L1'], budgetMonth: 5 }, '新设直播策划组', AT);
    expect(n.status).toBe('proposed');
    expect(approveNomination(n, 'chairman', true)).toMatchObject({ status: 'approved', approvedBy: 'chairman' });
    const bad = nominate({ name: 'x', role: 'agent', dept: 'live', model: 'm', skills: [], perms: ['L3'], budgetMonth: 5 }, '', AT);
    expect(bad.status).toBe('rejected'); expect(bad.errors.join()).toMatch(/不提升权限/);
    expect(() => approveNomination(bad, 'board', true)).toThrow(/不合规/);
  });
  it('资源激励规则公开；考核分决定下季度配额 / 档位 / 优先级；无数据不奖惩；连续两季 <50 只提议停用', () => {
    expect(COMP_RULES_TEXT).toMatch(/公开/); expect(COMP_RULES_TEXT).toMatch(/不改变权限/);
    expect(assess({ agentId: 'a', quarter: '2026Q4', kpi: 90, peer: 90, quota: 5, tier: '标准档' })).toMatchObject({ score: 90, nextQuota: 6, nextTier: '主力档', priority: 'high' });
    expect(assess({ agentId: 'a', quarter: '2026Q4', kpi: null, peer: 80, quota: 5, tier: '标准档' })).toMatchObject({ score: null, nextQuota: 5 });
    expect(assess({ agentId: 'a', quarter: '2026Q4', kpi: 30, peer: 40, quota: 5, tier: '省钱档', prevScore: 40 })).toMatchObject({ nextQuota: 3, nextTier: '省钱档', proposeDisable: true });
  });
});

describe('G16 接班人计划：影子上岗、盲评、交接、回滚', () => {
  it('并跑 10 个任务（≤¥0.5）→ 盲评只见 A/B → 达标 → 董事会批准交接（灰度）→ 回滚', async () => {
    let s = newSuccession({ role: '短视频脚本', incumbent: { label: '在任 flash', model: 'mimo-v2.6-flash' }, candidate: { label: '候选 pro', model: 'mimo-v2.6-pro' }, at: AT });
    s = await runShadow(s, Array.from({ length: 12 }, (_, i) => `任务${i + 1}`), mockShadowGen);
    expect(s.runs).toHaveLength(10); expect(s.spent).toBeLessThanOrEqual(0.5);
    const pairs = blindPairs(s);
    expect(JSON.stringify(pairs)).not.toMatch(/incumbent|candidate|在任|候选|mimo-v2/);
    expect(new Set(s.runs.map((r) => r.alias.A)).size).toBe(2);
    s = await blindReview(s, '独立董事 A', mockBlindJudge);
    expect(s.verdict).toMatchObject({ pass: true, quality: { incumbent: 7, candidate: 8 } });
    expect(() => handover(s, { decision: null, matter: 'succession' })).toThrow(/董事会批准/);
    s = handover(s, { decision: 'approved', matter: 'succession' });
    expect(s.active).toBe('candidate'); expect(s.gray?.scope).toBe('20% 任务');
    s = rollbackSuccession(s, '灰度期一次通过率下降');
    expect(s).toMatchObject({ status: 'rolled_back', active: 'incumbent' });
  });
  it('质量低于在任或花费超 1.2 倍不交接；到费用上限未跑完不能评审', async () => {
    let s = newSuccession({ role: 'x', incumbent: { label: 'A', model: 'a' }, candidate: { label: 'B', model: 'b' }, at: AT });
    s = await runShadow(s, Array.from({ length: 10 }, (_, i) => `t${i}`), async (v) => ({ text: v.label, cost: v.model === 'b' ? 0.02 : 0.01 }));
    s = await blindReview(s, 'id', async () => ({ A: 8, B: 8 }));
    expect(s.verdict?.pass).toBe(false); expect(s.verdict?.why).toMatch(/1\.2/);
    expect(() => handover(s, { decision: 'approved', matter: 'succession' })).toThrow(/盲评未通过/);
    let o = newSuccession({ role: 'y', incumbent: { label: 'A', model: 'a' }, candidate: { label: 'B', model: 'b' }, at: AT, capYuan: 0.05 });
    o = await runShadow(o, Array.from({ length: 10 }, (_, i) => `t${i}`), async () => ({ text: 'x', cost: 0.02 }));
    expect(o.status).toBe('over_budget');
    await expect(blindReview(o, 'id', async () => ({ A: 1, B: 1 }))).rejects.toThrow(/费用上限/);
    const sp: GovSpeaker = async () => ({ text: 'A=7 B=9', cost: 0 });
    expect(await (await judgeWith(sp, 'id-1'))({ task: 't', A: 'a', B: 'b' })).toEqual({ A: 7, B: 9 });
  });
});
