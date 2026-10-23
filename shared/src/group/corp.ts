/**
 * 1.3.0 决策、升级、复盘（第十一部分）与考核、政委、任免（第十二部分）；花费归属与开会占比（第十五部分）。
 * - 决策层级：执行 → 部门负责人 → 委员会 / 经管会 → CEO → 董事长；每级只在 DOA 授权内决定。
 * - 否决权：仅法务合规部（合规）与质量委员会（质量）；须引用条款；可申诉一次由 CEO 裁决；硬边界相关不可申诉。
 * - 升级：工单超时、审核两轮未过、会话 / 会议无决议、部门冲突 → 自动上一级；到 CEO 仍无法解决或超权 → 附双方意见与 CEO 建议进董事长收件箱。
 * - 复盘四步（公开常见表述）→ lesson：低风险自动采纳，高风险进收件箱；写入上下文流。
 * - KPI 只用可验证数据；360 只由协作过的部门互评；政委只观察和建议，不能下指令；任免按程序，只提议停用、不自动删除。
 */
import { clauseExists, clauseText } from './regulations.js';
import { makeAudit, type AuditEvent } from '../core/audit.js';

export const DECISION_LADDER = ['executor', 'dept_head', 'committee', 'ceo', 'chairman'] as const;
export type Level = typeof DECISION_LADDER[number];
export const LEVEL_TEXT: Record<Level, string> = { executor: '执行', dept_head: '部门负责人', committee: '委员会 / 经管会', ceo: 'CEO', chairman: '董事长' };
export const nextLevel = (l: Level): Level | null => DECISION_LADDER[DECISION_LADDER.indexOf(l) + 1] ?? null;

/* ---------------- 否决与申诉 ---------------- */
export type VetoBy = 'legal' | 'quality';
export interface Veto { id: string; by: VetoBy; target: string; clause: string; reason: string; hardBoundary: boolean; appeal: null | { by: string; text: string; ruling: 'upheld' | 'overturned' | null; ruler: 'ceo' } ; at: string }
export function veto(o: { by: string; target: string; clause: string; reason: string; hardBoundary?: boolean; at?: string }): Veto {
  if (o.by !== 'legal' && o.by !== 'quality') throw new Error('否决权仅法务合规部（合规）与质量委员会（质量）拥有');
  if (!clauseExists(o.clause)) throw new Error(`否决必须引用有效条款（收到：${o.clause || '空'}）`);
  return { id: `veto-${o.target}-${o.by}`, by: o.by, target: o.target, clause: o.clause, reason: `${o.reason}（依据：${clauseText(o.clause)}）`, hardBoundary: !!o.hardBoundary, appeal: null, at: o.at ?? new Date().toISOString() };
}
export function appeal(v: Veto, by: string, text: string): Veto {
  if (v.hardBoundary) throw new Error('涉及硬边界的否决不可申诉');
  if (v.appeal) throw new Error('每个否决只能申诉一次');
  return { ...v, appeal: { by, text, ruling: null, ruler: 'ceo' } };
}
export function ruleAppeal(v: Veto, ruling: 'upheld' | 'overturned'): Veto {
  if (!v.appeal) throw new Error('没有待裁决的申诉');
  return { ...v, appeal: { ...v.appeal, ruling } };
}
/** 董事长终裁：可推翻 CEO 的任何裁决，但不能推翻硬边界否决。 */
export function chairmanOverride(v: Veto, decision: 'upheld' | 'overturned'): Veto {
  if (v.hardBoundary && decision === 'overturned') throw new Error('硬边界不可放宽：董事长也不能推翻硬边界否决');
  return { ...v, appeal: { by: v.appeal?.by ?? 'chairman', text: v.appeal?.text ?? '董事长终裁', ruling: decision, ruler: 'ceo' } };
}

/* ---------------- 升级 ---------------- */
export type EscalationTrigger = 'ticket_timeout' | 'review_failed_twice' | 'no_resolution' | 'dept_conflict' | 'over_authority';
export const ESCALATION_TEXT: Record<EscalationTrigger, string> = { ticket_timeout: '工单超时', review_failed_twice: '审核两轮未过', no_resolution: '会话或会议无决议', dept_conflict: '部门冲突', over_authority: '超出权限' };
export interface Escalation { id: string; trigger: EscalationTrigger; subject: string; level: Level; history: { level: Level; at: string; note: string }[]; opinions: { side: string; text: string }[]; ceoAdvice?: string; toChairman: boolean }
export function escalate(e: Omit<Escalation, 'history' | 'toChairman' | 'id'> & { id?: string }, at = new Date().toISOString()): Escalation {
  const target: Level = e.trigger === 'over_authority' ? 'chairman' : nextLevel(e.level) ?? 'chairman';
  const toChairman = target === 'chairman';
  return { ...e, id: e.id ?? `esc-${Date.now().toString(36)}`, level: target, history: [{ level: e.level, at, note: ESCALATION_TEXT[e.trigger] }], toChairman };
}
export function escalateAgain(e: Escalation, note: string, ceoAdvice?: string, at = new Date().toISOString()): Escalation {
  const target = nextLevel(e.level) ?? 'chairman';
  return { ...e, level: target, ceoAdvice: e.level === 'ceo' ? ceoAdvice ?? e.ceoAdvice : e.ceoAdvice, history: [...e.history, { level: e.level, at, note }], toChairman: target === 'chairman' };
}
/** 进董事长收件箱的请示：附双方意见与 CEO 建议。 */
export function chairmanAsk(e: Escalation): { title: string; body: string } {
  return { title: `请示：${e.subject}`, body: [`触发：${ESCALATION_TEXT[e.trigger]}；经过：${e.history.map((h) => LEVEL_TEXT[h.level]).join(' → ')} → 董事长`, ...e.opinions.map((o) => `${o.side}：${o.text}`), `CEO 建议：${e.ceoAdvice ?? '（无）'}`].join('\n') };
}
/** 审核退回最多两轮：第三次自动升级。 */
export function reviewRound(returned: number): { allowReturn: boolean; escalate: boolean } { return { allowReturn: returned < 2, escalate: returned >= 2 }; }

/* ---------------- 复盘 ---------------- */
export const RETRO_STEPS = ['目标回顾', '结果对比', '原因分析', '经验沉淀'] as const;
export interface Retro { id: string; subject: string; trigger: 'okr_cycle' | 'project' | 'incident'; steps: Record<typeof RETRO_STEPS[number], string>; lessons: RetroLesson[]; at: string }
export interface RetroLesson { text: string; risk: 'low' | 'high'; status: 'adopted' | 'pending'; source: string }
const HIGH = /(权限|预算|硬边界|章程|DOA|删除|停用|对外|发布|花钱|边界)/;
export function retro(o: { subject: string; trigger: Retro['trigger']; goal: string; result: string; causes: string; lessons: string[]; at?: string; id?: string }): Retro {
  const lessons = o.lessons.map((t) => ({ text: t.slice(0, 200), risk: (HIGH.test(t) ? 'high' : 'low') as RetroLesson['risk'], status: (HIGH.test(t) ? 'pending' : 'adopted') as RetroLesson['status'], source: o.subject }));
  return { id: o.id ?? `retro-${Date.now().toString(36)}`, subject: o.subject, trigger: o.trigger, steps: { 目标回顾: o.goal, 结果对比: o.result, 原因分析: o.causes, 经验沉淀: lessons.map((l) => l.text).join('；') }, lessons, at: o.at ?? new Date().toISOString() };
}

/* ---------------- KPI / 360 ---------------- */
export interface KpiInput { outputs: number; firstPass: number; returned: number; offered: number; adopted: number; onTime: number; due: number; cost: number; userMetric?: number | null }
export function kpi(k: KpiInput): Record<string, number | null> {
  const r = (a: number, b: number) => (b > 0 ? +(a / b).toFixed(3) : null);
  return { 产出数: k.outputs, 一次通过率: r(k.firstPass, k.outputs), 退回率: r(k.returned, k.outputs), 采纳率: r(k.adopted, k.offered), 按时率: r(k.onTime, k.due), 花费: +k.cost.toFixed(4), 效果数据: k.userMetric ?? null };
}
export interface PeerScore { from: string; to: string; score: number; note: string }
export function review360(scores: PeerScore[], collaborated: [string, string][]): { byDept: Record<string, { avg: number; n: number }>; rejected: PeerScore[] } {
  const ok = (s: PeerScore) => s.from !== s.to && collaborated.some(([a, b]) => (a === s.from && b === s.to) || (a === s.to && b === s.from));
  const byDept: Record<string, { avg: number; n: number }> = {};
  for (const s of scores.filter(ok)) { const x = byDept[s.to] ?? { avg: 0, n: 0 }; byDept[s.to] = { avg: +((x.avg * x.n + Math.max(1, Math.min(5, s.score))) / (x.n + 1)).toFixed(2), n: x.n + 1 }; }
  return { byDept, rejected: scores.filter((s) => !ok(s)) };
}
export const VALUES = ['真诚（不夸大、不编造数据）', '用户第一（董事长利益与其受众利益）', '守边界'] as const;

/* ---------------- 政委（只观察和建议，不能下指令） ---------------- */
export interface CommissarObservation { deptId: string; returnRate: number | null; contextHitRate: number | null; failures: number; boundaryHits: number; idleDays: number; missingSkills: string[]; fabricatedData: number }
export interface CommissarAdvice { deptId: string; kind: 'values' | 'boundary' | 'inefficient' | 'context' | 'skill' | 'idle'; text: string; suggestion: 'training' | 'transfer' | 'context' | 'skill' | 'review'; binding: false }
export function commissarObserve(o: CommissarObservation): CommissarAdvice[] {
  const out: CommissarAdvice[] = [];
  const a = (kind: CommissarAdvice['kind'], text: string, suggestion: CommissarAdvice['suggestion']) => out.push({ deptId: o.deptId, kind, text, suggestion, binding: false });
  if (o.boundaryHits > 0) a('boundary', `近期 ${o.boundaryHits} 次触碰硬边界检查（均已拦截），建议复训边界`, 'training');
  if (o.fabricatedData > 0) a('values', `${o.fabricatedData} 次数据无来源被标“推测”，偏离“真诚”`, 'training');
  if (o.returnRate != null && o.returnRate > 0.3) a('inefficient', `退回率 ${(o.returnRate * 100).toFixed(0)}% 偏高`, o.returnRate > 0.5 ? 'transfer' : 'training');
  if (o.contextHitRate != null && o.contextHitRate < 0.3) a('context', `上下文命中率 ${(o.contextHitRate * 100).toFixed(0)}%，任务缺少集团上下文`, 'context');
  if (o.missingSkills.length) a('skill', `缺少技能：${o.missingSkills.join('、')}`, 'skill');
  if (o.idleDays >= 30) a('idle', `闲置 ${o.idleDays} 天`, 'review');
  return out;
}
/** 政委试图下指令 → 拒绝并审计。 */
export function commissarCommand(deptId: string, command: string): { ok: false; text: string; audit: AuditEvent } {
  return { ok: false, text: '政委只观察和建议，不能下指令', audit: makeAudit({ kind: 'approval', actor: 'agent', summary: `政委（${deptId}）试图下指令被拒：${command.slice(0, 40)}`, outcome: 'denied' }) };
}

/* ---------------- 任免 ---------------- */
export type AppointmentKind = 'perm_upgrade' | 'new_dept' | 'remove_dept' | 'disable_agent' | 'demote' | 'pause' | 'delete_agent';
export interface Appointment { kind: AppointmentKind; target: string; route: 'hr_then_chairman' | 'ceo_then_report' | 'refused'; text: string }
export function appointment(kind: AppointmentKind, target: string): Appointment {
  if (kind === 'delete_agent') return { kind, target, route: 'refused', text: '只提议停用，不自动删除' };
  if (kind === 'demote' || kind === 'pause') return { kind, target, route: 'ceo_then_report', text: 'CEO 可先处置并立即报告董事长' };
  return { kind, target, route: 'hr_then_chairman', text: '人力资源委员会提案 → 董事长批准' };
}

/* ---------------- 花费归属与开会占比 ---------------- */
export type SpendKind = 'session' | 'meeting' | 'race' | 'commissar' | 'task';
export interface SpendEntry { deptId: string; kind: SpendKind; yuan: number; at: string; ref: string }
export function spendByDept(ledger: SpendEntry[]): Record<string, number> { const o: Record<string, number> = {}; for (const e of ledger) o[e.deptId] = +((o[e.deptId] ?? 0) + e.yuan).toFixed(6); return o; }
export const MEETING_SHARE_ALERT = 0.3;
export function meetingShare(ledger: SpendEntry[]): { share: number | null; alert: boolean; text: string } {
  const total = ledger.reduce((a, e) => a + e.yuan, 0);
  if (total <= 0) return { share: null, alert: false, text: '暂无花费' };
  const m = ledger.filter((e) => e.kind === 'meeting' || e.kind === 'session').reduce((a, e) => a + e.yuan, 0);
  const share = +(m / total).toFixed(3);
  return { share, alert: share > MEETING_SHARE_ALERT, text: share > MEETING_SHARE_ALERT ? `开会 / 会话花费占 ${(share * 100).toFixed(0)}%，超过 30%：建议精简（能派单不拉群，能拉群不开会）` : `开会 / 会话花费占 ${(share * 100).toFixed(0)}%` };
}
