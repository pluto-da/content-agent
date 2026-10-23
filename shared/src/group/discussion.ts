/**
 * 1.3.0 结构化讨论协议（第九部分；会议室通用，临时会话可选用）。依据见 refs-v1.3 M1–M3（多 Agent 辩论研究）与 B4（坦诚清晰）。
 * 六步：召集 → 独立陈述（并行、互不可见）→ 质询与回应（每方至少质疑一方；蓝军 / 法务合规部唱反调）→ 修正与综合（秘书）→ 决议 → 纪要与待办。
 * 防空转：单人单轮 ≤300 字、重复发言拦截、分歧为零或一轮无新论据提前结束、数据论点无来源标“推测”、讨论用省钱档 / 综合与决议用主模型。
 * 表达规范：结论先行、坦诚清晰、不堆砌、不包装；检查器打分，低分要求重写一次。
 * 模型无关：发言由注入的 speak() 产生（本机模拟 / 真实服务商），本模块只管规程与约束。
 */
import { similarity, DUP_THRESHOLD } from './sessions.js';
import { clauseExists } from './regulations.js';
import { violatesHardBoundary } from './doa.js';

export type Phase = 'independent' | 'revise' | 'question' | 'answer' | 'synthesis' | 'resolution';
export const PHASE_TEXT: Record<Phase, string> = { independent: '独立陈述', revise: '修正', question: '质询', answer: '回应', synthesis: '综合', resolution: '决议' };
export const PROTOCOL_STEPS = ['召集', '独立陈述', '质询与回应', '修正与综合', '决议', '纪要与待办'] as const;
export interface Party { id: string; name: string; view?: string; blue?: boolean }
export interface Speech { id: string; round: number; phase: Phase; from: string; to?: string; text: string; cost: number; flags: string[]; score: number; visible: string[] }
export interface SpeakReq { party: Party | { id: 'secretary' | 'chair'; name: string }; phase: Phase; round: number; topic: string; doc: string; visible: Speech[]; target?: Party; question?: Speech; tier: 'cheap' | 'main'; rewrite?: string; criticism: boolean; chairmanNotes: string[] }
export type Speaker = (r: SpeakReq) => Promise<{ text: string; cost: number }>;
export interface Synthesis { consensus: string[]; disagreements: string[]; toVerify: string[]; text: string }
export interface Resolution { kind: 'vote' | 'ruling' | 'chairman' | 'none'; text: string; vetoes: { by: string; clause: string; ok: boolean }[]; rejected?: string; ask?: { title: string; body: string } }
export interface DiscussionRecord {
  topic: string; parties: Party[]; maxRounds: number; budgetYuan: number; rounds: number; speeches: Speech[]; blocked: { from: string; reason: string; text: string }[];
  stoppedEarly: boolean; stopReason: 'max_rounds' | 'no_disagreement' | 'no_new_args' | 'budget' | 'chairman_stop' | null; synthesis: Synthesis | null; resolution: Resolution | null; spent: number; coverage: number; todos: { title: string; owner: string; due: string }[];
}
export const MAX_SPEECH_CHARS = 300;
export const DEFAULT_ROUNDS = 3;
export const DEFAULT_MEETING_BUDGET = 0.5;

/* ---------------- 表达规范打分 ---------------- */
const BUZZ = /(赋能|抓手|闭环|打通|颗粒度|底层逻辑|组合拳|心智|链路|对齐一下|拉通|沉淀一下|顶层设计|生态化反)/g;
const HYPE = /(史无前例|颠覆性|极其|非常非常|绝对|百分之百|遥遥领先)/g;
const CONCLUSION = /^(结论|建议|我认为|我建议|应|不应|主张|同意|反对|选|推荐|质疑|问|不同意|支持|赞成|回应|答|是|否|不|可以|需要|决议|综合|共识)/;
export function expressionScore(text: string): { score: number; issues: string[] } {
  const t = text.trim(); const issues: string[] = [];
  let s = 100;
  const first = t.split(/[。！？!?\n；;]/)[0] ?? '';
  if (t.length > 40 && !CONCLUSION.test(first.replace(/^[【\[(（][^】\])）]*[】\])）]\s*/, '').trim())) { s -= 25; issues.push('结论没有先行'); }
  const buzz = t.match(BUZZ)?.length ?? 0; if (buzz) { s -= 10 * buzz; issues.push(`黑话 ${buzz} 处`); }
  const hype = t.match(HYPE)?.length ?? 0; if (hype) { s -= 10 * hype; issues.push(`包装用语 ${hype} 处`); }
  if (t.length > MAX_SPEECH_CHARS) { s -= 20; issues.push('超过 300 字'); }
  if (t.split(/[。！？!?]/).filter((x) => x.trim()).length > 6) { s -= 15; issues.push('堆砌'); }
  return { score: Math.max(0, Math.min(100, s)), issues };
}
export const LOW_SCORE = 60;
/** 数据论点必须带来源，无来源标“推测”。 */
export function tagSpeculation(text: string): { text: string; speculative: boolean } {
  const hasData = /\d+(\.\d+)?\s*(%|％|万|千|倍|个百分点|元|播放|粉|赞)/.test(text);
  const hasSource = /(来源|出处|据|数据来自|source|https?:\/\/|〔\d{4}〕|录入数据|导入数据)/i.test(text);
  return hasData && !hasSource && !/推测/.test(text) ? { text: `${text}（推测）`, speculative: true } : { text, speculative: false };
}
const DISAGREE = /(不同意|反对|质疑|风险|但是|但|然而|问题在于|不成立|不赞成|担心|漏洞|反例|代价)/;

/* ---------------- 规程 ---------------- */
export interface ProtocolInput {
  topic: string; doc: string; parties: Party[]; maxRounds?: number; budgetYuan?: number; criticism?: boolean;
  /** 决议：默认按秘书综合 + 多数；可注入裁决（含否决）。 */
  decide?: (s: Synthesis, rec: DiscussionRecord) => Resolution | Promise<Resolution>;
  /** 董事长介入：每轮开始前读取（插话 / 叫停）。 */
  chairman?: () => { notes: string[]; stop?: boolean };
  dueDays?: number;
}
export async function runDiscussion(input: ProtocolInput, speak: Speaker): Promise<DiscussionRecord> {
  const rec: DiscussionRecord = { topic: input.topic, parties: input.parties, maxRounds: Math.min(5, Math.max(1, input.maxRounds ?? DEFAULT_ROUNDS)), budgetYuan: input.budgetYuan ?? DEFAULT_MEETING_BUDGET, rounds: 0, speeches: [], blocked: [], stoppedEarly: false, stopReason: null, synthesis: null, resolution: null, spent: 0, coverage: 0, todos: [] };
  const criticism = input.criticism !== false;
  let n = 0;
  const over = () => rec.spent >= rec.budgetYuan;
  const say = async (req: Omit<SpeakReq, 'topic' | 'doc' | 'criticism' | 'chairmanNotes'> & { chairmanNotes?: string[] }): Promise<Speech | null> => {
    const full: SpeakReq = { ...req, topic: input.topic, doc: input.doc, criticism, chairmanNotes: req.chairmanNotes ?? [] };
    let out = await speak(full); rec.spent = +(rec.spent + out.cost).toFixed(6);
    const flags: string[] = [];
    let { score, issues } = expressionScore(out.text);
    if (score < LOW_SCORE && !over()) { const again = await speak({ ...full, rewrite: `表达规范得分 ${score}（${issues.join('、')}）：请结论先行、坦诚清晰、不堆砌、不包装，≤300 字重写。` }); rec.spent = +(rec.spent + again.cost).toFixed(6); const s2 = expressionScore(again.text); flags.push('rewritten'); if (s2.score >= score) { out = again; score = s2.score; } }
    let text = out.text.trim();
    if (text.length > MAX_SPEECH_CHARS) { text = text.slice(0, MAX_SPEECH_CHARS); flags.push('truncated'); }
    const prior = rec.speeches.filter((x) => x.phase !== 'synthesis' && x.phase !== 'resolution');
    if (req.party.id !== 'secretary' && req.party.id !== 'chair' && prior.some((x) => similarity(x.text, text) >= DUP_THRESHOLD)) { rec.blocked.push({ from: req.party.id, reason: 'duplicate', text: text.slice(0, 80) }); return null; }
    const sp = tagSpeculation(text); if (sp.speculative) flags.push('speculative');
    const s: Speech = { id: `sp${++n}`, round: req.round, phase: req.phase, from: req.party.id, to: req.target?.id, text: sp.text, cost: out.cost, flags, score, visible: req.visible.map((v) => v.id) };
    rec.speeches.push(s);
    return s;
  };
  for (let r = 1; r <= rec.maxRounds; r++) {
    const ch = input.chairman?.() ?? { notes: [] };
    if (ch.stop) { rec.stoppedEarly = true; rec.stopReason = 'chairman_stop'; break; }
    rec.rounds = r;
    const before = rec.speeches.length;
    // 第 1 轮：独立陈述（并行，互不可见）；之后：修正（看得到全部）
    const snapshot = [...rec.speeches];
    const firstPhase: Phase = r === 1 ? 'independent' : 'revise';
    const stmts = await Promise.all(input.parties.map((p) => speak({ party: p, phase: firstPhase, round: r, topic: input.topic, doc: input.doc, visible: r === 1 ? [] : snapshot, tier: 'cheap', criticism, chairmanNotes: ch.notes }).then((o) => ({ p, o }))));
    for (const { p, o } of stmts) {
      rec.spent = +(rec.spent + o.cost).toFixed(6);
      // 并行结果逐条过约束（独立陈述阶段 visible 必须为空）
      const flags: string[] = []; let text = o.text.trim(); const sc = expressionScore(text);
      if (text.length > MAX_SPEECH_CHARS) { text = text.slice(0, MAX_SPEECH_CHARS); flags.push('truncated'); }
      if (r > 1 && rec.speeches.some((x) => similarity(x.text, text) >= DUP_THRESHOLD)) { rec.blocked.push({ from: p.id, reason: 'duplicate', text: text.slice(0, 80) }); continue; }
      const sp = tagSpeculation(text); if (sp.speculative) flags.push('speculative'); if (sc.score < LOW_SCORE) flags.push('low_score');
      rec.speeches.push({ id: `sp${++n}`, round: r, phase: firstPhase, from: p.id, text: sp.text, cost: o.cost, flags, score: sc.score, visible: r === 1 ? [] : snapshot.map((x) => x.id) });
    }
    if (over()) { rec.stoppedEarly = true; rec.stopReason = 'budget'; break; }
    if (!criticism) { rec.stopReason = 'max_rounds'; break; }
    // 质询：每方至少对另一方提一个具体质疑；蓝军质疑所有人
    const qs: Speech[] = [];
    for (let i = 0; i < input.parties.length; i++) {
      const p = input.parties[i]!;
      const targets = p.blue ? input.parties.filter((x) => x.id !== p.id) : [input.parties[(i + 1) % input.parties.length]!].filter((x) => x.id !== p.id);
      for (const t of targets) { if (over()) break; const s = await say({ party: p, phase: 'question', round: r, visible: [...rec.speeches], target: t, tier: 'cheap', chairmanNotes: ch.notes }); if (s) qs.push(s); }
    }
    // 回应：被质询方逐条回应
    for (const q of qs) { if (over()) break; const t = input.parties.find((x) => x.id === q.to); if (t) await say({ party: t, phase: 'answer', round: r, visible: [...rec.speeches], target: input.parties.find((x) => x.id === q.from), question: q, tier: 'cheap', chairmanNotes: ch.notes }); }
    if (over()) { rec.stoppedEarly = true; rec.stopReason = 'budget'; break; }
    const roundSpeeches = rec.speeches.slice(before);
    if (!roundSpeeches.filter((x) => x.phase === 'question').some((x) => DISAGREE.test(x.text))) { rec.stoppedEarly = r < rec.maxRounds; rec.stopReason = 'no_disagreement'; break; }
    if (r > 1 && roundSpeeches.every((x) => rec.speeches.slice(0, before).some((y) => similarity(x.text, y.text) >= 0.6))) { rec.stoppedEarly = r < rec.maxRounds; rec.stopReason = 'no_new_args'; break; }
    if (r === rec.maxRounds) rec.stopReason = 'max_rounds';
  }
  rec.coverage = crossExamCoverage(rec);
  // 综合（主模型）
  const syn = await speak({ party: { id: 'secretary', name: '秘书' }, phase: 'synthesis', round: rec.rounds, topic: input.topic, doc: input.doc, visible: [...rec.speeches], tier: 'main', criticism, chairmanNotes: [] });
  rec.spent = +(rec.spent + syn.cost).toFixed(6);
  rec.synthesis = parseSynthesis(syn.text);
  rec.speeches.push({ id: `sp${++n}`, round: rec.rounds, phase: 'synthesis', from: 'secretary', text: syn.text.slice(0, 1200), cost: syn.cost, flags: [], score: expressionScore(syn.text).score, visible: rec.speeches.map((x) => x.id) });
  // 决议（主模型 / 注入裁决）
  let res: Resolution;
  if (input.decide) res = await input.decide(rec.synthesis, rec);
  else { const o = await speak({ party: { id: 'chair', name: '主持人' }, phase: 'resolution', round: rec.rounds, topic: input.topic, doc: input.doc, visible: [...rec.speeches], tier: 'main', criticism, chairmanNotes: [] }); rec.spent = +(rec.spent + o.cost).toFixed(6); res = { kind: 'vote', text: o.text.slice(0, 600), vetoes: [] }; }
  rec.resolution = finalizeResolution(res);
  rec.todos = extractTodos(`${rec.synthesis.text}\n${rec.resolution.text}`, input.parties, input.dueDays ?? 7);
  return rec;
}
export function parseSynthesis(text: string): Synthesis {
  const grab = (k: RegExp) => { const m = k.exec(text); return m ? m[1]!.split(/[；;\n]|(?:\d+[.、)])/).map((x) => x.replace(/^[-•·\s]+/, '').trim()).filter((x) => x.length > 1).slice(0, 6) : []; };
  return { consensus: grab(/共识[:：]\s*([^\n]*(?:\n(?![^\n]*(分歧|待验证)[:：])[^\n]+)*)/), disagreements: grab(/分歧[:：]\s*([^\n]*(?:\n(?![^\n]*(共识|待验证)[:：])[^\n]+)*)/), toVerify: grab(/待验证[:：]\s*([^\n]*(?:\n(?![^\n]*(共识|分歧)[:：])[^\n]+)*)/), text: text.slice(0, 1200) };
}
/** 否决必须引用条款；决议触碰硬边界由引擎直接拒绝。 */
export function finalizeResolution(r: Resolution): Resolution {
  const vetoes = r.vetoes.map((v) => ({ ...v, ok: clauseExists(v.clause) }));
  const bad = vetoes.find((v) => !v.ok);
  if (bad) throw new Error(`否决未引用有效条款（${bad.clause || '空'}）：否决必须引用制度条款`);
  const hit = violatesHardBoundary(r.text);
  return hit ? { ...r, vetoes, rejected: `决议触碰硬边界（${hit}），引擎拒绝`, kind: r.kind } : { ...r, vetoes };
}
export function crossExamCoverage(rec: Pick<DiscussionRecord, 'parties' | 'speeches'>): number {
  if (rec.parties.length < 2) return 1;
  const askers = new Set(rec.speeches.filter((s) => s.phase === 'question' && s.to && s.to !== s.from).map((s) => s.from));
  return +(rec.parties.filter((p) => askers.has(p.id)).length / rec.parties.length).toFixed(3);
}
export function extractTodos(text: string, parties: Party[], dueDays: number, now = new Date()): { title: string; owner: string; due: string }[] {
  const due = new Date(now.getTime() + dueDays * 86400000).toISOString().slice(0, 10);
  return [...text.matchAll(/(?:待办|TODO)[:：]\s*([^；;\n。]+)/gi)].map((m) => {
    const t = m[1]!.trim();
    const owner = parties.find((p) => t.includes(p.name) || t.includes(p.id))?.id ?? parties[0]?.id ?? 'ceo';
    return { title: t.slice(0, 80), owner, due };
  }).slice(0, 8);
}
/** 回放：按轮次的质询关系图。 */
export function replayGraph(rec: Pick<DiscussionRecord, 'speeches'>): { round: number; edges: { from: string; to: string; kind: 'question' | 'answer'; id: string }[] }[] {
  const rounds = [...new Set(rec.speeches.map((s) => s.round))].sort((a, b) => a - b);
  return rounds.map((round) => ({ round, edges: rec.speeches.filter((s) => s.round === round && (s.phase === 'question' || s.phase === 'answer') && s.to).map((s) => ({ from: s.from, to: s.to!, kind: s.phase as 'question' | 'answer', id: s.id })) }));
}

/* ---------------- 本机模拟发言（不联网；演示、测试、走查用） ---------------- */
const VIEWS: Record<string, string> = {
  'bu-video': '口播短视频前三秒给结论，完播率更稳', 'bu-article': '图文笔记适合深度清单，收藏率更高', legal: '先过广告法极限用语与 AIGC 标识', 'data-center': '按录入数据看，样本还少，需要两周验证',
  finance: '本月预算已用一半，优先低成本方案', staff: '与年度目标一致的方向优先', 'bu-ecom': '带货要先有信任内容', 'bu-intl': '海外平台先做本地化标题', red: '方案一：主推口播切入', blue: '蓝军：方案一的风险是同质化',
};
const ASK = ['你的方案风险在于缺少来源，请给出可验证数据或说明如何验证？', '但如果预算只剩一半，这个方案的代价谁来承担？', '反例：上月同类内容掉粉，你怎么解释？', '担心执行周期太长，能否两周内看到结果？'];
const ANS = ['同意补数据，来源是“我的 CSV 导出”，两周不达标就回退原方案。', '代价可控：只用省钱档模型，单篇成本低于一角，超了就停。', '上月掉粉是因为发布时间错开了黄金档，本次已调整。', '可以，先做两期小样，第二周看完播率。'];
const REV = ['在原方案上加一条：先做两期小样再放量。', '接受质询，把预算上限写进方案。', '补充验证口径：以完播率和收藏率为准。', '把发布时间固定在数据最好的时段。'];
export const mockSpeaker: Speaker = async (r) => {
  const pid = r.party.id.replace(/-head$/, '');
  const view = (r.party as Party).view ?? VIEWS[pid] ?? `${r.party.name}视角`;
  const note = r.chairmanNotes.length ? `（已收到董事长意见：${r.chairmanNotes.at(-1)}）` : '';
  const tv = r.target ? (r.target.view ?? VIEWS[r.target.id.replace(/-head$/, '')] ?? r.target.name) : '';
  const k = (r.round - 1 + pid.length + (r.target?.id.length ?? 0)) % 4;
  switch (r.phase) {
    case 'independent': return { text: `我建议${view}。依据：录入数据显示近两周同类内容表现更好；风险是样本少。${note}`, cost: 0.0004 };
    case 'revise': return { text: `修正（${r.party.name}）：${REV[(r.round + pid.length) % 4]}${note}`, cost: 0.0004 };
    case 'question': return r.criticism ? { text: `质疑${r.target?.name ?? ''}：针对“${tv}”，${ASK[k]}`, cost: 0.0003 } : { text: `补充${r.target?.name ?? ''}的想法：可以再加一个变体。`, cost: 0.0003 };
    case 'answer': return { text: `回应${r.target?.name ?? ''}：坚持“${view}”，${ANS[k]}`, cost: 0.0003 };
    case 'synthesis': return { text: `共识：${r.topic}按录入数据小步验证；各方同意先做两周\n分歧：主推形式（口播 vs 图文）\n待验证：两周后完播率与收藏率\n待办：数据中心两周后出复盘`, cost: 0.001 };
    default: return { text: `决议：${r.topic}——先按共识试行两周，由董事长确认后执行；对外发布由你本人完成。待办：数据中心两周后出复盘`, cost: 0.001 };
  }
};
