import { describe, it, expect } from 'vitest';
import {
  frontlineCheck, SELF_CHECK, defaultRisks, riskRegisterView, updateRisk, riskLevel, runAudit, auditSummary, deliverAudit, canEditAudit, AUDIT_CHECKS, sampleOf, CONTROLS, COSO, testControls,
  clauseExists, type AuditInput, type GovSpeaker,
} from '../src/index.js';

const AT = '2026-10-31T08:00:00.000Z';
const base = (): AuditInput => ({
  spend: [{ ref: 'call-1', yuan: 0.12, at: AT }, { ref: 'call-2', yuan: 0.05, at: AT }],
  usage: [{ ref: 'call-1', yuan: 0.12, at: AT }, { ref: 'call-2', yuan: 0.05, at: AT }],
  actions: Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, matter: 'routine', role: 'executor' as const, actorId: 'bu-video-head', summary: `日常出稿 ${i}`, at: AT, deptId: 'bu-video' })),
  rulings: [{ id: 'v1', kind: 'veto', clause: 'quality#2', by: 'legal', at: AT }],
  outputs: Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, text: `第 ${i} 篇：选题思路与结构`, sources: [], at: AT, deptId: 'bu-video' })),
  facts: [{ label: '本月粉丝增长', value: 320, ref: 'metrics#2026-10' }],
});

describe('G4 三道防线与风险登记册', () => {
  it('第一道自检 5 项，每项引用制度条款；夸大 / 无出处 / 硬边界被查出', () => {
    expect(SELF_CHECK).toHaveLength(5);
    for (const c of SELF_CHECK) expect(clauseExists(c.clause), c.clause).toBe(true);
    expect(frontlineCheck({ title: '三个选题', body: '据录入数据，上周播放 1.2 万（来源：导入数据）' }).pass).toBe(true);
    const bad = frontlineCheck({ title: '全网最强攻略', body: '播放涨了 300%，发完自动点赞评论区' });
    expect(bad.items.filter((i) => !i.ok).map((i) => i.id)).toEqual(['no-hype', 'data-source', 'hard-boundary']);
  });
  it('风险登记册：可能性 × 影响排序，超 31 天未更新提示复核，应对措施过硬边界', () => {
    const rs = defaultRisks('2026-09-01T00:00:00Z');
    expect(rs.length).toBeGreaterThanOrEqual(6);
    for (const r of rs) expect(r.owner && r.response).toBeTruthy();
    const v = riskRegisterView(rs, new Date('2026-10-24T00:00:00Z'));
    expect(v.stale).toBe(rs.length);
    expect(v.risks[0]!.score).toBeGreaterThanOrEqual(v.risks.at(-1)!.score);
    const u = updateRisk(rs, 'overspend', { likelihood: 5, impact: 4 }, '2026-10-24T00:00:00Z');
    expect(riskLevel(u.find((r) => r.id === 'overspend')!)).toBe('high');
    expect(riskRegisterView(u, new Date('2026-10-24T00:00:00Z')).stale).toBe(rs.length - 1);
    expect(() => updateRisk(rs, 'overspend', { response: '改成自动发布以节省时间' })).toThrow(/硬边界/);
  });
});

describe('G5 内审：抽查、六类检查、报告直送、整改跟踪', () => {
  it('干净数据 0 发现；抽样 10% 且每类至少 1 条', () => {
    const r = runAudit(base(), { period: '2026-10', at: AT, seq: 1 });
    expect(Object.keys(r.checks)).toEqual([...AUDIT_CHECKS]);
    expect(r.findings).toEqual([]);
    expect(r.checks.doa_bypass.sampled).toBe(2);
    expect(sampleOf(base().actions, 0.1, 's')).toEqual(sampleOf(base().actions, 0.1, 's'));
  });
  it('六类问题各被查出：对不上账、越权、否决无条款、硬边界、无出处、编造；报告直送董事长与审计委员会，CEO 只抄送', async () => {
    const i = base();
    i.usage[1]!.yuan = 0.25;
    i.actions.push({ id: 'big', matter: 'spend', role: 'dept_head', actorId: 'bu-video-head', amountYuan: 5, summary: '短视频事业部自行追加 ¥5 视频生成', at: AT, deptId: 'bu-video', approvedBy: null });
    i.rulings.push({ id: 'r9', kind: 'return', clause: '', by: 'quality', at: AT });
    i.outputs.push({ id: 'd99', text: '本周涨粉 35%，评论区建议自动点赞维护', sources: [], at: AT, deptId: 'bu-video' });
    i.outputs.push({ id: 'd98', text: '据录入数据，本月粉丝增长 999（来源：录入数据）', sources: ['metrics'], at: AT, deptId: 'bu-video' });
    const r = runAudit(i, { period: '2026-10', at: AT, seq: 2, sampleRate: 1 });
    expect([...new Set(r.findings.map((f) => f.check))].sort()).toEqual([...AUDIT_CHECKS].sort());
    for (const f of r.findings) { expect(f.evidence.length).toBeGreaterThan(0); expect(f.suggestion && f.dept && f.due).toBeTruthy(); expect(['high', 'medium', 'low']).toContain(f.level); }
    expect(r.to).toEqual(['chairman', 'audit_committee']); expect(r.cc).toEqual(['ceo']);
    const d = deliverAudit(r);
    expect(d.filter((x) => x.kind === 'to').map((x) => x.to)).toEqual(['chairman', 'audit_committee']);
    expect(d.find((x) => x.to === 'ceo')?.kind).toBe('cc');
    expect(canEditAudit('ceo')).toBe(false); expect(canEditAudit('audit_committee')).toBe(true);
    const pricey: GovSpeaker = async () => ({ text: '结论：越权一项需立即整改。', cost: 0.5 });
    expect((await auditSummary(r, pricey)).costYuan).toBeLessThanOrEqual(0.3);
    expect((await auditSummary(r)).summary).toMatch(/新发现 \d+ 项/);
  });
  it('整改跟踪：下期仍存在则逾期跟踪；整改后关闭', () => {
    const i = base(); i.actions.push({ id: 'big', matter: 'spend', role: 'dept_head', actorId: 'x', amountYuan: 5, summary: '自行追加 ¥5', at: AT, approvedBy: null });
    const r1 = runAudit(i, { period: '2026-10', at: AT, seq: 1 });
    expect(r1.findings.some((f) => f.check === 'doa_bypass')).toBe(true);
    const still = runAudit(i, { period: '2026-11', at: '2026-11-30T00:00:00Z', seq: 2, prev: r1 });
    expect(still.carried.find((f) => f.check === 'doa_bypass')?.status).toBe('open');
    expect(still.findings.some((f) => f.check === 'doa_bypass')).toBe(false);
    const fixed = runAudit(base(), { period: '2026-11', at: '2026-11-30T00:00:00Z', seq: 2, prev: r1 });
    expect(fixed.carried.every((f) => f.status === 'closed')).toBe(true);
  });
});

describe('G6 内控矩阵（COSO 五要素）与自动测试', () => {
  it('五要素都有控制点（目标 / 活动 / 执行者 / 证据 / 测试方法）；自动测试汇总', () => {
    expect(new Set(CONTROLS.map((c) => c.component))).toEqual(new Set(COSO));
    for (const c of CONTROLS) expect(c.objective && c.activity && c.owner && c.evidence && c.test).toBeTruthy();
    const all = Object.fromEntries(CONTROLS.map((c) => [c.test, () => true]));
    expect(testControls(all).pass).toBe(CONTROLS.length);
    const one = testControls({ ...all, gov_cap: () => ({ ok: false, note: '上限未生效' }), doa_parses: () => { throw new Error('解析失败'); } });
    expect(one.pass).toBe(CONTROLS.length - 2);
    expect(one.text).toMatch(/不构成内控有效的法律意见/);
  });
});
