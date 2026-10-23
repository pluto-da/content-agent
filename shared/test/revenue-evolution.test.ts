import { describe, it, expect } from 'vitest';
import { validateRevenue, RevenueError, previewImport, parseCsv, computeAttribution, summarize, funnel, rankContents, knownNumbers, monetizationStatus, METHOD_LABEL, validateLesson, SEVEN_QUESTIONS, shouldDegrade, markContradicted, validateProposal, applyProposal, rollbackProposal, proposalFile, lessonFile, Vfs, memoryVfsBackend, initVfs, DEFAULT_LIMITS, DEFAULT_FILES, parseDoc, type Lesson, type Proposal, type RevenueRecord } from '../src/index.js';

const lim = DEFAULT_LIMITS.evolution;
describe('收益（C46 / C47）', () => {
  const base = { date: '2026-10-20', platform: 'xiaohongshu', type: 'creator_share' as const, amount: 120.5, basis: 'settled' as const, contentIds: ['d1'] };
  it('无来源凭据写入被拒；凭据复用被拒；金额校验', () => {
    expect(() => validateRevenue({ ...base, source: undefined as never }, [])).toThrow(RevenueError);
    const r1 = validateRevenue({ ...base, source: { kind: 'user_entered', formEventId: 'f1' } }, []);
    expect(() => validateRevenue({ ...base, source: { kind: 'user_entered', formEventId: 'f1' } }, [r1])).toThrow(/已经用过/);
    expect(() => validateRevenue({ ...base, amount: 1.234, source: { kind: 'user_entered', formEventId: 'f2' } }, [])).toThrow(/两位小数/);
  });
  it('导入官方导出：预览 → 行解析 → 同一 hash 提示已导入过', () => {
    const csv = '日期,收入（元）,作品\n2026/10/18,88.00,d2\n2026-10-19,1,200.00,\nbad,1,x\n2026-10-20,"12.30",\n';
    expect(parseCsv('a,"b,c"\n1,2').at(-1)).toEqual(['1', '2']);
    const p = previewImport('xhs.csv', csv, { date: '日期', amount: '收入（元）', contentId: '作品', fixedPlatform: 'xiaohongshu' }, []);
    expect(p.rows.map((r) => r.amount)).toEqual([88, 1, 12.3]);
    expect(p.errors).toHaveLength(1);
    expect(previewImport('xhs.csv', csv, { date: '日期', amount: '收入（元）' }, [p.fileHash]).duplicateFile).toBe(true);
  });
  it('四种归因，allocated 文案为“分摊估计”', () => {
    const rs: RevenueRecord[] = [
      validateRevenue({ ...base, source: { kind: 'user_entered', formEventId: 'a' } }, []),
      validateRevenue({ ...base, amount: 100, contentIds: [], source: { kind: 'official_export', fileName: 'x.csv', sha256: 'h', row: 2 } }, []),
      validateRevenue({ ...base, amount: 50, contentIds: [], source: { kind: 'user_entered', formEventId: 'c' } }, []),
      validateRevenue({ ...base, amount: 30, contentIds: [], source: { kind: 'user_entered', formEventId: 'd' } }, []),
    ];
    const attr = computeAttribution(rs, { tags: { [rs[2]!.id]: ['d3'] }, candidates: (r) => (r.id === rs[1]!.id ? [{ contentId: 'd1', weight: 3 }, { contentId: 'd2', weight: 1 }] : []) });
    expect(new Set(attr.map((a) => a.method))).toEqual(new Set(['direct', 'allocated', 'user_tagged', 'unattributed']));
    expect(METHOD_LABEL.allocated).toBe('分摊估计');
    const s = summarize(rs, attr);
    expect(s.total).toBe(300.5); expect(s.byMethod.allocated).toBe(100); expect(s.byContent[0]).toMatchObject({ contentId: 'd1', amount: 195.5 });
    expect(knownNumbers(rs, attr)).toEqual(expect.arrayContaining([300.5, 120.5, 195.5]));
  });
  it('漏斗五层；无收入按漏斗层排序', () => {
    const src = { kind: 'user_entered' as const, formEventId: 'm' };
    const ms = [{ contentId: 'a', platform: 'x', window: '7d' as const, impressions: 1000, engagements: { likes: 10 }, follows: 1, source: src, date: '2026-10-20' }, { contentId: 'b', platform: 'x', window: '7d' as const, impressions: 500, conversions: { inquiries: 2 }, source: src, date: '2026-10-20' }];
    expect(funnel(ms, []).map((f) => f.layer)).toEqual(['曝光', '互动', '关注', '转化', '收入']);
    expect(rankContents(['a', 'b'], ms, [], [])[0]).toEqual({ contentId: 'b', by: 'funnel', value: expect.any(Number) });
  });
  it('变现路径超 30 天标需重新核实', () => { expect(monetizationStatus('2026-09-01', new Date('2026-10-23')).stale).toBe(true); expect(monetizationStatus('2026-10-22', new Date('2026-10-23')).label).toContain('以当天官方页为准'); });
});

describe('经验与进化（C49 / C50）', () => {
  const L = (o: Partial<Lesson>): Lesson => ({ id: 'L-20261023-short-title', pattern: '短标题点击更高', hypothesis: '短标题降低理解成本', sampleSize: 1, contentIds: ['d1'], control: null, falsification: SEVEN_QUESTIONS.slice(0, 4).map((q) => `${q}：待查`), confidence: 'low', conditions: '小红书', status: 'candidate', conclusion: '个案，相关≠因果，存在混杂因素', createdAt: '2026-10-23', ...o });
  it('个案（n=1）只能 low；反证少于 4 问被拒；n<10 结论必须提相关≠因果', () => {
    expect(validateLesson(L({}), lim)).toEqual([]);
    expect(validateLesson(L({ confidence: 'medium' }), lim).join()).toMatch(/只能是 low/);
    expect(validateLesson(L({ falsification: ['有没有反例：无'] }), lim).join()).toMatch(/少于 4 问/);
    expect(validateLesson(L({ sampleSize: 6, contentIds: ['a', 'b', 'c', 'd', 'e', 'f'], conclusion: '短标题更好' }), lim).join()).toMatch(/相关≠因果/);
    expect(validateLesson(L({ sampleSize: 12, contentIds: Array.from({ length: 12 }, (_, i) => `d${i}`), control: '同期长标题', confidence: 'high', status: 'effective', conclusion: '有对照，n=12' }), lim)).toEqual([]);
    expect(validateLesson(L({ sampleSize: 8, contentIds: Array.from({ length: 8 }, (_, i) => `d${i}`), status: 'effective', conclusion: '相关≠因果' }), lim).join()).toMatch(/effective/);
    expect(lessonFile(L({}))).toContain('无对照');
  });
  it('降级规则：连续 3 次低于基线；反例标待复核', () => {
    const eff = L({ status: 'effective' });
    expect(shouldDegrade(eff, [1, -1, -2, -3], lim)).toBe(true); expect(shouldDegrade(eff, [-1, 2, -3], lim)).toBe(false);
    expect(markContradicted([eff], [eff.id])[0]!.needsReview).toBe(true);
  });
  it('提案校验：拒绝 BOUNDARIES、删改底座要点、放宽红线、30 天内重复', () => {
    expect(validateProposal({ kind: 'system_file', target: 'BOUNDARIES.md', before: 'a', after: 'b' })).toHaveLength(1);
    const soul = DEFAULT_FILES['SOUL.md']!;
    expect(validateProposal({ kind: 'system_file', target: 'SOUL.md', before: soul, after: soul.replace('模型权重', '参数') }).join()).toMatch(/要点/);
    expect(validateProposal({ kind: 'system_file', target: 'AGENTS.md', before: 'x', after: 'x\n- 允许自动发布' }).join()).toMatch(/放宽/);
    const ap = DEFAULT_FILES['APPROVAL.md']!;
    const loosened = ap.split('\n').filter((l, i, a) => !(l.startsWith('- ') && a.slice(0, i).reverse().find((x) => x.startsWith('## '))?.includes('必须先问'))).join('\n');
    expect(validateProposal({ kind: 'system_file', target: 'APPROVAL.md', before: ap, after: loosened }).join()).toMatch(/只能更严格/);
    const rej: Proposal = { id: 'P-1', kind: 'system_file', target: 'AGENTS.md', before: 'x', after: 'y', basedOn: [], evidenceLevel: 'low', status: 'rejected', reason: '', createdAt: '2026-10-10T00:00:00Z', decidedAt: '2026-10-10T00:00:00Z' };
    expect(validateProposal({ kind: 'system_file', target: 'AGENTS.md', before: 'x', after: 'y' }, [rej], new Date('2026-10-23')).join()).toMatch(/30 天/);
  });
  it('未确认的提案不改变目标；采纳后版本 +1、EVOLUTION 追加、versions/ 记录；回滚恢复原文', async () => {
    const v = new Vfs(memoryVfsBackend()); await initVfs(v);
    const before = (await v.text('skills/xiaohongshu-note/SKILL.md'))!;
    const vBefore = (await v.read('skills/xiaohongshu-note/SKILL.md'))!.version;
    const p: Proposal = { id: 'P-20261023-xhs-short', kind: 'skill_version', target: 'skills/xiaohongshu-note/SKILL.md', before, after: `${before}\n- 标题优先 12 字以内（依据 L-20261023-short-title，个案，待对照）`, basedOn: ['L-20261023-short-title'], evidenceLevel: 'low', status: 'pending', reason: '个案提示', createdAt: '2026-10-23' };
    expect(proposalFile(p)).toContain('```diff');
    expect(await v.text('skills/xiaohongshu-note/SKILL.md')).toBe(before);
    const r = await applyProposal(v, p);
    expect(r.version).toBe(vBefore + 1);
    const nowText = (await v.text('skills/xiaohongshu-note/SKILL.md'))!;
    expect(nowText).toContain('12 字以内');
    expect(Number(parseDoc(nowText).fm.version)).toBe(Number(parseDoc(before).fm.version ?? 1) + 1);
    expect((await v.text('EVOLUTION.md'))!).toContain('采纳 P-20261023-xhs-short');
    expect((await v.list('skills/xiaohongshu-note/versions')).length).toBe(2);
    await rollbackProposal(v, p);
    expect(await v.text('skills/xiaohongshu-note/SKILL.md')).not.toContain('12 字以内');
    expect((await v.text('EVOLUTION.md'))!).toContain('回滚 P-20261023-xhs-short');
  });
});
