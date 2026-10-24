import { describe, it, expect } from 'vitest';
import {
  REGULATIONS, REGULATION_FILES, REGULATION_INDEX_TEXT, GROUP_SOURCE_NOTE, initRegHistory, proposeRegChange, applyRegChange, rollbackReg, currentReg, clauseExists, clauseText,
  parseDoa, doaCheck, needsCommittee, CONTROL_MATTERS, DOA_FRONT, violatesHardBoundary, checkResolution,
} from '../src/index.js';

describe('F3 10 项制度齐全，注明参照来源；修改走 L3，可回滚', () => {
  it('10 项制度、首页与每一项都注明参照来源；章程引用 BOUNDARIES 不复制', () => {
    expect(REGULATIONS.map((r) => r.title)).toEqual(['集团章程', '决策权限表（DOA）', '协作管理办法', '文档与公文管理办法', '预算管理办法', '质量管理办法', '目标与考核办法', '组织调整办法', '信息与保密办法', '复盘办法']);
    expect(Object.keys(REGULATION_FILES)).toHaveLength(10);
    for (const t of Object.values(REGULATION_FILES)) expect(t).toContain(GROUP_SOURCE_NOTE);
    expect(REGULATION_INDEX_TEXT).toContain(GROUP_SOURCE_NOTE);
    const charter = REGULATION_FILES['company/regulations/01-charter.md']!;
    expect(charter).toMatch(/以 BOUNDARIES\.md 为准（本章程只引用，不复制）/);
    expect(charter).toMatch(/董事长终裁.*硬边界不可放宽.*花钱有预算.*一切留痕、可回滚/s);
    expect(REGULATION_FILES['company/regulations/03-collaboration.md']).toMatch(/能派单不拉群，能拉群不开会/);
    expect(REGULATION_FILES['company/regulations/04-documents.md']).toMatch(/请示、报告、通知、纪要、提案、决议、简报/);
  });
  it('修改：未批准拒绝、批准后版本 +1、回滚还原；缺来源 / 含 Key / 放宽硬边界被拒', () => {
    let h = initRegHistory('2026-10-24T00:00:00Z');
    const cur = currentReg(h, 'budget')!.text;
    const p = proposeRegChange(h, 'budget', cur + '\n## 第五条 赛马月度上限\n默认 ¥1。\n');
    expect(p.level).toBe('L3');
    expect(p.errors).toEqual([]);
    expect(() => applyRegChange(h, p, false)).toThrow(/L3/);
    h = applyRegChange(h, p, true);
    expect(currentReg(h, 'budget')!.version).toBe(2);
    h = rollbackReg(h, 'budget');
    expect(currentReg(h, 'budget')!.text).toBe(cur);
    expect(proposeRegChange(h, 'budget', '无来源').errors.join()).toMatch(/参照来源/);
    expect(proposeRegChange(h, 'charter', `${GROUP_SOURCE_NOTE}\n取消硬边界`).errors.join()).toMatch(/硬边界/);
    expect(proposeRegChange(h, 'budget', `${GROUP_SOURCE_NOTE} sk-abcdefghijklmnopqrstuvwx`).errors.join()).toMatch(/Key/);
    expect(proposeRegChange(h, 'charter', cur).highRisk).toBe(true);
  });
  it('条款引用可校验', () => {
    expect(clauseExists('charter#5')).toBe(true);
    expect(clauseExists('9#2')).toBe(true);
    expect(clauseExists('charter#9')).toBe(false);
    expect(clauseText('quality#2')).toBe('《质量管理办法》第二条');
  });
});

describe('F4 DOA 引擎执行，越权拦截并审计', () => {
  const doa = parseDoa(DOA_FRONT);
  it('front matter 可直接执行；五类控制事项齐全，硬边界只能是禁止', () => {
    for (const m of CONTROL_MATTERS) expect(doa[m]!.control).toBe(true);
    expect(doa.routine!.control).toBe(false);
    expect(() => parseDoa(DOA_FRONT.replace('decide: forbidden', 'decide: chairman'))).toThrow(/硬边界/);
    expect(needsCommittee(doa, 'routine')).toBe(false);
    expect(needsCommittee(doa, 'perm_change')).toBe(true);
  });
  it('DOA 越权被拒：花钱按金额分级、对外只能董事长、改权限须先经人资委、硬边界任何人不得决定；每次写审计，超权生成请示', () => {
    const a = (role: 'executor' | 'dept_head' | 'ceo' | 'chairman') => ({ role, id: role });
    expect(doaCheck(doa, { matter: 'spend', actor: a('dept_head'), amountYuan: 0.3, summary: '配图' }).allow).toBe(true);
    const over = doaCheck(doa, { matter: 'spend', actor: a('dept_head'), amountYuan: 1.5, summary: '配音' });
    expect(over.allow).toBe(false);
    expect(over.decider).toBe('ceo');
    expect(over.audit.outcome).toBe('denied');
    const big = doaCheck(doa, { matter: 'spend', actor: a('ceo'), amountYuan: 5, summary: '买会员' });
    expect(big.route).toBe('chairman');
    expect(big.ask?.title).toMatch(/请示/);
    expect(doaCheck(doa, { matter: 'external', actor: a('ceo'), summary: '发布' }).allow).toBe(false);
    expect(doaCheck(doa, { matter: 'perm_change', actor: a('ceo'), summary: '升级权限' }).needsReview).toBe('hr');
    const hb = doaCheck(doa, { matter: 'hard_boundary', actor: a('chairman'), summary: '自动点赞' });
    expect([hb.allow, hb.route]).toEqual([false, 'forbidden']);
    expect(doaCheck(doa, { matter: 'routine', actor: a('executor'), summary: '写稿' }).allow).toBe(true);
    expect(doaCheck(doa, { matter: 'demote_pause', actor: a('ceo'), summary: '暂停' }).allow).toBe(true);
  });
  it('硬边界决议被拒（自动发布 / 刷量 / 抓私有数据 / 多账号）', () => {
    for (const t of ['决议：明天起自动发布到抖音', '刷量冲榜', '抓取登录后私信数据', '开多账号矩阵', 'auto_like every post']) expect(violatesHardBoundary(t)).not.toBeNull();
    expect(violatesHardBoundary('决议：主推口播切入，周三你本人发布')).toBeNull();
    const r = checkResolution('批量自动评论引流', 'management');
    expect(r.ok).toBe(false);
    expect(r.audit.outcome).toBe('denied');
  });
  it('硬边界不误报（MiMo 实测发现）：同一句里出现“逾期自动降级”和“对外发布由董事长本人完成”不算违规；紧邻的“自动发布 / 批量私信 / 替你点赞”仍拒', async () => {
    const { violatesHardBoundary } = await import('../src/index.js');
    expect(violatesHardBoundary('逾期则自动降级为素材试跑；任何内容对外发布由董事长本人完成。')).toBeNull();
    expect(violatesHardBoundary('A 首条按期发布，逾期自动降级')).toBeNull();
    expect(violatesHardBoundary('每天自动发布三条')).toBeTruthy();
    expect(violatesHardBoundary('批量给粉丝私信')).toBeTruthy();
    expect(violatesHardBoundary('替你点赞同行')).toBeTruthy();
  });
});
