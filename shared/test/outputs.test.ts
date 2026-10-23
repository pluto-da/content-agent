/** C53 / C54：选题符号解码与复盘反证的 Schema 校验（正反样本）+ 带错误修复一次。 */
import { describe, expect, it } from 'vitest';
import { checkTopicSemiotics, checkRevenueReview, runStructured, TOPIC_SEMIOTICS_SCHEMA } from '../src/index.js';

const topic = {
  verdict: 'do', reason: '低门槛、强对比', symbol_decode: [{ signifier: '“下班后 30 分钟”', denotation: '时间段', connotation: '可掌控的小块时间', readings: { target: '想自我提升的上班族', passerby: '普通时间管理', opponent: '又一个鸡汤' }, evidence_level: 'hypothesis' }],
  structure: { main_opposition: '疲惫 / 掌控', difference_vs_existing: '只讲 30 分钟一件事' }, angles: [{ text: '下班后 30 分钟只做一件事', symbols: ['30 分钟'], models: ['M05'], funnel_layer: 'engagement' }],
  revenue_hypothesis: '收藏率高 → 带出效率工具清单的佣金', falsifier: '7 天收藏率低于账号中位数',
};
const review = {
  data_scope: { source: 'user_input', window: '近 7 天', n: 3, caveat: '样本太少；相关≠因果' }, observations: [{ pattern: '短标题收藏更高', refs: ['d1'] }],
  hypotheses: [{ h: '短标题降低理解成本', if_true_expect: '下 3 篇收藏率 ≥ 中位数', evidence_level: 'hypothesis' }],
  falsification: { alternatives: ['那周平台流量整体上涨'], confounders: ['封面也换了'], would_refute: ['长标题对照组收藏更高'], beyond_evidence: '不能说明长期涨粉' },
  next_actions: [{ action: '下 3 篇用短标题', revenue_hypothesis: '收藏 → 关注 → 佣金', control: '同周长标题 1 篇', check_at: '2026-10-30' }],
};
describe('C53 选题输出含符号解码字段（topic-semiotics Schema）', () => {
  it('正样本通过；缺 symbol_decode / readings / falsifier 被拒', () => {
    expect(checkTopicSemiotics(topic)).toEqual([]);
    expect(checkTopicSemiotics({ ...topic, symbol_decode: [] }).map((e) => e.path).join()).toContain('symbol_decode');
    const noReading = { ...topic, symbol_decode: [{ ...topic.symbol_decode[0], readings: { target: 'x', passerby: 'y' } }] };
    expect(checkTopicSemiotics(noReading).map((e) => e.message).join()).toMatch(/opponent/);
    expect(checkTopicSemiotics({ ...topic, falsifier: '' }).length).toBeGreaterThan(0);
  });
  it('缺字段时带错误信息修复一次，仍失败给出错误（失败卡）', async () => {
    let calls = 0;
    const ok = await runStructured(async () => ({ content: JSON.stringify(calls++ ? topic : { ...topic, symbol_decode: [] }) }), [{ role: 'user', content: '选题' }], TOPIC_SEMIOTICS_SCHEMA);
    expect(ok.calls).toBe(2); expect(ok.errors).toEqual([]);
    const bad = await runStructured(async () => ({ content: JSON.stringify({ ...topic, falsifier: '' }) }), [{ role: 'user', content: '选题' }], TOPIC_SEMIOTICS_SCHEMA);
    expect(bad.errors.length).toBeGreaterThan(0);
  });
});
describe('C54 复盘输出含反证（revenue-review v9.2 Schema）', () => {
  it('正样本通过；falsification 三项必须非空、beyond_evidence 必须存在', () => {
    expect(checkRevenueReview(review)).toEqual([]);
    for (const k of ['alternatives', 'confounders', 'would_refute'] as const) expect(checkRevenueReview({ ...review, falsification: { ...review.falsification, [k]: [] } }).length).toBeGreaterThan(0);
    const { beyond_evidence: _b, ...noBeyond } = review.falsification;
    expect(checkRevenueReview({ ...review, falsification: noBeyond }).length).toBeGreaterThan(0);
  });
  it('n<5 必须写“样本太少”；n<10 或无对照必须写“相关≠因果”', () => {
    expect(checkRevenueReview({ ...review, data_scope: { ...review.data_scope, caveat: '相关≠因果' } }).map((e) => e.message).join()).toContain('样本太少');
    expect(checkRevenueReview({ ...review, data_scope: { ...review.data_scope, n: 8, caveat: '注意' } }).map((e) => e.message).join()).toContain('相关≠因果');
    expect(checkRevenueReview({ ...review, data_scope: { ...review.data_scope, n: 20, caveat: '' } })).toEqual([]);
    expect(checkRevenueReview({ ...review, data_scope: { ...review.data_scope, n: 20, caveat: '' }, next_actions: [{ ...review.next_actions[0], control: '无' }] }).length).toBe(1);
  });
});
