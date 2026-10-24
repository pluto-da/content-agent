import { describe, it, expect } from 'vitest';
import { fromRetro, fromVeto, fromReturn, fromHit, fromIncident, addCase, searchCases, injectCases, makeQuiz, newTraining, gradeQuiz, canGoOnDuty, parseAnswers, mockStudent, pickBestPractices, knowledgeHealth, QUIZ_N, type CaseCard } from '../src/index.js';

const AT = '2026-10-01T00:00:00Z';
const lib0 = (): CaseCard[] => {
  let lib: CaseCard[] = [];
  lib = addCase(lib, fromRetro({ id: 'r1', subject: 'Q3 口播复盘', steps: { 目标回顾: '口播短视频周更 3 条', 结果对比: '完成 2 条', 原因分析: '选题储备不足', 经验沉淀: '每周一储备 5 个选题' }, lessons: [{ text: '每周一先储备 5 个选题' }] }, AT));
  lib = addCase(lib, fromVeto({ id: 'v1', target: '“全网最低价”标题', clause: 'quality#2', reason: '绝对化用语违反广告规范', hardBoundary: false }, AT));
  lib = addCase(lib, fromReturn({ id: 't1', title: '护肤测评', reason: '数据无出处，补来源后再送审', clause: 'quality#3', fixed: '补了来源' }, AT));
  lib = addCase(lib, fromHit({ id: 'h1', title: '3 秒钩子口播', metric: '播放 5 万（录入数据）', why: '开头先给结论，3 秒内出现钩子', platform: '抖音' }, AT));
  lib = addCase(lib, fromIncident({ id: 'i1', title: '备份含 Key', what: '导出前未扫描', fix: '导出前强制密钥扫描' }, AT));
  return lib;
};

describe('G17 集团大学：案例库、入职培训测验、最佳实践、知识健康度', () => {
  it('五种来源自动生成案例卡（情境 – 做法 – 结果 – 教训 – 适用条件），去重，去隐私', () => {
    const lib = lib0();
    expect(lib.map((c) => c.kind)).toEqual(['retro', 'veto', 'return', 'hit', 'incident']);
    for (const c of lib) expect(c.situation && c.action && c.result && c.lesson && c.applies).toBeTruthy();
    expect(addCase(lib, fromHit({ id: 'h1', title: 'x', metric: '', why: '', platform: '' }, AT))).toHaveLength(5);
    expect(fromIncident({ id: 'i2', title: 't', what: '电话 13812345678', fix: 'x' }, AT).situation).not.toMatch(/13812345678/);
  });
  it('检索 Top-K 并注入上下文，引用被计数', () => {
    const r = injectCases(lib0(), '抖音口播开头怎么写', 'bu-video-head', '2026-10-20T00:00:00Z', 2);
    expect(r.used[0]!.kind).toBe('hit');
    expect(r.context).toMatch(/相关案例（集团大学）/);
    expect(r.lib.find((c) => c.id === r.used[0]!.id)!.cites).toHaveLength(1);
    expect(searchCases(lib0(), '完全无关的量子力学')).toEqual([]);
  });
  it('入职培训：读制度与案例 Top-K → 5 题（由案例生成）→ 规则判分 ≥4 通过 → 上岗；答错不能上岗', () => {
    const t = newTraining({ agentId: 'live-head', reason: 'new', lib: lib0(), topic: '直播 口播 标题 数据出处', regs: [{ id: 'quality#2', title: '质量管理办法', rule: '不得使用绝对化用语' }], at: AT });
    expect(t.quiz).toHaveLength(QUIZ_N);
    for (const q of t.quiz) { expect(q.options).toHaveLength(4); expect(new Set(q.options).size).toBe(4); expect(q.answer).toBeGreaterThanOrEqual(0); }
    expect(canGoOnDuty(undefined)).toBe(false);
    const pass = gradeQuiz(t, mockStudent(t));
    expect(pass).toMatchObject({ score: 5, passed: true, onDuty: true });
    const wrong = gradeQuiz(t, t.quiz.map((q, i) => (i < 2 ? (q.answer + 1) % 4 : q.answer)));
    expect(wrong).toMatchObject({ score: 3, passed: false, onDuty: false });
    expect(() => gradeQuiz(t, [0])).toThrow(/全部 5 题/);
    expect(parseAnswers('1=B 2：a 3.C 4、D 5=x', 5)).toEqual([1, 0, 2, 3, -1]);
    expect(makeQuiz([], [{ id: 'a#1', title: 'A', rule: 'r1' }]).length).toBe(5);
  });
  it('最佳实践每季度评选进入技能模板（先灰度）；知识健康度：引用率、>180 天未引用提示复核', () => {
    let lib = injectCases(lib0(), '口播 钩子', 'x', '2026-10-20T00:00:00Z').lib;
    const bp = pickBestPractices(lib, '2026Q4');
    expect(bp.picked[0]!.kind).toBe('hit');
    expect(bp.templates[0]!.skillPath).toMatch(/^skills\/best-practice-.*\/SKILL\.md$/);
    expect(bp.templates[0]!.body).toMatch(/先灰度/);
    lib = bp.lib;
    const h = knowledgeHealth(lib, new Date('2027-04-10T00:00:00Z'));
    expect(h.cases).toBe(5); expect(h.citationRate).toBeGreaterThan(0);
    expect(h.stale).toBe(5 - h.cited);
    expect(knowledgeHealth([], new Date()).citationRate).toBeNull();
  });
});
