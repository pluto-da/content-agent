/**
 * 1.2.0 工作流（PROMPT-v1.2 第八部分）：workflows/<id>.yaml。
 * 文件格式：YAML 1.2 的 JSON 兼容写法（JSON 是 YAML 1.2 的子集；开头允许 # 注释行）——本机不引入 YAML 依赖，读写都无歧义（deviations V12-04）。
 * 节点：agent（指定子 Agent 或超级 Agent）、condition（条件）、parallel（并行）、approval（人工审批）、wait（等待）。
 * 触发：manual；schedule（App 打开时执行到期任务；关闭时只发通知、点开再执行；连了自己的服务器时可由服务器执行——仅限不涉及硬边界、不需要人工审批的步骤）；
 *      event（素材箱收到新内容 inbox.new、导入了新数据 data.imported、草稿通过审核 draft.approved）。
 * 定时启用属于 L3（需你确认）；超级 Agent 提议保存的工作流是 L1 草稿（默认停用、只能手动触发）。
 */
import { findSecrets } from '../core/redact.js';
import { SUPER_ID } from './governance.js';

export type WfEvent = 'inbox.new' | 'data.imported' | 'draft.approved';
export const WF_EVENTS: WfEvent[] = ['inbox.new', 'data.imported', 'draft.approved'];
export const WF_EVENT_TEXT: Record<WfEvent, string> = { 'inbox.new': '素材箱收到新内容', 'data.imported': '导入了新数据', 'draft.approved': '草稿通过审核' };
export type Trigger = { kind: 'manual' } | { kind: 'schedule'; at: string; days?: number[] } | { kind: 'event'; event: WfEvent };
export type WfNode =
  | { id: string; type: 'agent'; agent: string; goal: string; title?: string }
  | { id: string; type: 'condition'; ref: string; op: 'exists' | 'empty' | 'contains'; value?: string; then: WfNode[]; else?: WfNode[] }
  | { id: string; type: 'parallel'; branches: WfNode[][] }
  | { id: string; type: 'approval'; title: string }
  | { id: string; type: 'wait'; minutes: number };
export interface WorkflowDef { schemaVersion: 1; id: string; name: string; description: string; version: number; enabled: boolean; triggers: Trigger[]; nodes: WfNode[]; createdBy: 'user' | 'super' | 'template'; scheduleApproved: boolean; template?: string }
export const workflowPath = (id: string): string => `workflows/${id}.yaml`;

export function serializeWorkflow(w: WorkflowDef): string {
  const txt = `# 工作流 ${w.name}（YAML 1.2，JSON 兼容写法）\n${JSON.stringify(w, null, 2)}\n`;
  if (findSecrets(txt).length) throw new Error('工作流里有疑似密钥，已拒绝保存');
  return txt;
}
export function parseWorkflow(text: string): WorkflowDef {
  const j = JSON.parse(text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n')) as WorkflowDef;
  return { ...j, schemaVersion: 1, triggers: j.triggers ?? [{ kind: 'manual' }], nodes: j.nodes ?? [], scheduleApproved: j.scheduleApproved === true };
}
const walk = (ns: WfNode[]): WfNode[] => ns.flatMap((n) => [n, ...(n.type === 'condition' ? [...walk(n.then), ...walk(n.else ?? [])] : n.type === 'parallel' ? n.branches.flatMap(walk) : [])]);
export function validateWorkflow(w: WorkflowDef, agents: string[] = []): string[] {
  const e: string[] = [];
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(w.id)) e.push(`id 不合法：${w.id}`);
  if (!w.name.trim()) e.push('缺少名称');
  if (!w.nodes.length) e.push('至少要有一个步骤');
  const all = walk(w.nodes);
  const ids = all.map((n) => n.id);
  if (new Set(ids).size !== ids.length) e.push('步骤 id 重复');
  for (const n of all) {
    if (n.type === 'agent' && n.agent !== SUPER_ID && agents.length && !agents.includes(n.agent)) e.push(`步骤 ${n.id} 指定的子 Agent 不存在：${n.agent}`);
    if (n.type === 'agent' && !n.goal.trim()) e.push(`步骤 ${n.id} 缺少目标`);
    if (n.type === 'wait' && !(n.minutes >= 0 && n.minutes <= 7 * 24 * 60)) e.push(`步骤 ${n.id} 等待时间需在 0–7 天`);
    if (n.type === 'parallel' && n.branches.length < 2) e.push(`步骤 ${n.id} 并行至少两路`);
    if (n.type === 'agent' && /(自动|直接)(发布|评论|点赞|私信|关注)/.test(n.goal)) e.push(`步骤 ${n.id} 触碰硬边界：发布与互动由你本人完成`);
  }
  for (const t of w.triggers) {
    if (t.kind === 'schedule' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.at)) e.push(`定时时间格式需为 HH:MM：${t.at}`);
    if (t.kind === 'event' && !WF_EVENTS.includes(t.event)) e.push(`未知事件：${t.event}`);
  }
  return e;
}

/* ---------------- 触发 ---------------- */
const localParts = (ms: number, tzMin: number) => { const d = new Date(ms + tzMin * 60000); return { day: d.toISOString().slice(0, 10), dow: d.getUTCDay(), hm: d.toISOString().slice(11, 16) }; };
/** 到期的定时：今天（本地）在 at 之后、且今天还没跑过；未启用、定时未经批准的不算。 */
export function dueSchedules(defs: WorkflowDef[], lastRun: Record<string, string>, now = Date.now(), tzMin = 480): string[] {
  const cur = localParts(now, tzMin);
  return defs.filter((w) => w.enabled && w.scheduleApproved && w.triggers.some((t) => t.kind === 'schedule' && (!t.days || t.days.includes(cur.dow)) && cur.hm >= t.at && (!lastRun[w.id] || localParts(Date.parse(lastRun[w.id]!), tzMin).day < cur.day))).map((w) => w.id);
}
/** 到期后怎么做：App 打开 → 本机执行；App 关闭 → 只发通知（点开再执行）；连了自己的服务器且全部步骤可在服务器执行 → 服务器执行。 */
export function scheduleAction(w: WorkflowDef, o: { appOpen: boolean; serverConnected: boolean }): 'run' | 'notify' | 'server' {
  if (o.appOpen) return 'run';
  if (o.serverConnected && serverRunnable(w)) return 'server';
  return 'notify';
}
/** 服务器只能执行不涉及硬边界、不需要人工审批的步骤（审批节点必须你本人在 App 里点）。 */
export function serverRunnable(w: WorkflowDef): boolean { return walk(w.nodes).every((n) => n.type !== 'approval'); }
export function eventWorkflows(defs: WorkflowDef[], ev: WfEvent): string[] { return defs.filter((w) => w.enabled && w.triggers.some((t) => t.kind === 'event' && t.event === ev)).map((w) => w.id); }
/** 启用定时 = L3：没批准前返回需要审批。 */
export function scheduleNeedsApproval(w: WorkflowDef): boolean { return w.triggers.some((t) => t.kind === 'schedule') && !w.scheduleApproved; }

/* ---------------- 执行 ---------------- */
export type NodeStatus = 'pending' | 'done' | 'skipped' | 'failed' | 'awaiting_user' | 'waiting' | 'cancelled';
export interface WfRunState { workflowId: string; status: 'running' | 'done' | 'failed' | 'awaiting_user' | 'waiting' | 'cancelled'; nodes: Record<string, { status: NodeStatus; output?: string; cost?: number; note?: string }>; outputs: Record<string, string>; cost: number; resumeAt?: string; wakeAt?: string; startedAt: string; endedAt?: string }
export interface WfCtx {
  runAgent(agentId: string, goal: string, inputs: Record<string, string>, signal: AbortSignal): Promise<{ ok: boolean; output: string; cost?: number; error?: string }>;
  approval(node: { id: string; title: string }, outputs: Record<string, string>): 'approved' | 'rejected' | 'pending';
  signal: AbortSignal; now?(): number;
}
/** 顺序执行；approval 未批 → 停在该节点（awaiting_user，可从 resumeAt 续跑）；wait>0 → waiting（到点再续）；任一 agent 失败 → failed。 */
export async function runWorkflow(w: WorkflowDef, ctx: WfCtx, prev?: WfRunState): Promise<WfRunState> {
  const now = () => ctx.now?.() ?? Date.now();
  const st: WfRunState = prev ? { ...prev, status: 'running', nodes: { ...prev.nodes }, outputs: { ...prev.outputs } } : { workflowId: w.id, status: 'running', nodes: {}, outputs: {}, cost: 0, startedAt: new Date(now()).toISOString() };
  const fill = (s: string) => s.replace(/\{\{([\w-]+)\}\}/g, (_m, k: string) => st.outputs[k] ?? '');
  async function exec(ns: WfNode[]): Promise<'ok' | 'stop'> {
    for (const n of ns) {
      if (ctx.signal.aborted) { st.status = 'cancelled'; return 'stop'; }
      const done = st.nodes[n.id]?.status;
      if (done === 'done' || done === 'skipped') continue;
      if (n.type === 'agent') {
        const r = await ctx.runAgent(n.agent, fill(n.goal), st.outputs, ctx.signal);
        if (ctx.signal.aborted) { st.nodes[n.id] = { status: 'cancelled' }; st.status = 'cancelled'; return 'stop'; }
        st.cost += r.cost ?? 0;
        if (!r.ok) { st.nodes[n.id] = { status: 'failed', note: r.error }; st.status = 'failed'; return 'stop'; }
        st.nodes[n.id] = { status: 'done', output: r.output, cost: r.cost }; st.outputs[n.id] = r.output;
      } else if (n.type === 'approval') {
        const a = ctx.approval({ id: n.id, title: n.title }, st.outputs);
        if (a === 'pending') { st.nodes[n.id] = { status: 'awaiting_user' }; st.status = 'awaiting_user'; st.resumeAt = n.id; return 'stop'; }
        if (a === 'rejected') { st.nodes[n.id] = { status: 'failed', note: '你拒绝了' }; st.status = 'failed'; return 'stop'; }
        st.nodes[n.id] = { status: 'done' };
      } else if (n.type === 'wait') {
        const wake = st.nodes[n.id]?.note ? Date.parse(st.nodes[n.id]!.note!) : now() + n.minutes * 60000;
        if (n.minutes > 0 && now() < wake) { st.nodes[n.id] = { status: 'waiting', note: new Date(wake).toISOString() }; st.status = 'waiting'; st.wakeAt = new Date(wake).toISOString(); return 'stop'; }
        st.nodes[n.id] = { status: 'done' };
      } else if (n.type === 'condition') {
        const v = st.outputs[n.ref] ?? '';
        const hit = n.op === 'exists' ? v.trim() !== '' : n.op === 'empty' ? v.trim() === '' : v.includes(n.value ?? '');
        st.nodes[n.id] = { status: 'done', note: hit ? 'then' : 'else' };
        for (const x of walk(hit ? n.else ?? [] : n.then)) st.nodes[x.id] ??= { status: 'skipped' };
        if ((await exec(hit ? n.then : n.else ?? [])) === 'stop') return 'stop';
      } else if (n.type === 'parallel') {
        const rs = await Promise.all(n.branches.map((b) => exec(b)));
        if (rs.includes('stop')) return 'stop';
        st.nodes[n.id] = { status: 'done' };
      }
    }
    return 'ok';
  }
  const r = await exec(w.nodes);
  if (r === 'ok') { st.status = 'done'; st.resumeAt = undefined; st.wakeAt = undefined; }
  if (st.status !== 'awaiting_user' && st.status !== 'waiting') st.endedAt = new Date(now()).toISOString();
  return st;
}

/* ---------------- 模板与提议保存 ---------------- */
const tpl = (id: string, name: string, description: string, triggers: Trigger[], nodes: WfNode[]): WorkflowDef => ({ schemaVersion: 1, id, name, description, version: 1, enabled: false, triggers, nodes, createdBy: 'template', scheduleApproved: false, template: id });
export const WORKFLOW_TEMPLATES: WorkflowDef[] = [
  tpl('daily-briefing', '每日选题晨报', '每天早上：选题研究员汇总合法来源热点 → 超级 Agent 汇总成 3 条 → 通知你', [{ kind: 'schedule', at: '08:30' }, { kind: 'manual' }], [
    { id: 'research', type: 'agent', agent: 'topic-researcher', goal: '汇总今天合法来源的热点，按账号画像出 5 个选题' },
    { id: 'summary', type: 'agent', agent: SUPER_ID, goal: '把下面的选题汇总成 3 条晨报，每条一句理由：\n{{research}}' },
  ]),
  tpl('one-to-many', '一稿多发', '写母稿 → 平台适配编辑 → 合规审核员 → 待你发布（发布由你本人点）', [{ kind: 'manual' }, { kind: 'event', event: 'draft.approved' }], [
    { id: 'mother', type: 'agent', agent: SUPER_ID, goal: '写一篇母稿（自由创作，不带平台格式）' },
    { id: 'adapt', type: 'agent', agent: 'platform-adapter', goal: '把母稿适配到已选平台，母稿不改：\n{{mother}}' },
    { id: 'review', type: 'agent', agent: 'compliance-reviewer', goal: '审核这些适配稿，只出意见不改稿：\n{{adapt}}' },
    { id: 'publish', type: 'approval', title: '看过审核意见后，由你本人复制去平台发布' },
  ]),
  tpl('weekly-review', '周复盘', '数据复盘 → 收益分析 → 超级 Agent 出下周计划 → 待你批准', [{ kind: 'schedule', at: '20:00', days: [0] }, { kind: 'manual' }, { kind: 'event', event: 'data.imported' }], [
    { id: 'data', type: 'agent', agent: 'data-analyst', goal: '用录入或导入的数据做本周复盘；没有数据就写待录入' },
    { id: 'revenue', type: 'agent', agent: 'revenue-analyst', goal: '按漏斗做收益分析，结论带反证：\n{{data}}' },
    { id: 'plan', type: 'agent', agent: SUPER_ID, goal: '根据复盘与收益分析出下周计划：\n{{data}}\n{{revenue}}' },
    { id: 'approve', type: 'approval', title: '批准下周计划' },
  ]),
];
/** 超级 Agent 把一次成功的多步任务提议保存为工作流：L1 草稿，停用、只能手动触发；启用定时需 L3 确认。 */
export function proposeWorkflow(name: string, steps: { agentId: string; goal: string }[], existing: string[] = []): WorkflowDef {
  let id = 'saved-run'; let n = 1; while (existing.includes(id)) id = `saved-run-${++n}`;
  return { schemaVersion: 1, id, name, description: `由超级 Agent 从一次成功的多步任务提议保存（${steps.length} 步）`, version: 1, enabled: false, triggers: [{ kind: 'manual' }], nodes: steps.map((s, i) => ({ id: `s${i + 1}`, type: 'agent', agent: s.agentId, goal: s.goal })), createdBy: 'super', scheduleApproved: false };
}
