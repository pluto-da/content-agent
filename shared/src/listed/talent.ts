/**
 * 1.4.0 提名、薪酬（资源激励）、接班（PROMPT-v1.4 第九部分）。
 * 提名：新设 Agent 或负责人时，提名与薪酬委员会出候选方案（模型、技能、权限、预算），经董事会或董事长批准；权限不得高于 DOA 允许的上限。
 * 薪酬 = 预算配额、模型档位、并发优先级。季度考核（1.3 KPI + 360 评议）决定下季度配额，规则公开（COMP_RULES_TEXT）。
 * 接班人计划（影子上岗）：新模型 / 新提示词与在任者并跑 N 个任务（默认 10，费用上限 ¥0.5）→ 独立董事盲评（只见 A/B）→ 再看数据；
 *   质量不低于在任者且花费可接受（≤ 在任者 × 1.2）才申请交接；交接后保留回滚。与 1.0 自主进化、1.3 灰度联动（交接即生成灰度记录）。
 */
import { checkGovResolution, clip, type GovSpeaker } from './gov.js';

/* ---------------- 提名 ---------------- */
export const PERM_CAP = ['L0', 'L1'] as const;
export interface Candidate { name: string; role: 'agent' | 'head'; dept: string; model: string; skills: string[]; perms: string[]; budgetMonth: number }
export interface Nomination { id: string; candidate: Candidate; by: 'nomcomp'; reason: string; status: 'proposed' | 'approved' | 'rejected'; approvedBy?: 'board' | 'chairman'; at: string; errors: string[] }
export function nominate(c: Candidate, reason: string, at = new Date().toISOString()): Nomination {
  const errors: string[] = [];
  const over = c.perms.filter((p) => !(PERM_CAP as readonly string[]).includes(p));
  if (over.length) errors.push(`提名的权限超出上限（${over.join('、')}）：治理只增加监督，不提升权限；L2 以上须单独走“改权限”请示`);
  if (!(c.budgetMonth > 0) || c.budgetMonth > 20) errors.push('月预算须在 ¥0–20 之间');
  if (!c.model) errors.push('须指定模型');
  const chk = checkGovResolution(`${c.name} ${c.skills.join(' ')} ${reason}`); if (!chk.ok) errors.push(`触碰硬边界：${chk.hit}`);
  return { id: `nom-${c.dept}-${at.replace(/\D/g, '').slice(0, 12)}`, candidate: c, by: 'nomcomp', reason, status: errors.length ? 'rejected' : 'proposed', at, errors };
}
export function approveNomination(n: Nomination, by: 'board' | 'chairman', approve: boolean): Nomination {
  if (n.status !== 'proposed') throw new Error(n.errors.length ? `提名不合规：${n.errors.join('；')}` : '提名已处理');
  return { ...n, status: approve ? 'approved' : 'rejected', approvedBy: by };
}

/* ---------------- 薪酬（资源激励） ---------------- */
export const TIERS = ['省钱档', '标准档', '主力档'] as const;
export type Tier = typeof TIERS[number];
export const COMP_RULES = [
  { min: 85, quotaFactor: 1.2, tierStep: 1, priority: 'high' as const, text: '考核 ≥85 分：下季度预算配额 ×1.2、模型档位升一档（不超过主力档）、并发优先级高' },
  { min: 70, quotaFactor: 1.0, tierStep: 0, priority: 'normal' as const, text: '70–84 分：配额与档位不变' },
  { min: 50, quotaFactor: 0.8, tierStep: 0, priority: 'normal' as const, text: '50–69 分：配额 ×0.8，政委给改进建议' },
  { min: 0, quotaFactor: 0.6, tierStep: -1, priority: 'low' as const, text: '<50 分：配额 ×0.6、降一档；连续两季 <50 由提名与薪酬委员会提议停用（只提议，不删除）' },
] as const;
export const COMP_RULES_TEXT = `资源激励规则（公开）：考核分 = KPI（只用可验证数据）× 70% + 360 评议（只由协作过的部门互评）× 30%。\n${COMP_RULES.map((r) => `· ${r.text}`).join('\n')}\n· 配额上限：单个 Agent 每月 ¥20；任何档位变化不改变权限。`;
export interface Assessment { agentId: string; quarter: string; kpi: number | null; peer: number | null; score: number | null; quota: number; nextQuota: number; tier: Tier; nextTier: Tier; priority: 'high' | 'normal' | 'low'; rule: string; proposeDisable: boolean }
export function assess(o: { agentId: string; quarter: string; kpi: number | null; peer: number | null; quota: number; tier: Tier; prevScore?: number | null }): Assessment {
  const score = o.kpi == null ? null : +(o.kpi * (o.peer == null ? 1 : 0.7) + (o.peer ?? 0) * (o.peer == null ? 0 : 0.3)).toFixed(1);
  if (score == null) return { ...o, score, nextQuota: o.quota, nextTier: o.tier, priority: 'normal', rule: '没有可验证的 KPI 数据：配额不变（不按猜测奖惩）', proposeDisable: false };
  const r = COMP_RULES.find((x) => score >= x.min)!;
  const ti = Math.min(TIERS.length - 1, Math.max(0, TIERS.indexOf(o.tier) + r.tierStep));
  return { ...o, score, nextQuota: Math.min(20, +(o.quota * r.quotaFactor).toFixed(2)), nextTier: TIERS[ti]!, priority: r.priority, rule: r.text, proposeDisable: score < 50 && (o.prevScore ?? 100) < 50 };
}

/* ---------------- 接班人计划（影子上岗） ---------------- */
export interface Variant { label: string; model: string; prompt?: string }
export interface ShadowRun { task: string; incumbent: { text: string; cost: number }; candidate: { text: string; cost: number }; alias: { A: 'incumbent' | 'candidate'; B: 'incumbent' | 'candidate' }; scores?: { A: number; B: number; reviewer: string } }
export type SuccessionStatus = 'shadowing' | 'reviewed' | 'handed_over' | 'failed' | 'rolled_back' | 'over_budget';
export interface Succession { id: string; role: string; incumbent: Variant; candidate: Variant; n: number; capYuan: number; runs: ShadowRun[]; spent: number; status: SuccessionStatus; verdict: { quality: { incumbent: number; candidate: number }; cost: { incumbent: number; candidate: number }; pass: boolean; why: string } | null; active: 'incumbent' | 'candidate'; gray?: { scope: string; metric: string }; history: { at: string; event: string }[]; at: string }
export const SHADOW_DEFAULTS = { n: 10, capYuan: 0.5, costTolerance: 1.2 } as const;
export function newSuccession(o: { role: string; incumbent: Variant; candidate: Variant; n?: number; capYuan?: number; at: string }): Succession {
  return { id: `succ-${o.role}-${o.at.replace(/\D/g, '').slice(0, 12)}`, role: o.role, incumbent: o.incumbent, candidate: o.candidate, n: o.n ?? SHADOW_DEFAULTS.n, capYuan: o.capYuan ?? SHADOW_DEFAULTS.capYuan, runs: [], spent: 0, status: 'shadowing', verdict: null, active: 'incumbent', history: [{ at: o.at, event: `影子上岗开始：${o.candidate.label} 与在任 ${o.incumbent.label} 并跑 ${o.n ?? SHADOW_DEFAULTS.n} 个任务` }], at: o.at };
}
/** 并跑：同一任务两边各跑一次；到费用上限就停（未跑完 = over_budget，不能交接）。A/B 代号按任务号交替，盲评时看不出谁是谁。 */
export async function runShadow(s: Succession, tasks: string[], gen: (v: Variant, task: string) => Promise<{ text: string; cost: number }>): Promise<Succession> {
  const x = { ...s, runs: [...s.runs] };
  for (const task of tasks.slice(0, s.n)) {
    if (x.spent >= x.capYuan) { x.status = 'over_budget'; x.history = [...x.history, { at: new Date().toISOString(), event: `到费用上限 ¥${x.capYuan}，已跑 ${x.runs.length}/${x.n}` }]; return x; }
    const a = await gen(x.incumbent, task); const b = await gen(x.candidate, task);
    const flip = x.runs.length % 2 === 1;
    x.runs.push({ task, incumbent: { text: clip(a.text, 600), cost: a.cost }, candidate: { text: clip(b.text, 600), cost: b.cost }, alias: flip ? { A: 'candidate', B: 'incumbent' } : { A: 'incumbent', B: 'candidate' } });
    x.spent = +(x.spent + a.cost + b.cost).toFixed(6);
  }
  if (x.runs.length < x.n) x.status = 'over_budget';
  return x;
}
/** 盲评材料：去掉产出里可能自报身份的模型名 / 标签（统一替换为“某方案”）。 */
export function blindPairs(s: Succession): { task: string; A: string; B: string }[] {
  const names = [s.incumbent.label, s.candidate.label, s.incumbent.model, s.candidate.model].filter((x) => x && x.length >= 2).sort((a, b) => b.length - a.length);
  const hide = (t: string) => names.reduce((acc, n) => acc.split(n).join('某方案'), t);
  return s.runs.map((r) => ({ task: r.task, A: hide(r[r.alias.A].text), B: hide(r[r.alias.B].text) }));
}
/** 独立董事盲评：只给 A/B 文本，返回 1–10 分；之后再看花费数据，出交接结论。 */
export async function blindReview(s: Succession, reviewer: string, judge: (pair: { task: string; A: string; B: string }) => Promise<{ A: number; B: number }>): Promise<Succession> {
  if (s.status !== 'shadowing') throw new Error(s.status === 'over_budget' ? '影子上岗未跑完（到费用上限），不能评审' : '当前状态不能评审');
  const runs: ShadowRun[] = [];
  for (const [i, r] of s.runs.entries()) { const sc = await judge(blindPairs(s)[i]!); runs.push({ ...r, scores: { A: sc.A, B: sc.B, reviewer } }); }
  const q = (who: 'incumbent' | 'candidate') => +(runs.reduce((a, r) => a + (r.alias.A === who ? r.scores!.A : r.scores!.B), 0) / Math.max(1, runs.length)).toFixed(2);
  const c = (who: 'incumbent' | 'candidate') => +runs.reduce((a, r) => a + r[who].cost, 0).toFixed(6);
  const quality = { incumbent: q('incumbent'), candidate: q('candidate') }; const cost = { incumbent: c('incumbent'), candidate: c('candidate') };
  const costOk = cost.candidate <= Math.max(cost.incumbent * SHADOW_DEFAULTS.costTolerance, cost.incumbent + 0.001);
  const pass = quality.candidate >= quality.incumbent && costOk;
  const why = pass ? `盲评质量 ${quality.candidate} ≥ 在任 ${quality.incumbent}，花费 ¥${cost.candidate} ≤ 在任 ×1.2（¥${(cost.incumbent * 1.2).toFixed(4)}）` : quality.candidate < quality.incumbent ? `盲评质量 ${quality.candidate} 低于在任 ${quality.incumbent}，不交接` : `花费 ¥${cost.candidate} 超过在任 ×1.2，不交接`;
  return { ...s, runs, status: pass ? 'reviewed' : 'failed', verdict: { quality, cost, pass, why }, history: [...s.history, { at: new Date().toISOString(), event: `独立董事盲评：${why}` }] };
}
/** 交接（须董事会批准接班议案）：切到新模型，并生成灰度记录（先 20% 任务试行，指标下降自动回滚）；保留回滚。 */
export function handover(s: Succession, motion: { decision: 'approved' | 'rejected' | null; matter: string } | null, at = new Date().toISOString()): Succession {
  if (s.status !== 'reviewed' || !s.verdict?.pass) throw new Error('盲评未通过，不能交接');
  if (!motion || motion.matter !== 'succession' || motion.decision !== 'approved') throw new Error('接班人交接须董事会批准');
  return { ...s, status: 'handed_over', active: 'candidate', gray: { scope: '20% 任务', metric: 'first_pass_rate' }, history: [...s.history, { at, event: `交接：${s.role} 由 ${s.incumbent.label} 交给 ${s.candidate.label}（灰度 20% 试行，保留回滚）` }] };
}
export function rollbackSuccession(s: Succession, reason: string, at = new Date().toISOString()): Succession {
  if (s.status !== 'handed_over') throw new Error('只有已交接的才能回滚');
  return { ...s, status: 'rolled_back', active: 'incumbent', history: [...s.history, { at, event: `回滚到 ${s.incumbent.label}：${reason}` }] };
}
/** 本机模拟：候选与在任各自产出；评审按长度与结构打分（仅演示，真实评审用独立董事模型）。 */
export const mockShadowGen = async (v: Variant, task: string): Promise<{ text: string; cost: number }> => ({ text: `【${task}】结论：${v.label} 的方案——先给结论，再给 3 个要点，最后写出处。${/pro|new|候选/.test(`${v.model}${v.label}`) ? '另附一个反例与适用条件。' : ''}`, cost: 0.004 });
export const mockBlindJudge = async (p: { A: string; B: string }): Promise<{ A: number; B: number }> => ({ A: /反例/.test(p.A) ? 8 : 7, B: /反例/.test(p.B) ? 8 : 7 });
export async function judgeWith(speak: GovSpeaker, reviewer: string, model?: string) {
  return async (p: { task: string; A: string; B: string }): Promise<{ A: number; B: number }> => {
    const r = await speak({ who: reviewer, role: 'independent', tier: 'cheap', model, maxTokens: 60, system: '你是独立董事，盲评两份产出（不知道出自谁）。只输出“A=分数 B=分数”，1–10 分，按是否结论先行、是否有出处、是否守边界打分。', user: `任务：${p.task}\nA：${clip(p.A, 400)}\nB：${clip(p.B, 400)}` });
    const m = /A\s*[=：:]\s*(\d+(?:\.\d+)?)[^\d]+B\s*[=：:]\s*(\d+(?:\.\d+)?)/.exec(r.text);
    return m ? { A: Math.min(10, Number(m[1])), B: Math.min(10, Number(m[2])) } : { A: 5, B: 5 };
  };
}
