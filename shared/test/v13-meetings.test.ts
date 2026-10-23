import { describe, it, expect } from 'vitest';
import {
  ROOMS, newMeeting, preDocument, runMeeting, intervene, dueMeetings, meetingReplay, docNo, newDoc, decideDoc, findDoc, DOC_TYPES,
  runDiscussion, mockSpeaker, expressionScore, tagSpeculation, crossExamCoverage, finalizeResolution, PROTOCOL_STEPS, MAX_SPEECH_CHARS, type Speaker, type SpeakReq,
} from '../src/index.js';

const parties = [{ id: 'bu-video-head', name: '短视频事业部' }, { id: 'bu-article-head', name: '图文事业部' }, { id: 'legal-head', name: '法务合规部', blue: true }];

describe('F7 7 个常设会议室', () => {
  it('7 个会议室与默认规程；作战室限时 15 分钟、3 轮、CEO 主持；头脑风暴不批评', () => {
    expect(ROOMS.map((r) => r.name)).toEqual(['战略室', '评审室', '作战室', '红蓝对抗室', '赛马评审室', '复盘室', '头脑风暴室']);
    const war = ROOMS.find((r) => r.id === 'war')!;
    expect([war.timeLimitMin, war.maxRounds, war.host]).toEqual([15, 3, 'ceo']);
    expect(ROOMS.find((r) => r.id === 'retro')!.procedure).toEqual(['目标回顾', '结果对比', '原因分析', '经验沉淀']);
    expect(ROOMS.find((r) => r.id === 'brainstorm')!.criticism).toBe(false);
  });
  it('预约与例会（App 打开时到期执行）、会前文档、白板、主持、纪要（编号 / 参会 / 要点 / 决议 / 待办）、回放', async () => {
    const doc = preDocument({ title: 'Q4 规划', background: '年度目标 10 万粉', question: '主推什么形式', options: ['口播短视频', '图文清单'], data: [] });
    expect(doc).toMatch(/## 背景[\s\S]*## 问题[\s\S]*## 选项[\s\S]*## 数据[\s\S]*待录入/);
    const m = newMeeting({ roomId: 'strategy', title: 'Q4 经管会例会', agenda: '主推形式', participants: parties.map((p) => p.id), preDoc: doc, recurring: 'weekly:1@09:00', id: 'mt1' });
    expect(m.host).toBe('ceo');
    expect(dueMeetings([m], new Date('2026-10-26T09:30:00'))).toHaveLength(1);
    expect(dueMeetings([m], new Date('2026-10-26T09:30:00'), { mt1: '2026-10-26T09:10:00' })).toHaveLength(0);
    const s = newMeeting({ roomId: 'review', title: '稿件评审', agenda: 'x', participants: ['a', 'b'], scheduledAt: '2026-10-24T10:00:00Z' });
    expect(dueMeetings([s], new Date('2026-10-24T11:00:00Z'))).toHaveLength(1);
    const done = await runMeeting(m, mockSpeaker, { names: Object.fromEntries(parties.map((p) => [p.id, p.name])), seq: 1, year: 2026 });
    expect(done.status).toBe('closed');
    expect(done.minutes!.no).toBe('集团〔2026〕001号');
    expect(done.minutes!.participants).toHaveLength(3);
    expect(done.minutes!.resolution).toMatch(/决议/);
    expect(done.minutes!.todos[0]).toMatchObject({ owner: expect.any(String), due: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(done.whiteboard.claims.length).toBeGreaterThan(0);
    expect(done.whiteboard.consensus.length).toBeGreaterThan(0);
    expect(meetingReplay(done)[0]!.edges.some((e) => e.kind === 'question')).toBe(true);
  });
  it('旁听与介入：董事长发言最高优先（下一轮所有人可见）、改议题、叫停、直接裁决', async () => {
    let m = newMeeting({ roomId: 'review', title: '选题评审', agenda: '旧议题', participants: parties.map((p) => p.id) });
    m = intervene(m, 'speak', '请把预算压到一半');
    m = intervene(m, 'agenda', '新议题：只评前两个选题');
    m = intervene(m, 'rule', '决议：选第一个选题，周三由我本人发布');
    const seen: string[][] = [];
    const spy: Speaker = async (r) => { seen.push(r.chairmanNotes); return mockSpeaker(r); };
    const done = await runMeeting(m, spy);
    expect(seen.some((n) => n.includes('请把预算压到一半'))).toBe(true);
    expect(done.agenda).toMatch(/新议题/);
    expect(done.record!.resolution!.kind).toBe('chairman');
    expect(done.minutes!.resolution).toMatch(/第一个选题/);
    const stopped = intervene(newMeeting({ roomId: 'war', title: '热点', agenda: 'x', participants: ['a', 'b'] }), 'stop', '叫停');
    expect((await runMeeting(stopped, mockSpeaker)).status).toBe('stopped');
  });
  it('公文：7 类、编号集团〔年份〕NNN号、请示只由董事长批准、按编号检索', () => {
    expect(DOC_TYPES).toEqual(['请示', '报告', '通知', '纪要', '提案', '决议', '简报']);
    let { list, doc } = newDoc([], { type: '请示', title: '追加配音预算', body: '¥1', from: 'ceo', year: 2026 });
    expect(doc.no).toBe('集团〔2026〕001号');
    expect(doc.status).toBe('pending');
    expect(() => decideDoc(list, doc.id, 'ceo', true)).toThrow(/董事长/);
    list = decideDoc(list, doc.id, 'chairman', true);
    expect(list[0]!.status).toBe('approved');
    expect(findDoc(list, '001')).toHaveLength(1);
    expect(docNo(2026, 12)).toBe('集团〔2026〕012号');
    expect(() => newDoc([], { type: '报告', title: 'x', body: 'sk-abcdefghijklmnopqrstuvwx', from: 'a' })).toThrow(/Key/);
  });
});

describe('F8 讨论协议六步', () => {
  it('六步齐全；独立陈述互不可见', async () => {
    expect(PROTOCOL_STEPS).toEqual(['召集', '独立陈述', '质询与回应', '修正与综合', '决议', '纪要与待办']);
    const reqs: SpeakReq[] = [];
    const rec = await runDiscussion({ topic: '主推形式', doc: '会前文档', parties }, async (r) => { reqs.push(r); return mockSpeaker(r); });
    const ind = reqs.filter((r) => r.phase === 'independent');
    expect(ind).toHaveLength(3);
    expect(ind.every((r) => r.visible.length === 0)).toBe(true);
    expect(rec.speeches.filter((s) => s.phase === 'independent').every((s) => s.visible.length === 0)).toBe(true);
    expect(rec.synthesis!.consensus.length).toBeGreaterThan(0);
    expect(rec.resolution!.text).toMatch(/决议/);
    expect(reqs.filter((r) => r.phase === 'synthesis' || r.phase === 'resolution').every((r) => r.tier === 'main')).toBe(true);
    expect(reqs.filter((r) => ['independent', 'question', 'answer', 'revise'].includes(r.phase)).every((r) => r.tier === 'cheap')).toBe(true);
  });
  it('质询覆盖率 100%：每方至少对另一方提出一个具体质疑，蓝军质疑所有人，被质询方逐条回应', async () => {
    const rec = await runDiscussion({ topic: '主推形式', doc: 'd', parties, maxRounds: 1 }, mockSpeaker);
    expect(crossExamCoverage(rec)).toBe(1);
    expect(rec.speeches.filter((s) => s.phase === 'question' && s.from === 'legal-head')).toHaveLength(2);
    expect(rec.speeches.filter((s) => s.phase === 'answer').length).toBe(rec.speeches.filter((s) => s.phase === 'question').length);
  });
  it('防空转：单人单轮 ≤300 字、重复发言被拦截、分歧为零提前结束、无来源数据标推测、费用上限停止', async () => {
    const long: Speaker = async (r) => (r.phase === 'independent' ? { text: `结论：${'很长'.repeat(400)}`, cost: 0 } : mockSpeaker(r));
    const a = await runDiscussion({ topic: 't', doc: 'd', parties: parties.slice(0, 2), maxRounds: 1 }, long);
    expect(a.speeches.every((s) => s.text.length <= MAX_SPEECH_CHARS + 6)).toBe(true);
    expect(a.speeches.some((s) => s.flags.includes('truncated'))).toBe(true);
    const parrot: Speaker = async (r) => (r.phase === 'question' || r.phase === 'answer' ? { text: '我认为方案一更好因为完播率高但风险是样本少', cost: 0 } : mockSpeaker(r));
    const b = await runDiscussion({ topic: 't', doc: 'd', parties, maxRounds: 1 }, parrot);
    expect(b.blocked.some((x) => x.reason === 'duplicate')).toBe(true);
    const agree: Speaker = async (r) => (r.phase === 'question' ? { text: `请${r.target?.name}补充执行时间表，第 ${r.round} 轮（${r.party.id}）`, cost: 0 } : mockSpeaker(r));
    const c = await runDiscussion({ topic: 't', doc: 'd', parties, maxRounds: 3 }, agree);
    expect([c.stopReason, c.stoppedEarly, c.rounds]).toEqual(['no_disagreement', true, 1]);
    expect(tagSpeculation('完播率提升 30%').speculative).toBe(true);
    expect(tagSpeculation('完播率提升 30%（来源：我的 CSV 导出）').speculative).toBe(false);
    const pricey: Speaker = async (r) => ({ ...(await mockSpeaker(r)), cost: 0.2 });
    const d = await runDiscussion({ topic: 't', doc: 'd', parties, budgetYuan: 0.5 }, pricey);
    expect(d.stopReason).toBe('budget');
  });
  it('表达规范打分：结论先行、不堆砌、不包装；低分要求重写一次', async () => {
    expect(expressionScore('结论：主推口播。因为完播率更稳。').score).toBe(100);
    const bad = expressionScore('我们需要打通全链路闭环，赋能抓手，形成组合拳，这是史无前例的颠覆性打法，会让大家都觉得很有意思的那种。');
    expect(bad.score).toBeLessThan(60);
    let rewrites = 0;
    const sloppy: Speaker = async (r) => { if (r.rewrite) { rewrites++; return { text: '结论：先做两期小样，因为成本可控。', cost: 0 }; } return r.phase === 'question' ? { text: `关于${r.target?.name}，我们需要打通闭环赋能抓手，形成组合拳，风险是颠覆性不够极其可惜`, cost: 0 } : mockSpeaker(r); };
    const rec = await runDiscussion({ topic: 't', doc: 'd', parties, maxRounds: 1 }, sloppy);
    expect(rewrites).toBeGreaterThan(0);
    expect(rec.speeches.filter((s) => s.phase === 'question').every((s) => s.flags.includes('rewritten'))).toBe(true);
  });
});

describe('F11 否决须引用条款', () => {
  it('否决未引用有效条款即报错；引用有效条款通过；硬边界决议被拒', () => {
    expect(() => finalizeResolution({ kind: 'ruling', text: '否决', vetoes: [{ by: 'legal', clause: '', ok: false }] })).toThrow(/条款/);
    expect(finalizeResolution({ kind: 'ruling', text: '否决第二篇', vetoes: [{ by: 'legal', clause: 'charter#5', ok: false }] }).vetoes[0]!.ok).toBe(true);
    expect(finalizeResolution({ kind: 'vote', text: '决议：每天自动发布三条', vetoes: [] }).rejected).toMatch(/硬边界/);
  });
});
