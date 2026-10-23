/**
 * 评测夹具（12.2–12.4）：真实的 AgentRuntime + 真实的内置工具 + 真实的统一能力层（Mock 适配器，不联网）+ 内存存储；
 * 只有“对话模型”被回放脚本替换（ScriptedModel）：按顺序给出每次模型调用的回复，并核对调用目的（purpose）——不匹配即失败（说明流程变了）。
 * 这样评测检验的是运行时、工具、审批、幂等、自检、边界这些代码，而不是脚本里写好的话本身（见 deviations-v9 D-EVAL）。
 */
import {
  AgentRuntime, LockManager, memoryLockStore, memoryRunStore, createBuiltinTools, callRole, emptyModelsV3, addModelEntry, bindRole, configuredRoles, findEntry,
  Vfs, memoryVfsBackend, initVfs, assemblePrefix, validateProposal, proposalFile, proposeMemory, forget, searchMemory, computeAttribution, summarize, knownNumbers,
  validateRevenue, DEFAULT_LIMITS, readLimits, sha256, estimateCost, priceOf, loadSemiotics, routeSkill, skillMeta,
  type ModelInput, type ModelTurn, type ModelsStateV3, type RoleId, type ToolServices, type MediaRef, type DraftRef, type MemoryEntry, type RevenueRecord, type Proposal, type RuntimeEvent, type PendingItem, type CallDeps, type Limits, type SpendGuard, type SpendState,
} from '../shared/src/index.js';

export type ScriptTurn = { purpose?: ModelInput['purpose']; text?: string; tools?: { name: string; args: unknown }[]; error?: ModelTurn extends { ok: false; error: infer E } ? E : never; streamBroken?: boolean; abortAfter?: boolean; check?(i: ModelInput): string | null };
export class ScriptedModel {
  calls: ModelInput[] = [];
  private i = 0;
  mismatches: string[] = [];
  constructor(private script: ScriptTurn[], private fallback: (i: ModelInput) => ScriptTurn | null = () => null) {}
  port = async (input: ModelInput): Promise<ModelTurn> => {
    this.calls.push(input);
    let step = this.script[this.i];
    if (step && step.purpose && step.purpose !== input.purpose) { const fb = this.fallback(input); if (fb) step = fb; else { this.mismatches.push(`第 ${this.i + 1} 次模型调用：期望 ${step.purpose}，实际 ${input.purpose}`); this.i++; } }
    else if (!step) { const fb = this.fallback(input); if (!fb) { this.mismatches.push(`脚本用完：多出一次 ${input.purpose} 调用`); return { ok: true, text: '（脚本外）', toolCalls: [] }; } step = fb; }
    else this.i++;
    const c = step.check?.(input); if (c) this.mismatches.push(c);
    if (step.abortAfter) this.onAbort?.();
    if (step.error) return { ok: false, error: step.error };
    return { ok: true, text: step.text ?? '', toolCalls: (step.tools ?? []).map((t, k) => ({ id: `call_${this.calls.length}_${k}`, name: t.name, arguments: typeof t.args === 'string' ? t.args : JSON.stringify(t.args) })), streamBroken: step.streamBroken, cost: 0.001 };
  };
  onAbort?: () => void;
  get used(): number { return this.i; }
}

export interface HarnessOpts { contextWindow?: number; imageVendor?: string; roles?: Partial<Record<RoleId, string>>; online?: () => boolean; approve?: (p: PendingItem) => 'allow' | 'deny' | 'remember' | 'wait'; limits?: Partial<Limits>; flags?: { planner?: boolean; subtasks?: boolean }; mode?: 'native' | 'json'; spentToday?: number; spendGuard?: { guard: SpendGuard; state: SpendState }; autoLowRisk?: boolean }
export async function makeHarness(script: ScriptTurn[], o: HarnessOpts = {}, fallback?: (i: ModelInput) => ScriptTurn | null) {
  const vfs = new Vfs(memoryVfsBackend(), () => new Date('2026-10-23T07:33:00Z'));
  await initVfs(vfs);
  // 模型配置：默认全部角色走 Mock 账号；roles 里给的模型名可带 fail-401 等标记，或 'none' 表示未配置
  let state: ModelsStateV3 = emptyModelsV3();
  const acc = { id: 'mock', vendor: 'mock', label: '模拟', baseURL: 'mock://local', region: 'test' as const, models: [] as any[], hasKey: true };
  state.accounts.push(acc);
  const all: RoleId[] = ['chat', 'reason', 'fast', 'vision', 'image', 'imageEdit', 'tts', 'asr', 'video', 'embed', 'rerank'];
  if (o.imageVendor) state.accounts.push({ id: 'img', vendor: o.imageVendor, label: '另一家', baseURL: 'https://invalid.example/v1', region: 'cn', models: [], hasKey: true });
  for (const r of all) {
    const name = o.roles?.[r] ?? `mock-${r}`;
    if (name === 'none') continue;
    const e = addModelEntry(state.accounts.find((x) => x.id === (r === 'image' && o.imageVendor ? 'img' : 'mock'))!, { model: name, roles: [r] });
    if (e.ok) state = bindRole(state, r, 'primary', e.entry);
  }
  const usage: { role: RoleId; cost: number | null; ok: boolean; model: string }[] = [];
  const mediaStore = new Map<string, { ref: MediaRef; dataUrl: string }>();
  const drafts: DraftRef[] = [];
  const reminders: { id: string; text: string; at?: string; rrule?: string }[] = [];
  let memories: MemoryEntry[] = [];
  const memRules: string[] = [];
  const revenue: RevenueRecord[] = [];
  const proposals: Proposal[] = [];
  const events: RuntimeEvent[] = [];
  const ctl: { attr: ReturnType<typeof computeAttribution> | null } = { attr: null };
  const deps: CallDeps = { state, transport: { async send() { throw new Error('评测不联网'); } }, getKey: async () => '', sleep: async () => {}, random: () => 0.5, onUsage: (r) => { usage.push({ role: r.role, cost: r.cost, ok: r.ok, model: r.model }); } };
  let seq = 0;
  const services: ToolServices = {
    call: (role, req, c) => callRole(role, req, { ...deps, state }, { signal: c.signal, runId: c.runId, toolCallId: c.toolCallId, override: c.override ?? null }),
    estimate: (role, est) => { const e = findEntry(state, state.roles[role]?.primary?.modelEntryId ?? ''); return estimateCost(role, e ? priceOf(e.account.vendor, e.entry.model) : undefined, est); },
    configured: (role) => configuredRoles(state).includes(role),
    async saveMedia(items, meta) { return items.map((it) => { const id = `media-${++seq}`; const ref: MediaRef = { id, kind: meta.role === 'tts' ? 'audio' : meta.role === 'video' ? 'video' : 'image', mime: it.mime, model: meta.model, aiLabel: { explicit: meta.role === 'image' || meta.role === 'imageEdit', implicit: true } }; mediaStore.set(id, { ref, dataUrl: `data:${it.mime};base64,${it.base64 ?? ''}` }); return ref; }); },
    async getMedia(id) { const m = mediaStore.get(id); return m ? { dataUrl: m.dataUrl, mime: m.ref.mime } : null; },
    async writeDraft(i) {
      const r = await callRole('chat', { role: 'chat', messages: [{ role: 'user', content: `写稿：${i.topic}` }] }, { ...deps, state }, { signal: i.signal });
      if (!r.ok) return r.error;
      const d: DraftRef = { id: `draft-${++seq}`, platform: i.platform, title: i.topic.slice(0, 18), body: `（草稿）${i.topic}`, image_prompts: ['竖版 3:4 主图', '细节图', '对比图'], revenueHypothesis: { path: '笔记 → 收藏 → 关注 → 咨询', funnelLayer: '关注', metric: '收藏率', window: '7d', control: '近 30 天中位数' } };
      drafts.push(d); return d;
    },
    async listDrafts() { return drafts; },
    async deleteDrafts(ids) { let n = 0; for (const id of ids) { const k = drafts.findIndex((d) => d.id === id); if (k >= 0) { drafts.splice(k, 1); n++; } } return n; },
    async hot() { return { items: [{ id: 'hot-baidu-1', title: '馆陶小米丰收', url: 'https://top.baidu.com/board?tab=realtime', source: '百度热搜' }, { id: 'hot-baidu-2', title: '秋季养生', url: 'https://top.baidu.com/board?tab=realtime', source: '百度热搜' }], unavailable: [{ platform: '微博', reason: 'robots 不允许，没有合法来源' }, { platform: '小红书', reason: '没有公开热榜接口' }] }; },
    async addReminder(r) { const id = `rem-${++seq}`; reminders.push({ id, ...r }); return { id }; },
    async cancelReminder(t) { const k = reminders.findIndex((r) => r.id === t || r.text.includes(t)); if (k < 0) return 0; reminders.splice(k, 1); return 1; },
    async proposeMemory(text, o2) { const p = proposeMemory(text, { source: 'user_said', condition: o2.condition }); if (!p.ok) return { ok: false, reason: p.reason }; memories.push(p.entry); return { ok: true, path: 'memory/preferences.md' }; },
    async forgetMemory(q) { const hits = searchMemory(memories, q); const f = forget(memories, q, hits.map((h) => h.id)); memories = f.remaining; memRules.push(f.rule); return { removed: f.removed.length, verifyHits: f.verifyHits }; },
    async revenueSummary() { const attr = computeAttribution(revenue); const s = summarize(revenue, attr); return { total: s.total, count: s.count, text: s.count ? `共 ${s.count} 条收入，合计 ${s.total} 元` : '还没有收入数据' }; },
    async modelsStatus() { const c = configuredRoles(state); return Object.fromEntries(all.map((r) => [r, { configured: c.includes(r), model: state.roles[r]?.primary?.model }])); },
    async proposeSystemFile(target, after, reason) { const before = (await vfs.text(target)) ?? ''; const errs = validateProposal({ kind: target.startsWith('skills/') ? 'skill_version' : 'system_file', target, before, after }, proposals); if (errs.length) return { ok: false, errors: errs }; const p: Proposal = { id: `P-20261023-${sha256(after).slice(0, 6)}`, kind: target.startsWith('skills/') ? 'skill_version' : 'system_file', target, before, after, basedOn: [], evidenceLevel: 'user', status: 'pending', reason, createdAt: new Date().toISOString() }; proposals.push(p); await vfs.write(`workspace/proposals/${p.id.toLowerCase().replace(/^p-/, 'P-')}.md`, proposalFile(p), { author: 'system' }).catch(() => {}); return { ok: true, id: p.id }; },
    pollVideo: async (jobId) => { const { pollJob } = await import('../shared/src/index.js'); return pollJob(state.roles.video.primary!, jobId, { ...deps, state }); },
    async search(q) { return { mode: 'keyword', hits: drafts.filter((d) => d.title.includes(q.slice(0, 2))).map((d) => ({ id: d.id, title: d.title, score: 1 })) }; },
    now: () => new Date('2026-10-23T07:33:00Z'),
  };
  const tools = createBuiltinTools(services);
  const store = memoryRunStore();
  const model = new ScriptedModel(script, fallback);
  const locks = new LockManager(memoryLockStore(), 'eval', () => Date.now());
  const pendings: PendingItem[] = [];
  const limits: Limits = readLimits({ ...DEFAULT_LIMITS, ...o.limits, run: { ...DEFAULT_LIMITS.run, ...(o.limits?.run ?? {}) } });
  let runtimeRef: AgentRuntime | null = null;
  tools.add({ name: 'text_delegate', title: '子任务', description: '把可独立完成的一块交给子运行（深度 1）', level: 'L0', idempotent: true, inputSchema: { type: 'object', required: ['task'], properties: { task: { type: 'string' } } }, run: (a, ctx) => runtimeRef!.subtask({ id: ctx.runId, conversationId: ctx.conversationId }, String(a.task), ctx.signal) });
  const remembered: { tool: string; scope: string }[] = [];
  const runtime = new AgentRuntime({
    model: model.port, tools, store, locks, limits, flags: o.flags ?? { planner: false }, mode: o.mode ?? 'native',
    system: async ({ userText }) => { const files = Object.fromEntries((await vfs.list()).map((f) => [f.path, f.content])); const pre = assemblePrefix(files); const sem = loadSemiotics(files, userText); const skills = Object.entries(files).filter(([p]) => /^skills\/[^/]+\/SKILL\.md$/.test(p)).map(([p, c]) => skillMeta(p, c)!).filter(Boolean); const sk = routeSkill(userText, skills); lastSystem.semiotics = sem.loaded; lastSystem.skill = sk?.name ?? null; lastSystem.text = pre.text; return `${pre.text}${sem.loaded ? `\n\n${sem.text}` : ''}${sk ? `\n\n<!-- skill ${sk.name} -->\n${files[sk.path]}` : ''}`; },
    ask: async (p) => { pendings.push(p); const d = o.approve?.(p) ?? 'wait'; return d === 'wait' ? undefined : { decision: d }; },
    emit: (e) => { events.push(e); },
    online: o.online,
    spentToday: async () => o.spentToday ?? 0,
    ...(o.spendGuard ? { spendGuard: async () => o.spendGuard! } : {}),
    ...(o.autoLowRisk !== undefined ? { autoLowRisk: async () => o.autoLowRisk! } : {}),
    remembered: async () => remembered,
    remember: async (r) => { remembered.push(r); },
    knownNumbers: async () => knownNumbers(revenue, ctl.attr ?? computeAttribution(revenue)),
    systemTexts: async () => [((await vfs.text('SYSTEM.md')) ?? ''), ((await vfs.text('SOUL.md')) ?? '')],
    sleep: async () => {},
    contextWindow: o.contextWindow,
  });
  runtimeRef = runtime;
  const lastSystem: { semiotics: boolean; skill: string | null; text: string } = { semiotics: false, skill: null, text: '' };
  model.onAbort = () => { for (const r of store.runs.values()) runtime.cancel(r.id); };
  return { ctl, runtime, store, model, events, usage, mediaStore, drafts, reminders, get memories() { return memories; }, memRules, revenue, proposals, vfs, pendings, remembered, state: () => state, setState: (s: ModelsStateV3) => { state = s; }, services, tools, lastSystem, validateRevenue };
}
export type Harness = Awaited<ReturnType<typeof makeHarness>>;
export const replies = (h: Harness) => h.store.messages.filter((m) => m.role === 'assistant').map((m) => m.content);
export const cards = (h: Harness) => h.store.messages.filter((m) => m.role === 'card').map((m) => m.card!);
export const toolCalls = (h: Harness) => [...h.store.calls.values()];

/* ---------------- 报告 ---------------- */
export interface EvalResult { id: string; title: string; pass: boolean; failures: string[]; evidence: string; mode: 'replay'; judged: 'rule' | 'rule+code'; note?: string }
export const RESULTS: EvalResult[] = [];
