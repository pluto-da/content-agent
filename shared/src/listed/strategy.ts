/**
 * 1.4.0 战略管理（PROMPT-v1.4 第八部分；refs-v1.4 I3 BLM 公开资料，偏离见 deviations V14-02）。
 * 年度战略规划：参谋部发起 → 战略委员会审议 → 董事会批准。BLM 八步模板 → 战略地图（目标 → 关键举措 → 负责部门 → 指标 → 预算）
 *   → 三种情景推演（乐观 / 基准 / 悲观，写明假设）→ 战略目标自动拆成 1.3 的 OKR。半年一次战略复盘：对照战略地图检查假设是否仍然成立。
 * 市场洞察只用公开来源与用户录入数据；没有数据就写“无数据”。
 */
import type { Objective } from '../group/context.js';
import { checkGovResolution, NO_DATA, clip, type GovSpeaker } from './gov.js';

export const BLM_STEPS = [
  { id: 'gap', title: '差距分析', ask: '去年 / 上期的目标和结果差在哪？（业绩差距 + 机会差距）' },
  { id: 'insight', title: '市场洞察', ask: '平台、受众、同行、自己发生了什么变化？（只用公开来源与录入数据）' },
  { id: 'intent', title: '战略意图', ask: '一年后集团要成为什么样？可衡量的目标是什么？' },
  { id: 'innovation', title: '创新焦点', ask: '把有限的预算押在哪 1–2 个创新点上？' },
  { id: 'design', title: '业务设计', ask: '为谁做、提供什么价值、靠什么持续？' },
  { id: 'tasks', title: '关键任务', ask: '为实现业务设计必须做的 3–5 件事（有负责部门与时间）' },
  { id: 'org_talent', title: '组织与人才', ask: '需要什么部门、Agent、技能与模型？' },
  { id: 'climate', title: '氛围与文化', ask: '什么做法要鼓励、什么要停止？（价值观：真诚、用户第一、守边界）' },
] as const;
export type BlmStepId = typeof BLM_STEPS[number]['id'];
export interface MapRow { goal: string; initiative: string; dept: string; metric: string; target: number; unit: string; budget: number }
export type ScenarioId = 'optimistic' | 'base' | 'pessimistic';
export const SCENARIO_TEXT: Record<ScenarioId, string> = { optimistic: '乐观', base: '基准', pessimistic: '悲观' };
export interface Scenario { id: ScenarioId; assumptions: string[]; factor: number; budgetFactor: number; targets: { metric: string; target: number; unit: string }[]; budget: number; trigger: string }
export interface StrategyPlan { id: string; year: number; steps: Record<BlmStepId, string>; map: MapRow[]; scenarios: Scenario[]; chosen: ScenarioId | null; status: 'draft' | 'committee' | 'board' | 'approved' | 'rejected'; committeeNote: string; motionId: string | null; okrIds: string[]; reviews: { at: string; holds: { assumption: string; holds: boolean | null; note: string }[] }[]; at: string; sim: boolean }

export function newStrategy(o: { year: number; steps: Partial<Record<BlmStepId, string>>; map: MapRow[]; assumptions?: string[]; at: string; sim?: boolean }): StrategyPlan {
  const steps = Object.fromEntries(BLM_STEPS.map((s) => [s.id, (o.steps[s.id] ?? '').trim() || NO_DATA])) as Record<BlmStepId, string>;
  for (const [k, v] of Object.entries(steps)) { const c = checkGovResolution(v); if (!c.ok) throw new Error(`BLM「${BLM_STEPS.find((s) => s.id === k)!.title}」触碰硬边界：${c.hit}`); }
  if (!o.map.length) throw new Error('战略地图至少一行');
  for (const r of o.map) { if (!r.dept || !r.metric || !(r.target > 0)) throw new Error(`战略地图行不完整：${r.initiative}`); const c = checkGovResolution(`${r.goal} ${r.initiative}`); if (!c.ok) throw new Error(`关键举措触碰硬边界：${c.hit}`); }
  const base = o.assumptions?.length ? o.assumptions : ['平台规则与流量分配大体不变', '模型价格不上涨', '每周能稳定产出'];
  return { id: `strategy-${o.year}`, year: o.year, steps, map: o.map, scenarios: scenarios(o.map, base), chosen: null, status: 'draft', committeeNote: '', motionId: null, okrIds: [], reviews: [], at: o.at, sim: !!o.sim };
}
/** 三种情景：目标 × 系数、预算 × 系数，每种写明假设与触发信号。 */
export function scenarios(map: MapRow[], assumptions: string[]): Scenario[] {
  const metrics = [...new Map(map.map((r) => [`${r.metric}|${r.unit}`, { metric: r.metric, unit: r.unit, target: map.filter((x) => x.metric === r.metric && x.unit === r.unit).reduce((a, x) => a + x.target, 0) }])).values()];
  const budget = map.reduce((a, r) => a + r.budget, 0);
  const mk = (id: ScenarioId, factor: number, budgetFactor: number, extra: string[], trigger: string): Scenario => ({ id, factor, budgetFactor, assumptions: [...assumptions.map((a) => (id === 'base' ? a : id === 'optimistic' ? `${a}，且有利变化` : `${a}不成立`)), ...extra], targets: metrics.map((m) => ({ ...m, target: +(m.target * factor).toFixed(2) })), budget: +(budget * budgetFactor).toFixed(2), trigger });
  return [mk('optimistic', 1.3, 1.1, ['出现 1–2 条爆款带来自然流量'], '连续两个月核心指标超目标 20%'), mk('base', 1, 1, [], '按月度经营分析会跟踪'), mk('pessimistic', 0.6, 0.8, ['平台规则收紧或主力平台限流'], '连续两个月核心指标低于目标 30% 或预算偏差 >20%')];
}
export function toCommittee(p: StrategyPlan, note: string): StrategyPlan { if (p.status !== 'draft') throw new Error('只有草案能提交战略委员会'); return { ...p, status: 'committee', committeeNote: note || '战略委员会已审议，建议提交董事会' }; }
export function toBoard(p: StrategyPlan, motionId: string): StrategyPlan { if (p.status !== 'committee') throw new Error('须先经战略委员会审议'); return { ...p, status: 'board', motionId }; }
export function boardDecision(p: StrategyPlan, approved: boolean, chosen: ScenarioId = 'base'): StrategyPlan { if (p.status !== 'board') throw new Error('须先提交董事会'); return { ...p, status: approved ? 'approved' : 'rejected', chosen: approved ? chosen : null }; }
/** 批准后自动拆成 OKR：每个目标一个年度 O，每行举措 → 负责部门的部门 O（KR = 指标 × 所选情景系数），进度只用录入数据（current = null）。 */
export function strategyToOkrs(p: StrategyPlan, period: string): Objective[] {
  if (p.status !== 'approved' || !p.chosen) throw new Error('战略须经董事会批准后才能拆成 OKR');
  const factor = p.scenarios.find((s) => s.id === p.chosen)!.factor;
  const goals = [...new Set(p.map.map((r) => r.goal))];
  const out: Objective[] = [];
  goals.forEach((g, gi) => {
    const yearId = `okr-s${p.year}-${gi + 1}`;
    const rows = p.map.filter((r) => r.goal === g);
    out.push({ id: yearId, level: 'year', owner: 'chairman', title: g, cycle: 'quarter', period: String(p.year), public: true, krs: rows.map((r, i) => ({ id: `${yearId}-kr${i + 1}`, title: `${r.metric} 达到 ${+(r.target * factor).toFixed(2)}${r.unit}`, metric: r.metric, direction: 'up', target: +(r.target * factor).toFixed(2), unit: r.unit, current: null })) });
    rows.forEach((r, i) => out.push({ id: `${yearId}-${r.dept}-${i + 1}`, level: 'dept', owner: r.dept, parent: yearId, title: `${r.initiative}（${SCENARIO_TEXT[p.chosen!]}情景）`, cycle: 'quarter', period, public: true, krs: [{ id: `${yearId}-${r.dept}-${i + 1}-kr`, title: `${r.metric} ${+(r.target * factor / 4).toFixed(2)}${r.unit} / 季`, metric: r.metric, direction: 'up', target: +(r.target * factor / 4).toFixed(2), unit: r.unit, current: null }] }));
  });
  return out;
}
/** 半年复盘：逐条检查假设是否仍成立（由你或参谋部填写判断，没有判断 = null 待确认）。 */
export function strategyReview(p: StrategyPlan, judgments: Record<string, { holds: boolean | null; note: string }>, at: string): { plan: StrategyPlan; broken: string[]; suggestion: string } {
  const base = p.scenarios.find((s) => s.id === (p.chosen ?? 'base'))!;
  const holds = base.assumptions.map((a) => ({ assumption: a, holds: judgments[a]?.holds ?? null, note: judgments[a]?.note ?? '待确认' }));
  const broken = holds.filter((h) => h.holds === false).map((h) => h.assumption);
  return { plan: { ...p, reviews: [...p.reviews, { at, holds }] }, broken, suggestion: broken.length ? `有 ${broken.length} 条假设不再成立，建议战略委员会评估是否切换到${p.chosen === 'optimistic' ? '基准' : '悲观'}情景，并提交董事会` : '假设仍成立，维持当前情景' };
}
/** 参谋部起草 BLM（有模型时由模型起草，只用给定材料；没有模型用模板）。 */
export async function draftBlm(material: string, speak?: GovSpeaker): Promise<Partial<Record<BlmStepId, string>>> {
  if (!speak) return { gap: `${NO_DATA}：请导入上期数据`, insight: '公开来源：各平台创作者规则；你录入的受众反馈', intent: '一年内形成稳定的内容产出与复盘节奏', innovation: '口播短视频的前 3 秒结构', design: '为关注本领域的读者提供可直接用的干货', tasks: '每周 3 篇；每月复盘一次；每季接入一项新数据', org_talent: '短视频事业部为主，数据中心支撑', climate: '鼓励说真话、写出处；停止无来源的夸大' };
  const r = await speak({ who: 'strategy', role: 'strategist', tier: 'cheap', maxTokens: 700, system: `你是 AI 虚拟集团的参谋部。按 BLM 八步各写一行（≤40 字）：${BLM_STEPS.map((s) => s.title).join('、')}。格式“步骤名：内容”。只用给定材料，没有数据写“无数据”，不建议自动发布 / 自动互动 / 刷量。`, user: clip(material, 1500) });
  const out: Partial<Record<BlmStepId, string>> = {};
  for (const s of BLM_STEPS) { const m = new RegExp(`${s.title}[：:]\\s*(.+)`).exec(r.text); if (m) out[s.id] = clip(m[1]!.trim(), 80); }
  return out;
}
