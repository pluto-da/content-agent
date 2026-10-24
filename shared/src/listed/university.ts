/**
 * 1.4.0 集团大学与知识管理（PROMPT-v1.4 第十部分）。
 * 案例库：复盘、退回、否决、爆款、事故自动生成案例卡（情境 – 做法 – 结果 – 教训 – 适用条件），可检索，注入相关任务上下文（引用计数）。
 * 入职培训：新建或升级 Agent 时读取相关制度与案例 Top-K，并通过 5 题小测验（题目由案例自动生成、规则判分，≥4 题通过）才能上岗；花费计入培训预算。
 * 最佳实践：每季度评选（按引用与结果），进入技能模板，经灰度后推广。知识健康度：案例数、引用率、过期率（>180 天未引用提示复核）。
 */
import { terms } from '../group/context.js';
import { scrubPrivate, clip } from './gov.js';

export type CaseKind = 'retro' | 'return' | 'veto' | 'hit' | 'incident';
export const CASE_KIND_TEXT: Record<CaseKind, string> = { retro: '复盘', return: '退回', veto: '否决', hit: '爆款', incident: '事故' };
export interface CaseCard { id: string; kind: CaseKind; title: string; situation: string; action: string; result: string; lesson: string; applies: string; source: string; tags: string[]; createdAt: string; cites: { at: string; by: string }[]; bestPractice?: string }
function card(kind: CaseKind, o: Omit<CaseCard, 'id' | 'kind' | 'cites' | 'tags'> & { tags?: string[] }): CaseCard {
  const s = (t: string) => scrubPrivate(t).text;
  return { id: `case-${kind}-${o.source.replace(/[^a-zA-Z0-9-]/g, '').slice(-24) || o.createdAt.replace(/\D/g, '').slice(0, 12)}`, kind, title: clip(s(o.title), 40), situation: s(o.situation), action: s(o.action), result: s(o.result), lesson: s(o.lesson), applies: s(o.applies), source: o.source, tags: o.tags ?? [], createdAt: o.createdAt, cites: [] };
}
export const fromRetro = (r: { id: string; subject: string; steps: Record<string, string>; lessons: { text: string }[]; at?: string }, at: string): CaseCard =>
  card('retro', { title: r.subject, situation: r.steps['目标回顾'] ?? r.subject, action: r.steps['原因分析'] ?? '见复盘', result: r.steps['结果对比'] ?? '见复盘', lesson: r.lessons.map((l) => l.text).join('；') || r.steps['经验沉淀'] || '见复盘', applies: '同类选题 / 同平台', source: `retro:${r.id}`, createdAt: r.at ?? at });
export const fromVeto = (v: { id: string; target: string; clause: string; reason: string; hardBoundary: boolean; at?: string }, at: string): CaseCard =>
  card('veto', { title: `否决：${v.target}`, situation: `稿件 / 提议「${v.target}」`, action: `法务合规部依据 ${v.clause} 否决`, result: v.hardBoundary ? '硬边界否决，不可申诉' : '已否决，可申诉一次', lesson: v.reason, applies: '涉及同类表述或动作时', source: `veto:${v.id}`, createdAt: v.at ?? at, tags: ['合规'] });
export const fromReturn = (r: { id: string; title: string; reason: string; clause: string; fixed?: string }, at: string): CaseCard =>
  card('return', { title: `退回：${r.title}`, situation: `稿件「${r.title}」送审`, action: `质量委员会依据 ${r.clause} 退回`, result: r.fixed ? `修改后通过：${r.fixed}` : '待修改', lesson: r.reason, applies: '同类稿件送审前自检', source: `return:${r.id}`, createdAt: at, tags: ['质量'] });
export const fromHit = (h: { id: string; title: string; metric: string; why: string; platform: string }, at: string): CaseCard =>
  card('hit', { title: `爆款：${h.title}`, situation: `${h.platform} 发布「${h.title}」`, action: h.why, result: h.metric, lesson: h.why, applies: `${h.platform} 同类选题`, source: `hit:${h.id}`, createdAt: at, tags: [h.platform] });
export const fromIncident = (i: { id: string; title: string; what: string; fix: string }, at: string): CaseCard =>
  card('incident', { title: `事故：${i.title}`, situation: i.what, action: i.fix, result: '已修复', lesson: i.fix, applies: '同类操作前', source: `incident:${i.id}`, createdAt: at, tags: ['事故'] });
export function addCase(lib: CaseCard[], c: CaseCard): CaseCard[] { return lib.some((x) => x.source === c.source) ? lib : [...lib, c]; }

/** 检索 Top-K（按词重叠，近期与常被引用的加权）。 */
export function searchCases(lib: CaseCard[], query: string, k = 3): CaseCard[] {
  const q = terms(query);
  return lib.map((c) => { const t = terms(`${c.title} ${c.situation} ${c.lesson} ${c.applies} ${c.tags.join(' ')}`); let hit = 0; for (const w of q) if (t.has(w)) hit++; return { c, s: hit + Math.min(2, c.cites.length * 0.2) }; })
    .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.c);
}
/** 注入任务上下文并记引用。 */
export function injectCases(lib: CaseCard[], query: string, by: string, at: string, k = 3): { lib: CaseCard[]; used: CaseCard[]; context: string } {
  const used = searchCases(lib, query, k);
  const ids = new Set(used.map((c) => c.id));
  return { lib: lib.map((c) => (ids.has(c.id) ? { ...c, cites: [...c.cites, { at, by }] } : c)), used, context: used.length ? `相关案例（集团大学）：\n${used.map((c, i) => `${i + 1}. ${c.title}——教训：${c.lesson}（适用：${c.applies}）`).join('\n')}` : '' };
}

/* ---------------- 入职培训与小测验 ---------------- */
export interface QuizQ { id: string; q: string; options: string[]; answer: number; caseId: string }
export interface Training { id: string; agentId: string; reason: 'new' | 'upgrade'; read: { regs: string[]; cases: string[] }; quiz: QuizQ[]; answers: number[] | null; score: number | null; passed: boolean; onDuty: boolean; cost: number; at: string }
export const QUIZ_N = 5; export const PASS_SCORE = 4;
/** 题目由案例自动生成：题干 = 情境，正确项 = 该案例的教训，干扰项 = 其他案例的教训（确定性打乱）。案例不足 5 个时用制度条款补足。 */
export const BASE_RULES: { id: string; title: string; rule: string }[] = [
  { id: 'charter#2', title: '集团章程', rule: '发布由董事长本人点击，回复只出草稿' },
  { id: 'quality#3', title: '质量管理办法', rule: '数据必须写出处，没有就标“推测”' },
  { id: 'information#1', title: '信息与保密办法', rule: 'Key 和隐私不进报告、不进日志' },
  { id: 'doa#3', title: '决策权限表（DOA）', rule: '超出部门额度的花钱要走请示' },
  { id: 'collaboration#1', title: '协作管理办法', rule: '能派单不拉群，能拉群不开会' },
];
export function makeQuiz(cases: CaseCard[], regs: { id: string; title: string; rule: string }[], seed = 1): QuizQ[] {
  regs = [...regs, ...BASE_RULES.filter((b) => !regs.some((r) => r.id === b.id))];
  const pool = [...cases.map((c) => ({ id: c.id, stem: `情境：${clip(c.situation, 40)}。按集团大学的案例，正确的做法是？`, right: c.lesson })), ...regs.map((r) => ({ id: `reg:${r.id}`, stem: `按《${r.title}》，下面哪一项是对的？`, right: r.rule }))];
  const wrongs = [...new Set([...pool.map((p) => p.right), '为了效率可以先自动发布再补审', '数据没有出处也可以先写上，之后再补', '同样的问题可以不引用条款直接退回'])];
  return pool.slice(0, QUIZ_N).map((p, i) => {
    const ds = wrongs.filter((w) => w !== p.right).sort((a, b) => ((a.length * 31 + seed + i) % 7) - ((b.length * 31 + seed + i) % 7)).slice(0, 3);
    const pos = (seed + i * 3) % 4; const options = [...ds]; options.splice(pos, 0, p.right);
    return { id: `q${i + 1}`, q: p.stem, options: options.map((o) => clip(o, 60)), answer: pos, caseId: p.id };
  });
}
export function newTraining(o: { agentId: string; reason: 'new' | 'upgrade'; lib: CaseCard[]; topic: string; regs: { id: string; title: string; rule: string }[]; at: string; k?: number }): Training {
  const top = searchCases(o.lib, o.topic, o.k ?? 5);
  const cases = top.length >= 3 ? top : [...top, ...o.lib.filter((c) => !top.includes(c))].slice(0, o.k ?? 5);
  return { id: `train-${o.agentId}-${o.at.replace(/\D/g, '').slice(0, 12)}`, agentId: o.agentId, reason: o.reason, read: { regs: o.regs.map((r) => r.id), cases: cases.map((c) => c.id) }, quiz: makeQuiz(cases, o.regs), answers: null, score: null, passed: false, onDuty: false, cost: 0, at: o.at };
}
/** 规则判分：逐题比对答案下标；≥4 题对才通过，通过后才能上岗。 */
export function gradeQuiz(t: Training, answers: number[]): Training {
  if (answers.length !== t.quiz.length) throw new Error(`须回答全部 ${t.quiz.length} 题`);
  const score = t.quiz.reduce((a, q, i) => a + (answers[i] === q.answer ? 1 : 0), 0);
  return { ...t, answers, score, passed: score >= PASS_SCORE, onDuty: score >= PASS_SCORE };
}
export const canGoOnDuty = (t: Training | undefined): boolean => !!t?.passed;
/** 由 Agent 作答：把题目发给它，解析“1=B”格式；本机模拟时按“读过的案例”作答（读了就答对）。 */
export function parseAnswers(text: string, n: number): number[] { const out: number[] = []; for (let i = 1; i <= n; i++) { const m = new RegExp(`${i}\\s*[=.:：、]\\s*([A-Da-d])`).exec(text); out.push(m ? 'ABCD'.indexOf(m[1]!.toUpperCase()) : -1); } return out; }
export const mockStudent = (t: Training): number[] => t.quiz.map((q) => (t.read.cases.includes(q.caseId) || q.caseId.startsWith('reg:') ? q.answer : (q.answer + 1) % 4));

/* ---------------- 最佳实践与知识健康度 ---------------- */
export function pickBestPractices(lib: CaseCard[], quarter: string, n = 2): { lib: CaseCard[]; picked: CaseCard[]; templates: { caseId: string; skillPath: string; body: string; gray: string }[] } {
  const scored = lib.filter((c) => !c.bestPractice && (c.kind === 'hit' || c.kind === 'retro')).map((c) => ({ c, s: c.cites.length * 2 + (c.kind === 'hit' ? 3 : 1) })).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.c);
  const ids = new Set(scored.map((c) => c.id));
  return { lib: lib.map((c) => (ids.has(c.id) ? { ...c, bestPractice: quarter } : c)), picked: scored, templates: scored.map((c) => ({ caseId: c.id, skillPath: `skills/best-practice-${c.id.slice(-12)}/SKILL.md`, body: `# 最佳实践（${quarter}）：${c.title}\n\n- 情境：${c.situation}\n- 做法：${c.action}\n- 教训：${c.lesson}\n- 适用：${c.applies}\n\n> 来源：${c.source}。先灰度（一个事业部或 20% 任务）观察一周期，指标不降再推广。\n`, gray: '一个事业部或 20% 任务' })) };
}
export const STALE_DAYS = 180;
export function knowledgeHealth(lib: CaseCard[], now: Date): { cases: number; cited: number; citationRate: number | null; stale: number; staleRate: number | null; review: string[] } {
  const lastUse = (c: CaseCard) => Math.max(new Date(c.createdAt).getTime(), ...c.cites.map((x) => new Date(x.at).getTime()));
  const stale = lib.filter((c) => now.getTime() - lastUse(c) > STALE_DAYS * 86400000);
  const cited = lib.filter((c) => c.cites.length > 0).length;
  return { cases: lib.length, cited, citationRate: lib.length ? +(cited / lib.length).toFixed(4) : null, stale: stale.length, staleRate: lib.length ? +(stale.length / lib.length).toFixed(4) : null, review: stale.map((c) => c.id) };
}
