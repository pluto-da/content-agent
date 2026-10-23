/**
 * 1.2.0 超级 Agent 控制平面（PROMPT-v1.2 第四部分）：权限分级、按 Agent 预算、审批收件箱、一键暂停、目标。
 * 三层权力结构（不变量）：用户 → 超级 Agent（id `super`）→ 子 Agent → 一次性子任务。权力只能自上而下授予、逐级收窄：
 * 子 Agent 的权限永远是父级权限的子集；硬边界在最顶层，任何层级都不能放宽（本文件的判定不读任何系统文件内容）。
 * 控制平面只存一份（config/super.json，单一真相源）；子 Agent 只持有“授权句柄”（id），不持有副本。
 */
import { FORBIDDEN_TOOL, SAFE_SUFFIX, type ToolSpec } from '../agent/tools.js';
import { makeAudit, type AuditEvent } from '../core/audit.js';
import { findSecrets } from '../core/redact.js';

export const SUPER_ID = 'super';
/** L0 只读、L1 本机写、L2 花钱 / 外联、L3 核心（必须用户确认）、forbidden 硬边界（任何级别都不可用）。 */
export type PermLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'forbidden';
export const PERM_ORDER: PermLevel[] = ['L0', 'L1', 'L2', 'L3'];
export const PERM_TEXT: Record<PermLevel, string> = { L0: '只读', L1: '本机写', L2: '花钱 / 外联', L3: '核心（需你确认）', forbidden: '禁止（硬边界）' };
export const rank = (l: PermLevel): number => (l === 'forbidden' ? 99 : PERM_ORDER.indexOf(l));

/** L3 动作（不是工具，是控制平面上的操作）：都必须用户确认。 */
export const L3_ACTIONS = ['core_file_change', 'create_subagent', 'grant_permission', 'enable_external_tool', 'enable_a2a', 'platform_skill', 'agent_duty_change', 'workflow_schedule'] as const;
export type L3Action = typeof L3_ACTIONS[number];

/** 硬边界类动作的名字 / 描述规则（工具注册、MCP 工具注册、调用时二次检查共用）。 */
export const SOCIAL_ACTION = /(^|[_\-.\s/])(like|likes|upvote|comment|comments|reply_send|send_message|send_dm|dm|direct_message|follow|unfollow|favorite|repost|retweet|tweet|post|publish|create_post|share_post|auto_click|click|mass|bulk_(send|post|follow|like))([_\-.\s/]|$)/i;
export const SOCIAL_ACTION_ZH = /(点赞|评论|私信|关注|回关|互关|发帖|发布|转发|批量操作|模拟点击|刷量|买粉)/;
const SOCIAL_CONTEXT = /(social|社交|account|账号|douyin|抖音|xiaohongshu|小红书|weibo|微博|bilibili|twitter|x\.com|instagram|tiktok|kuaishou|快手|wechat|微信|zhihu|知乎)/i;

/** 工具的权限级别：原 ToolLevel + kind 推出 L3；对外写入名一律 forbidden（与 ToolRegistry 同一条规则）。 */
export function permLevelOf(t: Pick<ToolSpec, 'name' | 'level' | 'kind' | 'userOnly'>): PermLevel {
  if (FORBIDDEN_TOOL.test(t.name) && !SAFE_SUFFIX.test(t.name) && !t.userOnly) return 'forbidden';
  if (t.kind === 'system_file' || t.kind === 'delete') return 'L3';
  return t.level;
}

/** 授权：caller 持有的级别集合 ∩ 工具级别；外加工具白名单。结果写审计。 */
export interface Grant { agentId: string; permissions: PermLevel[]; tools?: string[] | '*'; parent?: string }
export interface AuthzResult { allow: boolean; needsApproval: boolean; level: PermLevel; reason: string; audit: AuditEvent }
export function authorize(g: Grant, tool: { name: string; level: PermLevel }, o: { paused?: boolean } = {}): AuthzResult {
  const deny = (reason: string, needsApproval = false): AuthzResult => ({ allow: false, needsApproval, level: tool.level, reason, audit: makeAudit({ kind: 'tool_call', actor: 'agent', tool: tool.name, outcome: 'denied', summary: `${g.agentId} 调用 ${tool.name} 被拒：${reason}`, detail: { agentId: g.agentId, level: tool.level, needsApproval } }) });
  if (tool.level === 'forbidden') return deny('硬边界：任何级别都不能使用');
  if (o.paused) return deny('已全部暂停：恢复需你手动');
  if (g.tools !== '*' && g.tools && !g.tools.includes(tool.name)) return deny('不在这个 Agent 的工具白名单里', true);
  if (tool.level === 'L3') return { allow: false, needsApproval: true, level: 'L3', reason: 'L3 核心动作必须你确认', audit: makeAudit({ kind: 'approval', actor: 'agent', tool: tool.name, outcome: 'pending', summary: `${g.agentId} 申请 L3：${tool.name}`, detail: { agentId: g.agentId } }) };
  if (!g.permissions.includes(tool.level)) return deny(`这个 Agent 没有 ${tool.level}（${PERM_TEXT[tool.level]}）权限`, true);
  return { allow: true, needsApproval: false, level: tool.level, reason: '已授权', audit: makeAudit({ kind: 'tool_call', actor: 'agent', tool: tool.name, outcome: 'ok', summary: `${g.agentId} 调用 ${tool.name}（${tool.level}）`, detail: { agentId: g.agentId, level: tool.level } }) };
}

/** 子级权限必须是父级子集，且子 Agent 永远不含 L3 / forbidden。返回越权的项（空 = 合法）。 */
export function excessPermissions(child: PermLevel[], parent: PermLevel[], o: { childIsSubAgent?: boolean } = { childIsSubAgent: true }): PermLevel[] {
  return child.filter((p) => p === 'forbidden' || !parent.includes(p) || (o.childIsSubAgent !== false && p === 'L3'));
}
/** 收窄：child ∩ parent，去掉 L3 / forbidden。 */
export function narrow(child: PermLevel[], parent: PermLevel[]): PermLevel[] {
  return PERM_ORDER.filter((p) => p !== 'L3' && child.includes(p) && parent.includes(p));
}

/* ---------------- 预算：全局护栏 → Agent 月额度 → 单次上限 ---------------- */
export interface AgentBudget { monthYuan: number; perRunYuan: number }
export const DEFAULT_AGENT_BUDGET: AgentBudget = { monthYuan: 3, perRunYuan: 1 };
export type BudgetVerdict = { ok: true } | { ok: false; reason: 'agent_month' | 'per_run' | 'global_month'; text: string; pause: boolean };
/** 超级 Agent 默认不设子额度（只受全局护栏）；子 Agent 超额度 → 暂停并进审批收件箱，不自动挪用其他额度。 */
export function checkAgentBudget(agentId: string, b: AgentBudget | null, spentMonth: number, est: number | null, global?: { monthBudgetYuan: number; spentMonth: number }): BudgetVerdict {
  const e = est ?? 0;
  if (global && global.monthBudgetYuan > 0 && global.spentMonth + e > global.monthBudgetYuan) return { ok: false, reason: 'global_month', text: `本月总预算 ¥${global.monthBudgetYuan} 将超出`, pause: agentId !== SUPER_ID };
  if (agentId === SUPER_ID || !b) return { ok: true };
  if (b.perRunYuan > 0 && e > b.perRunYuan) return { ok: false, reason: 'per_run', text: `这次预计 ¥${e.toFixed(3)}，超过单次上限 ¥${b.perRunYuan}`, pause: true };
  if (b.monthYuan >= 0 && spentMonth + e > b.monthYuan) return { ok: false, reason: 'agent_month', text: `${agentId} 本月额度 ¥${b.monthYuan} 将超出（已花 ¥${spentMonth.toFixed(3)}）`, pause: true };
  return { ok: true };
}

/* ---------------- 审批收件箱（6 类） ---------------- */
export const APPROVAL_KINDS = ['spend', 'l3', 'core_file', 'new_agent', 'platform_skill', 'external_tool'] as const;
export type ApprovalKind = typeof APPROVAL_KINDS[number];
export const APPROVAL_KIND_TEXT: Record<ApprovalKind, string> = { spend: '花钱超阈值', l3: 'L3 核心动作', core_file: '核心文件修订', new_agent: '新建子 Agent', platform_skill: '新平台写法技能', external_tool: '外部工具启用' };
export interface ApprovalItem {
  id: string; kind: ApprovalKind; from: string; why: string; impact: string; estCost: number | null;
  preview: string; payload?: Record<string, unknown>; status: 'pending' | 'approved' | 'rejected'; createdAt: string; resolvedAt?: string; edited?: boolean; note?: string;
}
export function newApproval(a: Omit<ApprovalItem, 'id' | 'status' | 'createdAt'> & { id?: string; at?: string }): ApprovalItem {
  if (findSecrets(`${a.preview}\n${JSON.stringify(a.payload ?? {})}`).length) throw new Error('审批预览里有疑似密钥，已拒绝');
  const at = a.at ?? new Date().toISOString();
  const { at: _a, id, ...rest } = a; void _a;
  return { ...rest, id: id ?? `ap-${Date.parse(at).toString(36)}-${Math.random().toString(36).slice(2, 6)}`, status: 'pending', createdAt: at };
}
export type ApprovalAction = { type: 'approve' } | { type: 'reject'; note?: string } | { type: 'edit'; preview: string; payload?: Record<string, unknown> };
/** 批准 / 拒绝 / 修改后批准；已处理的项不可再处理（返回原样 + changed=false）。 */
export function resolveApproval(list: ApprovalItem[], id: string, act: ApprovalAction, at = new Date().toISOString()): { list: ApprovalItem[]; item: ApprovalItem | null; changed: boolean } {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0 || list[i]!.status !== 'pending') return { list, item: i < 0 ? null : list[i]!, changed: false };
  const cur = list[i]!;
  let next: ApprovalItem;
  if (act.type === 'approve') next = { ...cur, status: 'approved', resolvedAt: at };
  else if (act.type === 'reject') next = { ...cur, status: 'rejected', resolvedAt: at, note: act.note };
  else {
    if (findSecrets(act.preview).length) throw new Error('修改内容里有疑似密钥，已拒绝');
    next = { ...cur, status: 'approved', resolvedAt: at, edited: true, preview: act.preview, payload: act.payload ?? cur.payload };
  }
  const out = [...list]; out[i] = next;
  return { list: out, item: next, changed: true };
}
export const pendingCount = (list: ApprovalItem[]): number => list.filter((x) => x.status === 'pending').length;

/* ---------------- 一键暂停：运行登记表 ---------------- */
export interface RunEntry { runId: string; agentId: string; parent?: string; kind: 'run' | 'queued' | 'workflow' | 'mcp'; ctl: AbortController; startedAt: number }
/** 所有运行（含排队、定时工作流、外部工具连接）都在这里登记；父级取消 → 子级级联取消；全部暂停 → 全部取消。 */
export class RunRegistry {
  private runs = new Map<string, RunEntry>();
  paused = false;
  register(e: Omit<RunEntry, 'ctl' | 'startedAt'> & { ctl?: AbortController }): RunEntry {
    if (this.paused) throw new Error('已全部暂停：恢复需你手动');
    const r: RunEntry = { ...e, ctl: e.ctl ?? new AbortController(), startedAt: Date.now() };
    this.runs.set(r.runId, r);
    r.ctl.signal.addEventListener('abort', () => this.runs.delete(r.runId), { once: true });
    return r;
  }
  done(runId: string): void { this.runs.delete(runId); }
  list(): RunEntry[] { return [...this.runs.values()]; }
  running(agentId?: string): number { return this.list().filter((r) => r.kind === 'run' && (!agentId || r.agentId === agentId)).length; }
  /** 取消一个运行及其全部后代。返回被取消的 runId。 */
  cancel(runId: string, reason = '已取消'): string[] {
    const out: string[] = [];
    const walk = (id: string) => { for (const c of this.list().filter((x) => x.parent === id)) walk(c.runId); const r = this.runs.get(id); if (r) { r.ctl.abort(reason); out.push(id); this.runs.delete(id); } };
    walk(runId);
    return out;
  }
  cancelAgent(agentId: string): string[] { return this.list().filter((r) => r.agentId === agentId).flatMap((r) => this.cancel(r.runId, `${agentId} 已暂停`)); }
  /** 全部暂停：立即取消所有运行与排队任务、停止定时、断开外部工具；之后 register 一律拒绝，直到 resume()。 */
  pauseAll(): { cancelled: string[]; ms: number; audit: AuditEvent } {
    const t0 = Date.now();
    this.paused = true;
    const cancelled: string[] = [];
    for (const r of this.list()) { r.ctl.abort('全部暂停'); cancelled.push(r.runId); }
    this.runs.clear();
    const ms = Date.now() - t0;
    return { cancelled, ms, audit: makeAudit({ kind: 'run_state', actor: 'user', summary: `全部暂停：取消 ${cancelled.length} 个运行（${ms} ms）`, outcome: 'ok', detail: { cancelled } }) };
  }
  resume(): AuditEvent { this.paused = false; return makeAudit({ kind: 'run_state', actor: 'user', summary: '手动恢复（全部暂停解除）', outcome: 'ok' }); }
}

/* ---------------- 目标：只显示有数据依据的数字 ---------------- */
export interface Goal { id: string; title: string; metric: 'followers' | 'revenue' | 'views' | 'posts' | 'custom'; platform?: string; target: number; unit: string; from: string; to: string; createdAt: string }
export interface DataPoint { metric: Goal['metric']; platform?: string; value: number; at: string; source: 'manual' | 'import' }
export interface GoalProgress { goalId: string; value: number | null; percent: number | null; text: string; points: number }
/** 只用用户录入或导入的数据点；没有数据就是“待录入”，不推算、不编造。 */
export function goalProgress(g: Goal, pts: DataPoint[]): GoalProgress {
  const ok = pts.filter((p) => p.metric === g.metric && (!g.platform || p.platform === g.platform) && (p.source === 'manual' || p.source === 'import') && p.at >= g.from && p.at <= `${g.to}T23:59:59.999Z` && Number.isFinite(p.value));
  if (!ok.length) return { goalId: g.id, value: null, percent: null, text: '待录入', points: 0 };
  const value = g.metric === 'followers' ? ok.sort((a, b) => a.at.localeCompare(b.at)).at(-1)!.value - ok[0]!.value : ok.reduce((s, p) => s + p.value, 0);
  const percent = g.target > 0 ? Math.round((value / g.target) * 1000) / 10 : null;
  return { goalId: g.id, value, percent, text: `${value}${g.unit} / ${g.target}${g.unit}`, points: ok.length };
}
/** 每周复盘草稿：只陈述有数据的目标，其余写“待录入”。 */
export function weeklyReviewDraft(goals: Goal[], pts: DataPoint[]): string {
  const lines = goals.map((g) => { const p = goalProgress(g, pts); return `- ${g.title}：${p.value === null ? '待录入（还没有录入或导入的数据）' : `${p.text}（${p.percent ?? '—'}%，依据 ${p.points} 条数据）`}`; });
  return ['# 本周复盘（草稿，等你确认）', '', ...lines, '', '下周计划由超级 Agent 起草后进审批收件箱。'].join('\n');
}

/* ---------------- 控制平面状态（config/super.json，schemaVersion 1） ---------------- */
export interface SuperState {
  schemaVersion: 1;
  paused: boolean; pausedAt?: string;
  concurrency: number;                       // 同时运行的子 Agent 上限（1–5，默认 3）
  pausedItems: string[];                     // 单项暂停：子 Agent / 工作流 / 外部工具 id
  approvals: ApprovalItem[];
  goals: Goal[]; dataPoints: DataPoint[];
  tasks: import('./agents.js').BoardTask[];
  spendByAgent: Record<string, { month: string; yuan: number }>;
  dataSources: import('./sources.js').DataSource[];
  mcpServers: import('./mcp.js').McpServerConfig[];
  a2aAgents: import('./a2a.js').A2AAgentRef[];
  a2aServer: { enabled: boolean; skills: string[] };
  stats: Record<string, import('./agents.js').AgentStats>;
  wfRuns: Record<string, import('./workflows.js').WfRunState>;
  wfLastRun: Record<string, string>;
}
export function emptySuperState(): SuperState {
  return { schemaVersion: 1, paused: false, concurrency: 3, pausedItems: [], approvals: [], goals: [], dataPoints: [], tasks: [], spendByAgent: {}, dataSources: [], mcpServers: [], a2aAgents: [], a2aServer: { enabled: false, skills: [] }, stats: {}, wfRuns: {}, wfLastRun: {} };
}
export const clampConcurrency = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3);
/** 读 config/super.json：缺字段补默认、并发夹紧到 1–5；解析失败给空状态（不抛）。 */
export function readSuperState(raw: string | null | undefined): SuperState {
  const d = emptySuperState();
  if (!raw) return d;
  let j: Partial<SuperState>;
  try { j = JSON.parse(raw); } catch { return d; }
  return { ...d, ...j, schemaVersion: 1, concurrency: clampConcurrency(j.concurrency), a2aServer: { ...d.a2aServer, ...(j.a2aServer ?? {}) } };
}
export function writeSuperState(s: SuperState): string {
  const txt = JSON.stringify(s, null, 1);
  if (findSecrets(txt).length) throw new Error('控制平面状态里有疑似密钥，已拒绝写入');
  return txt;
}
/** 记录一个 Agent 的花费（按自然月，Asia/Shanghai）。 */
export function addAgentSpend(s: SuperState, agentId: string, yuan: number, now = Date.now()): SuperState {
  const month = new Date(now + 480 * 60000).toISOString().slice(0, 7);
  const cur = s.spendByAgent[agentId];
  const v = cur && cur.month === month ? cur.yuan + yuan : yuan;
  return { ...s, spendByAgent: { ...s.spendByAgent, [agentId]: { month, yuan: Math.round(v * 1e6) / 1e6 } } };
}
export function agentSpentMonth(s: SuperState, agentId: string, now = Date.now()): number {
  const month = new Date(now + 480 * 60000).toISOString().slice(0, 7);
  const cur = s.spendByAgent[agentId];
  return cur && cur.month === month ? cur.yuan : 0;
}
export { SOCIAL_CONTEXT };
