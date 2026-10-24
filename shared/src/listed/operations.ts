/**
 * 1.4.0 经营分析与全面预算（PROMPT-v1.4 第六部分）。
 * 月度经营分析会（经管会主持、CEO 汇报）：平衡计分卡四维度（成果 / 受众 / 流程 / 成长，参照平衡计分卡思路改写），
 *   “目标 – 实际 – 差距 – 原因 – 动作”五列表；只用可验证数据（每个实际值须有出处），没有就写“无数据”，不编造。
 * 全面预算：年度 → 季度 / 部门 / 项目；执行率每日更新；偏差 >20% 自动预警；超支走请示；季度调整须董事会批准。
 * 投入产出看板：每个部门 / Agent 的“花费 / 产出 / 采纳”比。
 */
import { NO_DATA, quarterKey, checkGovResolution } from './gov.js';

export const BSC_DIMS = ['outcome', 'audience', 'process', 'growth'] as const;
export type BscDim = typeof BSC_DIMS[number];
export const BSC_TEXT: Record<BscDim, string> = { outcome: '成果', audience: '受众', process: '流程', growth: '成长' };
export const BSC_HINT: Record<BscDim, string> = { outcome: '产出、采纳、你录入的效果', audience: '受众反馈与画像变化', process: '一次通过率、周期、退回率', growth: '技能、案例、模型' };
export interface Metric { key: string; label: string; dim: BscDim; direction: 'up' | 'down'; target: number | null; actual: number | null; unit: string; source: { kind: string; ref: string } | null }
export interface GapRow { key: string; dim: BscDim; label: string; target: string; actual: string; gap: string; cause: string; action: string; verifiable: boolean; ref: string | null; behind: boolean | null }
export const fmtNum = (v: number | null, unit = ''): string => (v == null ? NO_DATA : `${Number.isInteger(v) ? v : +v.toFixed(2)}${unit}`);
/** 只用可验证数据：实际值没有出处 → 当作“无数据”；差距 = 实际 − 目标（按方向判断落后与否）。原因 / 动作由规则给出初稿，CEO 可改。 */
export function gapTable(metrics: Metric[], causes: Record<string, { cause: string; action: string }> = {}): GapRow[] {
  return metrics.map((m) => {
    const actual = m.source ? m.actual : null;
    const behind = actual == null || m.target == null ? null : m.direction === 'up' ? actual < m.target : actual > m.target;
    const gap = actual == null || m.target == null ? NO_DATA : fmtNum(+(actual - m.target).toFixed(4), m.unit);
    const c = causes[m.key];
    return { key: m.key, dim: m.dim, label: m.label, target: fmtNum(m.target, m.unit), actual: fmtNum(actual, m.unit), gap, behind, verifiable: actual != null, ref: m.source ? `${m.source.kind}:${m.source.ref}` : null,
      cause: actual == null ? '没有可核实的数据（请导入或录入）' : c?.cause ?? (behind ? '待分析：请事业部负责人说明' : '达标'),
      action: actual == null ? '下月前补齐数据来源' : c?.action ?? (behind ? '下月列为重点动作，指定负责人' : '保持') };
  });
}
export interface MonthlyReview { id: string; month: string; host: string; reporter: string; rows: GapRow[]; byDim: Record<BscDim, { total: number; noData: number; behind: number }>; actions: { title: string; owner: string }[]; sim: boolean; at: string; budgetAlerts: string[] }
export function monthlyReview(o: { month: string; metrics: Metric[]; causes?: Record<string, { cause: string; action: string }>; owners?: Record<string, string>; at: string; sim?: boolean; budgetAlerts?: string[] }): MonthlyReview {
  const rows = gapTable(o.metrics, o.causes);
  const byDim = Object.fromEntries(BSC_DIMS.map((d) => [d, { total: rows.filter((r) => r.dim === d).length, noData: rows.filter((r) => r.dim === d && !r.verifiable).length, behind: rows.filter((r) => r.dim === d && r.behind).length }])) as MonthlyReview['byDim'];
  const actions = rows.filter((r) => r.behind || !r.verifiable).map((r) => ({ title: `${r.label}：${r.action}`, owner: o.owners?.[r.key] ?? (r.dim === 'process' ? '质量委员会' : r.dim === 'growth' ? '人力资源委员会' : '经营管理委员会') }));
  return { id: `review-${o.month}`, month: o.month, host: '经营管理委员会', reporter: 'CEO', rows, byDim, actions, sim: !!o.sim, at: o.at, budgetAlerts: o.budgetAlerts ?? [] };
}

/* ---------------- 全面预算 ---------------- */
export interface Budget { year: number; total: number; quarters: [number, number, number, number]; depts: Record<string, number>; projects: Record<string, number>; version: number; adjustments: BudgetAdjust[]; approvedBy: string | null; at: string }
export interface BudgetAdjust { id: string; quarter: number; dept: string; delta: number; reason: string; status: 'pending' | 'approved' | 'rejected'; motionId?: string; at: string }
export const DEVIATION_ALERT = 0.2;
/** 年度预算拆分：季度平均（可传权重）、部门按权重、项目按指定额度（剩余留在部门内）。 */
export function makeBudget(o: { year: number; total: number; deptWeights: Record<string, number>; quarterWeights?: [number, number, number, number]; projects?: Record<string, number>; at?: string }): Budget {
  if (!(o.total > 0)) throw new Error('预算总额须大于 0');
  const qw = o.quarterWeights ?? [1, 1, 1, 1]; const qs = qw.reduce((a, b) => a + b, 0);
  const quarters = qw.map((w) => +(o.total * w / qs).toFixed(2)) as Budget['quarters'];
  const dw = Object.values(o.deptWeights).reduce((a, b) => a + b, 0) || 1;
  const depts = Object.fromEntries(Object.entries(o.deptWeights).map(([k, w]) => [k, +(o.total * w / dw).toFixed(2)]));
  const proj = o.projects ?? {};
  if (Object.values(proj).reduce((a, b) => a + b, 0) > o.total) throw new Error('项目预算之和超过年度总额');
  return { year: o.year, total: o.total, quarters, depts, projects: proj, version: 1, adjustments: [], approvedBy: null, at: o.at ?? new Date().toISOString() };
}
export interface SpendLike { deptId: string; yuan: number; at: string; ref?: string; project?: string }
export interface BudgetLine { key: string; label: string; planned: number; plannedToDate: number; spent: number; rate: number | null; deviation: number | null; alert: boolean }
/** 执行率（每日更新）：按当日在本季度的进度折算“应花”，偏差 = (实花 − 应花)/应花；超支 >20% 随时预警（季度合计与各部门）；少花 >20% 只看季度合计、且在季度过半后预警（部门少花不报，避免不花钱的职能部门刷屏）；应花 < ¥0.05 时不预警。 */
export function budgetExecution(b: Budget, ledger: SpendLike[], now: Date): { quarter: string; lines: BudgetLine[]; alerts: string[]; yearSpent: number; yearRate: number } {
  const q = Math.floor(now.getMonth() / 3);
  const qStart = new Date(now.getFullYear(), q * 3, 1).getTime(); const qEnd = new Date(now.getFullYear(), q * 3 + 3, 1).getTime();
  const qProg = Math.min(1, Math.max(0.0001, (now.getTime() - qStart) / (qEnd - qStart)));
  const inYear = ledger.filter((e) => new Date(e.at).getFullYear() === b.year && new Date(e.at).getTime() <= now.getTime());
  const inQ = inYear.filter((e) => { const t = new Date(e.at).getTime(); return t >= qStart && t < qEnd; });
  const sum = (xs: SpendLike[]) => +xs.reduce((a, e) => a + e.yuan, 0).toFixed(4);
  const line = (key: string, label: string, planned: number, spent: number, underAlert = true): BudgetLine => {
    const ptd = +(planned * qProg).toFixed(4);
    const deviation = ptd >= 0.05 ? +((spent - ptd) / ptd).toFixed(4) : null;
    // 少花只在季度过半后才预警（避免预算刚批、季度初的噪音）；超支随时预警。
    return { key, label, planned, plannedToDate: ptd, spent, rate: planned > 0 ? +(spent / planned).toFixed(4) : null, deviation, alert: deviation != null && (deviation > DEVIATION_ALERT || (underAlert && deviation < -DEVIATION_ALERT && qProg >= 0.5)) };
  };
  const qPlan = b.quarters[q]!;
  const deptQ = (d: string) => +((b.depts[d] ?? 0) * qPlan / b.total).toFixed(4);
  const lines = [line('quarter', `${quarterKey(now)} 合计`, qPlan, sum(inQ)), ...Object.keys(b.depts).map((d) => line(`dept:${d}`, d, deptQ(d), sum(inQ.filter((e) => e.deptId === d)), false))];
  const alerts = lines.filter((l) => l.alert).map((l) => `${l.label} 预算偏差 ${(l.deviation! * 100).toFixed(0)}%（应花 ¥${l.plannedToDate.toFixed(2)}，实花 ¥${l.spent.toFixed(2)}）${l.deviation! > 0 ? '：超支须走请示' : '：明显少花，检查是否停摆'}`);
  const yearSpent = sum(inYear);
  return { quarter: quarterKey(now), lines, alerts, yearSpent, yearRate: +(yearSpent / b.total).toFixed(4) };
}
/** 超支请示：须董事长批准（DOA spend），附偏差与原因。 */
export function overspendAsk(line: BudgetLine, reason: string): { title: string; body: string; to: 'chairman' } {
  return { to: 'chairman', title: `请示：${line.label} 超支 ¥${(line.spent - line.plannedToDate).toFixed(2)}`, body: `应花 ¥${line.plannedToDate.toFixed(2)}，实花 ¥${line.spent.toFixed(2)}，偏差 ${((line.deviation ?? 0) * 100).toFixed(0)}%。原因：${reason || '待说明'}。请批准追加或要求降频。` };
}
/** 季度调整：只能先建“待批”，董事会批准（议案 approved）后才生效。 */
export function proposeAdjust(b: Budget, a: { quarter: number; dept: string; delta: number; reason: string; at?: string }): Budget {
  if (a.quarter < 1 || a.quarter > 4) throw new Error('季度须为 1–4');
  if (!checkGovResolution(a.reason).ok) throw new Error('调整理由触碰硬边界');
  return { ...b, adjustments: [...b.adjustments, { id: `adj-${b.adjustments.length + 1}`, quarter: a.quarter, dept: a.dept, delta: a.delta, reason: a.reason, status: 'pending', at: a.at ?? new Date().toISOString() }] };
}
export function applyAdjust(b: Budget, id: string, motion: { id: string; decision: 'approved' | 'rejected' | null; matter: string } | null): Budget {
  const adj = b.adjustments.find((x) => x.id === id);
  if (!adj || adj.status !== 'pending') throw new Error('没有待批的调整');
  if (!motion || motion.matter !== 'budget_adjust' || motion.decision == null) throw new Error('季度预算调整须董事会批准');
  if (motion.decision === 'rejected') return { ...b, adjustments: b.adjustments.map((x) => (x.id === id ? { ...x, status: 'rejected', motionId: motion.id } : x)) };
  const quarters = [...b.quarters] as Budget['quarters']; quarters[adj.quarter - 1] = +(quarters[adj.quarter - 1]! + adj.delta).toFixed(2);
  return { ...b, total: +(b.total + adj.delta).toFixed(2), quarters, depts: { ...b.depts, [adj.dept]: +((b.depts[adj.dept] ?? 0) + adj.delta).toFixed(2) }, version: b.version + 1, adjustments: b.adjustments.map((x) => (x.id === id ? { ...x, status: 'approved', motionId: motion.id } : x)) };
}

/* ---------------- 投入产出看板 ---------------- */
export interface RoiRow { key: string; label: string; spent: number; outputs: number; adopted: number; costPerOutput: number | null; adoptRate: number | null; costPerAdopted: number | null }
export function roiBoard(rows: { key: string; label: string; spent: number; outputs: number; adopted: number }[]): RoiRow[] {
  return rows.map((r) => ({ ...r, costPerOutput: r.outputs ? +(r.spent / r.outputs).toFixed(4) : null, adoptRate: r.outputs ? +(r.adopted / r.outputs).toFixed(4) : null, costPerAdopted: r.adopted ? +(r.spent / r.adopted).toFixed(4) : null }))
    .sort((a, b) => (a.costPerAdopted ?? Infinity) - (b.costPerAdopted ?? Infinity));
}
