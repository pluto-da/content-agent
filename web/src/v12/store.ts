/**
 * 1.2.0 超级 Agent 控制平面的本机接线：全部数据在 Agent VFS（随备份导出，导出不含 Key）——
 * config/super.json（控制平面，唯一真相源）、agents/<id>/AGENT.md、platforms/<id>/PLATFORM.md、workflows/<id>.yaml、skills/<平台>/SKILL.md。
 * 运行登记表 RunRegistry 与 Orchestrator 是进程内单例；子 Agent 的模型调用走与对话相同的服务商配置（resolveProvider）。
 */
import {
  readSuperState, writeSuperState, emptySuperState, RunRegistry, Orchestrator, parseAgentMd, serializeAgentMd, isAgentPath, agentPath, validateAgent, AGENT_TEMPLATES, fromTemplate,
  newApproval, resolveApproval, pendingCount, addAgentSpend, agentSpentMonth, updateStats, parsePlatformMd, serializePlatformMd, platformPath, validatePlatform, registerUserPlatforms,
  parseWorkflow, serializeWorkflow, workflowPath, runWorkflow, dueSchedules, eventWorkflows, parseMention, teamSummary, findSecrets, SUPER_ID, makeAudit,
  type SuperState, type SubAgentDef, type ApprovalItem, type ApprovalAction, type BoardTask, type PlatformManifest, type WorkflowDef, type WfRunState, type WfEvent, type HandoffInput, type DelegateResult,
} from '@content-agent/shared';
import { getVfs } from '../v9/vfsBackend';
import { audit } from '../v9/ops';
import { getModels, resolveProvider } from '../local/store';
import { chat, costOf } from '../local/llm';
import { addMessage } from '../agent/store';

const STATE = 'config/super.json';
type Listener = () => void;
const listeners = new Set<Listener>();
export function onSuperChange(fn: Listener): () => void { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => { for (const f of [...listeners]) f(); };

export const registry = new RunRegistry();
let pausedSync = false;
export const isPausedNow = (): boolean => pausedSync || registry.paused;

/* ---------------- 控制平面状态 ---------------- */
let queue: Promise<unknown> = Promise.resolve();
export async function getState(): Promise<SuperState> {
  const v = await getVfs();
  const s = readSuperState((await v.read(STATE))?.content);
  pausedSync = s.paused; registry.paused = s.paused;
  return s;
}
/** 串行化写入：读 → 改 → 写，避免并发覆盖。 */
export function updateState(fn: (s: SuperState) => SuperState | Promise<SuperState>): Promise<SuperState> {
  const p = queue.then(async () => {
    const v = await getVfs();
    const cur = readSuperState((await v.read(STATE))?.content);
    const next = await fn(cur);
    await v.write(STATE, writeSuperState({ ...next, tasks: next.tasks.slice(-200), approvals: next.approvals.slice(-300) }), { author: 'system', allowLarge: true });
    pausedSync = next.paused; registry.paused = next.paused;
    emit();
    return next;
  });
  queue = p.catch(() => undefined);
  return p;
}

/* ---------------- 子 Agent ---------------- */
export async function listAgents(): Promise<SubAgentDef[]> {
  const v = await getVfs();
  return (await v.list('agents')).filter((f) => isAgentPath(f.path)).map((f) => parseAgentMd(f.content)).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
}
export async function saveAgent(d: SubAgentDef, author: 'user' | 'user_approved' | 'system' = 'user_approved'): Promise<void> {
  const errs = validateAgent(d);
  if (errs.length) throw new Error(errs.join('；'));
  const v = await getVfs();
  await v.write(agentPath(d.id), serializeAgentMd(d), { author });
  await audit({ kind: 'setting_change', actor: 'user', summary: `子 Agent ${d.name}（${d.id}）已保存`, target: agentPath(d.id), detail: { agentId: d.id } });
  emit();
}
export async function deleteAgent(id: string): Promise<void> {
  const v = await getVfs();
  await v.softDelete(agentPath(id), 'user');
  await audit({ kind: 'setting_change', actor: 'user', summary: `删除子 Agent ${id}（30 天内可在回收站恢复）`, target: agentPath(id) });
  emit();
}
/** 新建子 Agent 属 L3：先进审批收件箱，批准后才写入 VFS。 */
export async function proposeAgent(d: SubAgentDef, why: string): Promise<ApprovalItem> {
  const errs = validateAgent(d);
  if (errs.length) throw new Error(errs.join('；'));
  const item = newApproval({ kind: 'new_agent', from: d.createdBy === 'super' ? SUPER_ID : 'user', why, impact: `权限 ${d.permissions.join('/')}；额度 ¥${d.budget.monthYuan}/月；工具 ${d.tools.length} 个`, estCost: null, preview: serializeAgentMd(d), payload: { action: 'create_agent', agentId: d.id } });
  await updateState((s) => ({ ...s, approvals: [...s.approvals, item] }));
  return item;
}
/** 从模板一键启用（用户在指挥台亲手点 = 当场确认，不再进收件箱；仍写审计）。 */
export async function enableTemplate(templateId: string): Promise<SubAgentDef> {
  const have = (await listAgents()).map((a) => a.id);
  const d = fromTemplate(templateId);
  if (have.includes(d.id)) return d;
  await saveAgent(d, 'user');
  return d;
}

/* ---------------- 平台 ---------------- */
export async function listUserPlatforms(): Promise<PlatformManifest[]> {
  const v = await getVfs();
  return (await v.list('platforms')).filter((f) => /^platforms\/[^/]+\/PLATFORM\.md$/.test(f.path)).map((f) => parsePlatformMd(f.content));
}
export async function savePlatform(p: PlatformManifest, skill?: { path: string; content: string }): Promise<{ approval?: ApprovalItem }> {
  const existing = (await listUserPlatforms()).filter((x) => x.id !== p.id).map((x) => x.id);
  const errs = validatePlatform(p, { existing });
  if (errs.length) throw new Error(errs.join('；'));
  const v = await getVfs();
  await v.write(platformPath(p.id), serializePlatformMd(p), { author: 'user' });
  registerUserPlatforms([{ id: p.id, label: p.name, url: p.url, publishUrl: p.publishUrl, hosts: p.hosts, android: p.android, ios: p.ios }]);
  await audit({ kind: 'setting_change', actor: 'user', summary: `平台 ${p.name}（${p.id}）已保存`, target: platformPath(p.id) });
  let approval: ApprovalItem | undefined;
  if (skill) {
    approval = newApproval({ kind: 'platform_skill', from: SUPER_ID, why: `为新平台 ${p.name} 起草写法技能`, impact: `写入 ${skill.path}（写法只在技能里）`, estCost: null, preview: skill.content, payload: { action: 'platform_skill', path: skill.path } });
    await updateState((s) => ({ ...s, approvals: [...s.approvals, approval!] }));
  }
  emit();
  return { approval };
}

/* ---------------- 工作流 ---------------- */
export async function listWorkflows(): Promise<WorkflowDef[]> {
  const v = await getVfs();
  return (await v.list('workflows')).filter((f) => f.path.endsWith('.yaml')).map((f) => { try { return parseWorkflow(f.content); } catch { return null; } }).filter((x): x is WorkflowDef => !!x);
}
export async function saveWorkflow(w: WorkflowDef): Promise<void> {
  const v = await getVfs();
  await v.write(workflowPath(w.id), serializeWorkflow(w), { author: 'user' });
  emit();
}

/* ---------------- 审批 ---------------- */
export async function addApproval(a: Parameters<typeof newApproval>[0]): Promise<ApprovalItem> { const item = newApproval(a); await updateState((s) => ({ ...s, approvals: [...s.approvals, item] })); return item; }
/** 批准后的效果按 payload.action 执行；拒绝只记录。 */
export async function decide(id: string, act: ApprovalAction): Promise<ApprovalItem | null> {
  let item: ApprovalItem | null = null;
  await updateState((s) => { const r = resolveApproval(s.approvals, id, act); item = r.changed ? r.item : null; return { ...s, approvals: r.list }; });
  if (!item) return null;
  const it = item as ApprovalItem;
  await audit({ kind: 'approval', actor: 'user', summary: `${act.type === 'approve' ? '批准' : act.type === 'reject' ? '拒绝' : '修改后批准'}：${it.why}`, outcome: act.type === 'reject' ? 'denied' : 'ok', detail: { approvalId: it.id, kind: it.kind, from: it.from } });
  if (it.status !== 'approved') return it;
  const v = await getVfs();
  const p = (it.payload ?? {}) as Record<string, string | number | undefined>;
  if (p.action === 'create_agent' || p.action === 'agent_change') { const d = parseAgentMd(it.preview); await saveAgent(d, 'user_approved'); }
  else if (p.action === 'platform_skill' && typeof p.path === 'string') await v.write(p.path, it.preview, { author: 'user_approved', note: '新平台写法技能（审批通过）' });
  else if (p.action === 'core_file' && typeof p.path === 'string') await v.write(p.path, it.preview, { author: 'user_approved', note: '核心文件修订（审批通过）' });
  else if (p.action === 'spend' && typeof p.agentId === 'string') {
    const a = (await listAgents()).find((x) => x.id === p.agentId);
    if (a) await saveAgent({ ...a, budget: { ...a.budget, monthYuan: Math.round((a.budget.monthYuan + Number(p.raise ?? 1)) * 100) / 100 } });
    await updateState((s) => ({ ...s, pausedItems: s.pausedItems.filter((x) => x !== p.agentId) }));
  } else if (p.action === 'workflow_schedule' && typeof p.workflowId === 'string') {
    const w = (await listWorkflows()).find((x) => x.id === p.workflowId); if (w) await saveWorkflow({ ...w, enabled: true, scheduleApproved: true });
  } else if (p.action === 'enable_mcp' && typeof p.serverId === 'string') await updateState((s) => ({ ...s, mcpServers: s.mcpServers.map((m) => (m.id === p.serverId ? { ...m, approved: true, enabled: true } : m)) }));
  else if (p.action === 'enable_a2a' && typeof p.refId === 'string') await updateState((s) => ({ ...s, a2aAgents: s.a2aAgents.map((m) => (m.id === p.refId ? { ...m, approved: true, enabled: true } : m)) }));
  else if (p.action === 'workflow_node' && typeof p.workflowId === 'string') void resumeWorkflow(p.workflowId);
  emit();
  return it;
}

/* ---------------- 暂停 ---------------- */
export async function pauseAll(): Promise<{ cancelled: number; ms: number }> {
  const t0 = performance.now();
  pausedSync = true;
  const r = registry.pauseAll();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ca:pause-all'));
  const ms = Math.round(performance.now() - t0);
  await updateState((s) => ({ ...s, paused: true, pausedAt: new Date().toISOString(), mcpServers: s.mcpServers.map((m) => ({ ...m, enabled: false })) }));
  await audit({ ...r.audit, summary: `全部暂停：取消 ${r.cancelled.length} 个运行、停止定时工作流、断开外部工具（${ms} ms）` });
  return { cancelled: r.cancelled.length, ms };
}
export async function resumeAll(): Promise<void> {
  registry.resume(); pausedSync = false;
  await updateState((s) => ({ ...s, paused: false, pausedAt: undefined }));
  await audit({ kind: 'run_state', actor: 'user', summary: '手动恢复（全部暂停解除）', outcome: 'ok' });
}
export async function togglePauseItem(id: string, on: boolean): Promise<void> {
  if (on) registry.cancelAgent(id);
  await updateState((s) => ({ ...s, pausedItems: on ? [...new Set([...s.pausedItems, id])] : s.pausedItems.filter((x) => x !== id) }));
  await audit({ kind: 'run_state', actor: 'user', summary: `${on ? '暂停' : '恢复'}：${id}`, outcome: 'ok', detail: { id } });
}

/* ---------------- 子 Agent 执行器（与对话同一服务商） ---------------- */
async function provider() {
  const m = await getModels();
  const cfg = resolveProvider(m);
  if (!cfg) throw new Error('先接入一个模型，子 Agent 才能工作（我的 → 模型）');
  return cfg;
}
export function handoffPrompt(a: SubAgentDef, input: HandoffInput, feedback?: string): { system: string; user: string } {
  return {
    system: `你是子 Agent「${a.name}」（${a.id}），由超级 Agent 指挥，对超级 Agent 负责。\n${a.body}\n\n## 交接契约\n只输出一个 JSON 对象，不要其他文字：{"summary":"不超过 300 字","artifacts":["产出（文本或 id）"],"cost":0,"evidence":["依据"],"open_questions":[],"failures":[]}\n## 硬边界\n不发布、不点赞、不评论、不私信、不关注；回复只生成草稿；不编造数据。`,
    user: `${JSON.stringify({ goal: input.goal, context_refs: input.context_refs, constraints: input.constraints, budget: input.budget, deadline: input.deadline })}${feedback ? `\n\n上次被退回，修改意见：${feedback}` : ''}`,
  };
}
export async function executeAgent(a: SubAgentDef, input: HandoffInput, signal: AbortSignal, feedback?: string): Promise<string> {
  const cfg = await provider();
  const p = handoffPrompt(a, input, feedback);
  const out = await chat(cfg, [{ role: 'system', content: p.system }, { role: 'user', content: p.user }], { json: true, maxTokens: 900, timeoutMs: 60000 });
  if (signal.aborted) throw new Error('cancelled');
  const cost = costOf(cfg.id, out.model, out.usage);
  try { const j = JSON.parse(out.content.replace(/^```(?:json)?\s*|\s*```$/g, '')) as Record<string, unknown>; j.cost = cost; return JSON.stringify(j); } catch { return out.content; }
}
let orch: Orchestrator | null = null;
let stateCache: SuperState = emptySuperState();
export function orchestrator(): Orchestrator {
  if (orch) return orch;
  orch = new Orchestrator({
    registry, concurrency: 3,
    execute: (a, input, ctx) => executeAgent(a, input, ctx.signal, ctx.feedback),
    spentMonth: (id) => agentSpentMonth(stateCache, id),
    estimate: () => 0.01,
    isPaused: (id) => stateCache.pausedItems.includes(id),
    onTask: (t) => { void updateState((s) => ({ ...s, tasks: [...s.tasks.filter((x) => x.id !== t.id), t] })); },
    onSpend: (id, y) => { void updateState((s) => addAgentSpend(s, id, y)); },
  });
  return orch;
}
/** 超级 Agent 交给子 Agent：并发上限读控制平面；超额度 → 暂停该子 Agent 并进审批收件箱。 */
export async function delegate(agentId: string, goal: string, o: { title?: string; parentRunId?: string; context?: string[] } = {}): Promise<DelegateResult & { agent?: SubAgentDef }> {
  stateCache = await getState();
  const a = (await listAgents()).find((x) => x.id === agentId);
  if (!a) return { ok: false, reason: 'error', text: `没有这个子 Agent：${agentId}` };
  const o2 = orchestrator();
  (o2 as unknown as { o: { concurrency: number } }).o.concurrency = stateCache.concurrency;
  const r = await o2.delegate(a, { goal, context_refs: o.context ?? [], constraints: ['发布与互动由用户本人完成', '只用录入或导入的数据'], budget: a.budget.perRunYuan, deadline: null, output_schema: { type: 'object' } }, { agentId: SUPER_ID, depth: 1, runId: o.parentRunId, title: o.title });
  await updateState((s) => ({ ...s, stats: { ...s.stats, [a.id]: updateStats(s.stats[a.id], r) } }));
  if (!r.ok && r.reason === 'budget') {
    await togglePauseItem(a.id, true);
    await addApproval({ kind: 'spend', from: a.id, why: r.text, impact: `批准后 ${a.name} 本月额度 +¥1 并恢复运行`, estCost: 0.01, preview: `子 Agent：${a.name}\n本月已花：¥${agentSpentMonth(stateCache, a.id).toFixed(3)}\n额度：¥${a.budget.monthYuan}`, payload: { action: 'spend', agentId: a.id, raise: 1 } });
  }
  await audit({ kind: 'tool_call', actor: 'agent', tool: `delegate:${a.id}`, outcome: r.ok ? 'ok' : 'failed', summary: `超级 Agent 交给 ${a.name}：${r.ok ? r.output.summary.slice(0, 80) : r.text}`, cost: r.task?.cost, detail: { agentId: a.id, taskId: r.task?.id } });
  return { ...r, agent: a };
}
/** 对话里 @子Agent：交给它，回复写明“交给了谁、花了多少、结果在哪”。返回 true 表示已处理。 */
export async function handleMention(conversationId: number, text: string): Promise<boolean> {
  const m = parseMention(text, await listAgents());
  if (!m) return false;
  await addMessage({ conversationId, role: 'user', content: text } as never);
  const r = await delegate(m.agentId, m.rest, { title: m.rest.slice(0, 40) });
  const cost = r.task?.cost ?? 0;
  const body = r.ok
    ? `交给了「${m.name}」 · 花了 ¥${cost.toFixed(4)} · 结果在“指挥 → 任务板”\n\n${r.output.summary}${r.output.artifacts.length ? `\n\n${r.output.artifacts.map((x) => `- ${x}`).join('\n')}` : ''}${r.returned ? '\n\n（第一次不合格，已退回一次后通过）' : ''}`
    : `交给了「${m.name}」，没有完成：${r.text}${r.reason === 'budget' ? '\n已暂停这个子 Agent，并在“指挥 → 审批”里等你决定是否追加额度。' : ''}`;
  await addMessage({ conversationId, role: 'assistant', content: body, meta: { delegated: m.agentId, taskId: r.task?.id, cost } } as never);
  return true;
}

/* ---------------- 工作流执行 ---------------- */
async function superStep(goal: string, signal: AbortSignal): Promise<{ ok: boolean; output: string; cost?: number; error?: string }> {
  try {
    const cfg = await provider();
    const v = await getVfs();
    const duties = (await v.read('super/SUPER.md'))?.content ?? '';
    const out = await chat(cfg, [{ role: 'system', content: `你是超级 Agent。${duties.slice(0, 2000)}\n只输出结果正文。` }, { role: 'user', content: goal }], { maxTokens: 900, timeoutMs: 60000 });
    if (signal.aborted) return { ok: false, output: '', error: '已取消' };
    return { ok: true, output: out.content, cost: costOf(cfg.id, out.model, out.usage) };
  } catch (e) { return { ok: false, output: '', error: (e as Error).message }; }
}
export async function startWorkflow(id: string, prev?: WfRunState): Promise<WfRunState | null> {
  const w = (await listWorkflows()).find((x) => x.id === id);
  if (!w) return null;
  stateCache = await getState();
  if (stateCache.paused || stateCache.pausedItems.includes(id)) throw new Error(stateCache.paused ? '已全部暂停：恢复需你手动' : '这个工作流已暂停');
  const run = registry.register({ runId: `wf-${id}-${Date.now().toString(36)}`, agentId: SUPER_ID, kind: 'workflow' });
  const approvals = stateCache.approvals;
  try {
    const st = await runWorkflow(w, {
      signal: run.ctl.signal,
      runAgent: async (agentId, goal, _i, signal) => {
        if (agentId === SUPER_ID) return superStep(goal, signal);
        const r = await delegate(agentId, goal, { parentRunId: run.runId, title: `${w.name} · ${goal.split('\n')[0]!.slice(0, 30)}` });
        return r.ok ? { ok: true, output: [r.output.summary, ...r.output.artifacts].join('\n'), cost: r.task.cost } : { ok: false, output: '', error: r.text, cost: r.task?.cost };
      },
      approval: (node) => { const a = approvals.find((x) => (x.payload as { workflowId?: string; nodeId?: string })?.workflowId === id && (x.payload as { nodeId?: string })?.nodeId === node.id && x.createdAt >= (prev?.startedAt ?? '9')); return a ? (a.status === 'approved' ? 'approved' : a.status === 'rejected' ? 'rejected' : 'pending') : 'pending'; },
    }, prev);
    if (st.status === 'awaiting_user' && st.resumeAt && !approvals.some((x) => (x.payload as { nodeId?: string })?.nodeId === st.resumeAt && x.status === 'pending' && (x.payload as { workflowId?: string })?.workflowId === id)) {
      await addApproval({ kind: 'l3', from: SUPER_ID, why: `工作流「${w.name}」的审批节点`, impact: '批准后继续执行剩余步骤', estCost: null, preview: Object.entries(st.outputs).map(([k, v]) => `## ${k}\n${v}`).join('\n\n').slice(0, 4000) || '（无产出）', payload: { action: 'workflow_node', workflowId: id, nodeId: st.resumeAt } });
    }
    await updateState((s) => ({ ...s, wfRuns: { ...s.wfRuns, [id]: st }, wfLastRun: { ...s.wfLastRun, [id]: st.startedAt } }));
    await audit({ kind: 'run_state', actor: 'agent', summary: `工作流「${w.name}」：${st.status}（¥${st.cost.toFixed(4)}）`, outcome: st.status === 'failed' ? 'failed' : 'ok', cost: st.cost, detail: { workflowId: id } });
    return st;
  } finally { registry.done(run.runId); }
}
export async function resumeWorkflow(id: string): Promise<WfRunState | null> { const s = await getState(); const prev = s.wfRuns[id]; return startWorkflow(id, prev && (prev.status === 'awaiting_user' || prev.status === 'waiting') ? prev : undefined); }
/** App 打开时执行到期的定时工作流（关闭期间只靠本机提醒通知，点开再执行）。 */
export async function runDue(now = Date.now()): Promise<string[]> {
  const s = await getState(); if (s.paused) return [];
  const ids = dueSchedules(await listWorkflows(), s.wfLastRun, now).filter((id) => !s.pausedItems.includes(id));
  for (const id of ids) await startWorkflow(id).catch(() => undefined);
  return ids;
}
export async function fireEvent(ev: WfEvent): Promise<string[]> {
  const s = await getState(); if (s.paused) return [];
  const ids = eventWorkflows(await listWorkflows(), ev).filter((id) => !s.pausedItems.includes(id));
  for (const id of ids) void startWorkflow(id).catch(() => undefined);
  return ids;
}
export function startSuperScheduler(): () => void {
  const t = setInterval(() => void runDue().catch(() => undefined), 60000);
  const first = setTimeout(() => void runDue().catch(() => undefined), 5000);
  return () => { clearInterval(t); clearTimeout(first); };
}

/* ---------------- 概览（指挥条） ---------------- */
export interface Overview12 { running: number; pending: number; spentMonth: number; budget: number; paused: boolean; agents: number }
export async function overview(budget: number, spentMonth: number): Promise<Overview12> {
  const s = await getState();
  return { running: s.tasks.filter((t: BoardTask) => t.state === 'running').length + registry.running(), pending: pendingCount(s.approvals), spentMonth, budget, paused: s.paused, agents: (await listAgents()).filter((a) => a.enabled).length };
}
export async function teamPrompt(): Promise<string> { return teamSummary(await listAgents()); }
export { AGENT_TEMPLATES, findSecrets, makeAudit };
