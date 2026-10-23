/**
 * 0.9.0 Agent 运行时的本机接线（ADR-005）：shared AgentRuntime + IndexedDB 存储 + VFS 系统文件 + 0.8 工具（包装）+ 0.9 多模态工具 + 统一能力层。
 * 对外暴露与 0.8 runTurn 相同的事件接口（message / delta / card / confirm / done / mode），AgentPanel 不用改交互；
 * 0.11.0：agent.runtime.v9 开关已到期移除，0.8 循环已删除，这是唯一的对话运行时（ADR-005 重审）。
 */
import { syncNativeSchedule } from './reminders';
import { type RoleRequest,
  AgentRuntime, LockManager, ToolRegistry, callError, createBuiltinTools, assemblePrefix, loadSemiotics, routeSkill, skillMeta, skillsDirectory, readLimits, flagOn, redact, findSecrets,
  proposeMemory as ruleProposeMemory, searchMemory, forget, computeAttribution, summarize, knownNumbers, validateProposal, proposalFile, bm25Search, hybridSearch, configuredRoles, ROLE_IDS, sha256,
  type RunStore, type RunRecord, type ToolCallRecord, type LockStore, type LockRecord, type ModelPort, type ModelTurn, type ToolServices, type ChatMessage, type ToolSpec as V9Tool, type MemoryEntry, type RevenueRecord, type Proposal, type CardSpec, type PendingItem,
} from '@content-agent/shared';
import { db, type Row } from '../local/db';
import { getModels, getModelsV3, getPrefs, resolveProvider, upsertProvider } from '../local/store';
import { costOf, ModelError, type ProviderConfig } from '../local/llm';
import { chatAgent, ToolsUnsupportedError, type AgentMsg } from '../agent/model';
import { TOOLS, ToolError, type ToolSpec as OldTool } from '../agent/tools';
import { addMessage, addTaskStep, finishTask, getProfile, listMessages, profileText, startTask, updateMessage, type CardData, type StoredMsg } from '../agent/store';
import type { AgentEvent, TraceStep, TurnOpts } from '../agent/events';
import { center } from '../data/platforms';
import { jsonModeRules } from '../agent/prompts';
import { getVfs, vfsFiles } from './vfsBackend';
import { call, estimate, isRoleConfigured, poll, saveMedia, getMedia, flags } from './models';
import { audit, recordUsage } from './ops';

/* ---------------- 存储 ---------------- */
const RUN_KV = (id: string) => `run:${id}`;
const runStore = (onMsg: (m: StoredMsg) => void, ctx: { streamId: number | null; cardMsgs: Map<string, number> }): RunStore => ({
  async saveRun(r) { const rows = (await db.all('runs')).filter((x) => x.runId === r.id); const row = { runId: r.id, conversationId: r.conversationId, state: r.state, record: redactRun(r) }; if (rows[0]) await db.update('runs', rows[0].id, row); else await db.insert('runs', row); await db.setKV(RUN_KV(r.id), redactRun(r)); },
  async getRun(id) { return (await db.getKV<RunRecord>(RUN_KV(id))) ?? undefined; },
  async saveToolCall(t) { const rows = (await db.all('toolcalls')).filter((x) => x.idemKey === t.idemKey); const row = { ...t, args: JSON.parse(redact(JSON.stringify(t.args ?? null))) } as unknown as Record<string, unknown>; if (rows[0]) await db.update('toolcalls', rows[0].id, row); else await db.insert('toolcalls', row); },
  async findToolCall(k) { return ((await db.all('toolcalls')).find((x) => x.idemKey === k) as unknown as ToolCallRecord | undefined); },
  async appendMessage(m) {
    if (m.role === 'user') return;   // 用户消息由 runTurnV9 先行入库（立即显示）
    if (m.role === 'card' && m.card) {
      const step = (m.meta?.stepId as string | undefined) ?? '';
      const failed = m.meta?.ok === false && !['image', 'audio', 'video', 'not_configured'].includes(m.card.type);
      const card: CardData = { type: m.card.type, tool: m.content, status: failed ? 'error' : 'done', data: m.card.data, ...(failed ? { error: { reason: String(m.card.data.reason ?? '没有成功'), advice: String(m.card.data.advice ?? '') } } : {}) };
      const mid = ctx.cardMsgs.get(`${m.runId}:${step}`);
      if (mid) { await updateMessage(mid, { cards: [card] }); onMsg({ ...(await msgById(mid))!, cards: [card] }); return; }
      const row = await addMessage({ conversationId: m.conversationId, role: 'assistant', content: '', cards: [card], meta: { runId: m.runId, v9: true } });
      onMsg(row); return;
    }
    const content = m.content;
    if (ctx.streamId) { await updateMessage(ctx.streamId, { content, meta: { runId: m.runId, v9: true, ...(m.meta ?? {}), streaming: false } }); onMsg({ ...(await msgById(ctx.streamId))! }); ctx.streamId = null; return; }
    const row = await addMessage({ conversationId: m.conversationId, role: 'assistant', content, meta: { runId: m.runId, v9: true, ...(m.meta ?? {}), ...(m.meta?.error ? { error: true } : {}) } });
    onMsg(row);
  },
  async getConstraints(cid) { return (await db.getKV<string[]>(`constraints:${cid}`)) ?? []; },
  async addConstraint(cid, c) { const l = (await db.getKV<string[]>(`constraints:${cid}`)) ?? []; if (!l.includes(c)) await db.setKV(`constraints:${cid}`, [...l, c].slice(-30)); },
  async history(cid) {
    return (await listMessages(cid)).filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content && !m.meta?.toolResult && !m.meta?.system).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  },
});
const msgById = async (id: number) => (await db.get('messages', id)) as unknown as StoredMsg | undefined;
function redactRun(r: RunRecord): RunRecord { return JSON.parse(redact(JSON.stringify(r))); }
export const idbLockStore: LockStore = {
  async get(cid) { return (await db.all('locks')).find((x) => x.conversationId === cid) as unknown as LockRecord | undefined; },
  async put(r) { const cur = (await db.all('locks')).find((x) => x.conversationId === r.conversationId); if (cur) await db.update('locks', cur.id, r as unknown as Record<string, unknown>); else await db.insert('locks', r as unknown as Record<string, unknown>); },
  async del(cid) { const cur = (await db.all('locks')).find((x) => x.conversationId === cid); if (cur) await db.del('locks', cur.id); },
  async all() { return (await db.all('locks')) as unknown as LockRecord[]; },
};
const locks = new LockManager(idbLockStore, `tab-${Math.random().toString(36).slice(2, 8)}`);

/* ---------------- 0.8 工具包装为 0.9 工具 ---------------- */
function wrapOld(t: OldTool): V9Tool {
  return {
    name: t.name, title: t.label, description: t.description, inputSchema: t.parameters, level: t.level, idempotent: t.level !== 'L2' && !/revise|record|update/.test(t.name),
    userOnly: t.userOnly, noSubtask: t.level === 'L2' || t.name === 'browser_open' || t.name === 'publish_prepare',
    needsConfirm: t.needsConfirm ? (a) => t.needsConfirm!(a as Record<string, unknown>) : undefined,
    async run(args, ctx) {
      try {
        const cfg = await currentCfg();
        const out = await t.run(args, { conversationId: ctx.conversationId, cfg, signal: ctx.signal, userText: ctx.userText });
        return { ok: true, result: out.result, card: out.card ? { type: out.card.type, data: (out.card as { data?: Record<string, unknown> }).data ?? {} } : undefined };
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e;
        const reason = e instanceof ToolError ? e.reason : e instanceof ModelError ? e.reason : (e as Error)?.message ?? String(e);
        const advice = e instanceof ToolError ? e.advice : e instanceof ModelError ? e.advice : '';
        return { ok: false, error: { kind: e instanceof ModelError ? (e.kind === 'key' ? 'key_invalid' : e.kind === 'timeout' ? 'timeout' : 'unknown') : 'unknown', reason, advice, retriable: false } as never };
      }
    },
  };
}
let pick: { providerId?: string | null; model?: string | null } | undefined;
// 0.11.0：本轮调用方给的 cfg 优先（与 0.8 runTurn 一致：会话内切换模型立即生效），没有时按 pick 从已保存的模型里解析
let turnCfg: ProviderConfig | null = null;
async function currentCfg(): Promise<ProviderConfig | null> { return turnCfg ?? resolveProvider(await getModels(), pick); }

/* ---------------- 工具服务（本机实现） ---------------- */
const services: ToolServices = {
  call: (role, req, o) => call(role, req, { signal: o.signal, runId: o.runId, toolCallId: o.toolCallId, conversationId: o.conversationId, override: o.override ?? null, task: o.task }),
  estimate: () => null,
  configured: () => true,
  async saveMedia(items, meta) { const rows = await saveMedia(items, meta); return rows.map((r) => ({ id: `media-${r.id}`, kind: r.kind, mime: r.mime, model: r.model, aiLabel: r.aiLabel })); },
  async getMedia(id) { const m = await getMedia(id); return m ? { dataUrl: m.dataUrl, mime: m.mime } : null; },
  async writeDraft() { return { kind: 'unknown', reason: '写稿由 draft_write 工具完成', retriable: false } as never; },
  async listDrafts() { return (await db.all('drafts')).map((d) => ({ id: String(d.id), platform: String(d.platform ?? ''), title: String(d.title ?? ''), body: String(d.body ?? '') })); },
  async deleteDrafts(ids) { let n = 0; for (const id of ids) { const row = await db.get('drafts', Number(id)); if (row) { await db.del('drafts', row.id); n++; } } await audit({ kind: 'tool_call', actor: 'user', summary: `删除草稿 ${n} 篇（已确认）`, tool: 'drafts_delete', outcome: 'ok' }); return n; },
  async hot() { return { items: [], unavailable: [] }; },
  async addReminder(r) { const row = await db.insert('reminders', { ...r, status: 'scheduled' }); window.dispatchEvent(new CustomEvent('ca:reminders')); void syncNativeSchedule().catch(() => undefined); return { id: `rem-${row.id}` }; },
  async cancelReminder(t) { const rows = await db.all('reminders'); const hit = rows.find((x) => `rem-${x.id}` === t || String(x.text ?? '').includes(t)); if (!hit) return 0; await db.update('reminders', hit.id, { status: 'cancelled' }); void syncNativeSchedule().catch(() => undefined); return 1; },
  async proposeMemory(text, o) {
    const p = ruleProposeMemory(text, { source: 'user_said', condition: o.condition });
    if (!p.ok) return { ok: false, reason: p.reason };
    const banned = ((await db.getKV<string[]>('memory.dontRemember')) ?? []).some((b) => text.includes(b));
    if (banned) return { ok: false, reason: '你之前要求不要记住这类信息' };
    await db.insert('memories', p.entry as unknown as Record<string, unknown>);
    const v = await getVfs(); const cur = (await v.text('memory/preferences.md')) ?? '# 偏好\n';
    await v.write('memory/preferences.md', `${cur.replace(/\s*$/, '')}\n- ${p.entry.text}${p.entry.condition ? `（条件：${p.entry.condition}）` : ''}（来源：你说的，${p.entry.createdAt.slice(0, 10)}）\n`, { author: 'user_approved', note: 'memory_propose' });
    await audit({ kind: 'memory_change', actor: 'user', summary: `记住：${p.entry.text}`, outcome: 'ok' });
    return { ok: true, path: 'memory/preferences.md' };
  },
  async forgetMemory(q) {
    const list = (await db.all('memories')) as unknown as (MemoryEntry & { id: string; _row?: number })[];
    const rows = await db.all('memories');
    const hits = searchMemory(rows as unknown as MemoryEntry[], q);
    const f = forget(rows as unknown as MemoryEntry[], q, hits.map((h) => h.id));
    for (const h of hits) { const row = rows.find((r) => (r as unknown as MemoryEntry).id === h.id); if (row) await db.del('memories', row.id); }
    const v = await getVfs();
    for (const p of ['memory/preferences.md', 'MEMORY.md']) {
      const cur = await v.text(p); if (!cur) continue;
      const kept = cur.split('\n').filter((l) => !(l.startsWith('- ') && hits.some((h) => l.includes(h.text.slice(0, 12)))));
      if (kept.length !== cur.split('\n').length) await v.write(p, kept.join('\n'), { author: 'user_approved', note: 'forget' });
    }
    const mem = (await v.text('MEMORY.md')) ?? '';
    await v.write('MEMORY.md', `${mem.replace(/\s*$/, '')}\n${f.rule}\n`, { author: 'user_approved', note: 'dont remember rule' }).catch(() => {});
    const dont = (await db.getKV<string[]>('memory.dontRemember')) ?? [];
    await db.setKV('memory.dontRemember', [...dont, q.replace(/^(忘掉|忘记)(我)?/, '')]);
    await audit({ kind: 'memory_change', actor: 'user', summary: `忘掉：${q}（删除 ${f.removed.length} 条，复查命中 ${f.verifyHits}）`, outcome: 'ok' });
    void list;
    return { removed: f.removed.length, verifyHits: f.verifyHits };
  },
  async revenueSummary() { const rev = (await db.all('revenue')) as unknown as RevenueRecord[]; const s = summarize(rev, computeAttribution(rev)); return { total: s.total, count: s.count, text: s.count ? `共 ${s.count} 条收入，合计 ${s.total} 元（来源：你录入或导入的记录）` : '还没有收入数据' }; },
  async modelsStatus() { const s = await getModelsV3(); const c = configuredRoles(s); return Object.fromEntries(ROLE_IDS.map((r) => [r, { configured: c.includes(r), model: s.roles[r]?.primary?.model }])); },
  async proposeSystemFile(target, after, reason) {
    const v = await getVfs(); const before = (await v.text(target)) ?? '';
    const hist = (await db.all('proposals')) as unknown as Proposal[];
    const kind = target.startsWith('skills/') ? 'skill_version' as const : 'system_file' as const;
    const errs = validateProposal({ kind, target, before, after }, hist);
    if (findSecrets(after).length) errs.push('内容里有疑似密钥');
    if (errs.length) return { ok: false, errors: errs };
    const p: Proposal = { id: `P-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${sha256(after).slice(0, 6)}`, kind, target, before, after, basedOn: [], evidenceLevel: 'user', status: 'pending', reason, createdAt: new Date().toISOString() };
    await db.insert('proposals', p as unknown as Record<string, unknown>);
    await v.write(`workspace/proposals/${p.id}.md`, proposalFile(p), { author: 'system' }).catch(() => {});
    await audit({ kind: 'system_file_change', actor: 'agent', summary: `提议修改 ${target}（待你确认）`, target, outcome: 'pending' });
    return { ok: true, id: p.id };
  },
  pollVideo: async (jobId, signal) => { const s = await getModelsV3(); return poll(s.roles.video.primary!, jobId, signal); },
  async search(q, _scope, k) {
    const docs = [...(await db.all('drafts')).map((d) => ({ path: `draft:${d.id}`, text: `${d.title ?? ''} ${d.body ?? ''}` })), ...Object.entries(await vfsFiles()).filter(([p]) => p.startsWith('memory/')).map(([path, text]) => ({ path, text }))];
    // 0.11.0：search.vector（beta）打开时用 BM25 + 向量混合；接了 embed 角色就用它，没接用本机轻量嵌入；向量失败退回关键词并如实标注
    if (flagOn('search.vector', await flags())) {
      const embed = (await isRoleConfigured('embed')) ? async (texts: string[]) => { const r = await call('embed', { role: 'embed', input: texts } as RoleRequest, {}); if (!r.ok || r.value.type !== 'vectors') throw new Error('embed 失败'); return r.value.vectors; } : undefined;
      const r = await hybridSearch(docs, q, { k, embed });
      return { mode: r.mode === 'keyword-fallback' ? 'keyword' : 'vector', hits: r.hits.map((h) => ({ id: h.path, title: h.snippet, score: h.score })) };
    }
    return { mode: 'keyword', hits: bm25Search(docs, q, { k }).map((h) => ({ id: h.path, title: h.snippet, score: h.score })) };
  },
  now: () => new Date(),
};
// 运行时用的“已配置 / 估算”是异步的，这里在每轮开始前刷新一次快照
let configuredSnap = new Set<string>();
let estimateSnap = new Map<string, number | null>();
services.configured = (r) => configuredSnap.has(r);
services.estimate = (r) => (estimateSnap.has(r) ? estimateSnap.get(r)! : null);
async function refreshSnapshots(): Promise<void> {
  configuredSnap = new Set((await Promise.all(ROLE_IDS.map(async (r) => ((await isRoleConfigured(r)) ? r : null)))).filter(Boolean) as string[]);
  estimateSnap = new Map(await Promise.all(ROLE_IDS.map(async (r) => [r, await estimate(r, { images: 1, chars: 1000, seconds: 5 })] as const)));
}

const SKIP_BUILTIN = new Set(['draft_write', 'publish_check', 'hot_list']);
function buildTools(runtimeRef: { current: AgentRuntime | null }) {
  const reg = createBuiltinTools(services);
  const out = new ToolRegistry();
  for (const t of TOOLS) out.add(wrapOld(t));
  for (const t of reg.list()) if (!SKIP_BUILTIN.has(t.name) && !out.has(t.name)) out.add(t);
  out.add({ name: 'text_delegate', title: '子任务', description: '把一块可以独立完成的工作（如整理多个平台的热点）交给子运行，只回传摘要与产物', level: 'L0', idempotent: true, inputSchema: { type: 'object', required: ['task'], properties: { task: { type: 'string', minLength: 2 } } }, run: (a, ctx) => runtimeRef.current!.subtask({ id: ctx.runId, conversationId: ctx.conversationId }, String(a.task), ctx.signal) });
  return out;
}

/* ---------------- 上下文（系统文件 + 画像） ---------------- */
async function systemPrompt(userText: string, jsonTools?: { name: string; description: string; parameters: unknown }[]): Promise<{ text: string; semiotics: boolean; skill: string | null }> {
  const files = await vfsFiles();
  const skills = Object.entries(files).filter(([p]) => /^skills\/[^/]+\/SKILL\.md$/.test(p)).map(([p, c]) => skillMeta(p, c)).filter((x): x is NonNullable<typeof x> => !!x);
  files['skills/SKILLS.md'] = skillsDirectory(skills);
  const pre = assemblePrefix(files);
  const sem = loadSemiotics(files, userText);
  const sk = routeSkill(userText, skills);
  const prefs = await getPrefs();
  const profile = profileText(await getProfile());
  const now = new Date();
  const tail = [
    sem.loaded ? `\n<!-- 按需加载：semiotics -->\n${sem.text}` : '',
    sk ? `\n<!-- 已选技能：${sk.name}（可在卡片上更换） -->\n${files[sk.path]}` : '',
    profile ? `\n## 账号画像（用户本人一个账号）\n${profile}` : '',
    prefs.platforms.length ? `\n## 用户放进工作台的平台\n${prefs.platforms.map((p) => center(p)?.label ?? p).join('、')}` : '',
    `\n## 现在\n北京时间 ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`,
    jsonTools ? `\n## 工具调用（兼容模式）\n${jsonModeRules(jsonTools)}` : '',
  ].join('');
  return { text: pre.text + tail, semiotics: sem.loaded, skill: sk?.name ?? null };
}

/* ---------------- 对话模型端口（流式 → 界面） ---------------- */
export const ROUTED_PURPOSES: string[] = ['compress', 'plan', 'repair', 'judge'];
function modelPort(ui: { onEvent: (e: AgentEvent) => void; conversationId: number; ctx: { streamId: number | null }; runId: () => string; call?: typeof chatAgent; trace?: TraceStep[]; jsonTools?: () => { name: string; description: string; parameters: unknown }[] }): ModelPort {
  return async (i): Promise<ModelTurn> => {
    const cfg = await currentCfg();
    if (!cfg) return { ok: false, error: { kind: 'role_not_configured', reason: '还没接文本对话模型', advice: '到“我的 → 模型”接一个文本模型', retriable: false, actions: ['configure'] } };
    let msgs: AgentMsg[] = i.messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '')).join(''), ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}), ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}) }));
    const visible = i.purpose === 'turn' || i.purpose === 'summary';
    // 0.11.0：运行中途从原生工具切到 JSON 指令模式时，系统提示里补上 JSON 指令规则（之前只在开局按 toolMode 生成，切换后模型不知道格式）
    if (i.purpose === 'turn' && i.mode === 'json' && ui.jsonTools && msgs[0]?.role === 'system' && !msgs[0].content.includes('JSON 指令')) msgs = [{ ...msgs[0], content: `${msgs[0].content}\n\n## 工具调用（兼容模式）\n${jsonModeRules(ui.jsonTools())}` }, ...msgs.slice(1)];
    // 0.10.0 按任务路由：压缩 / 规划 / 参数修复 / 判官这类后台调用，若在“我的 → 模型 → 高级：按任务路由”给 chat 指定了模型，就走统一能力层的那个模型；失败时回到对话模型
    if (!visible && ROUTED_PURPOSES.includes(i.purpose)) {
      const tt = (await getModelsV3()).roles.chat?.tasks?.[i.purpose];
      if (tt) {
        const r = await call('chat', { role: 'chat', messages: msgs.filter((m) => m.role !== 'tool' && !m.tool_calls).map((m) => ({ role: m.role, content: m.content })), maxTokens: 1500, json: i.mode === 'json' } as RoleRequest, { task: i.purpose, signal: i.signal, runId: ui.runId(), conversationId: ui.conversationId });
        if (r.ok && r.value.type === 'text') return { ok: true, text: r.value.text, toolCalls: [], cost: r.cost, model: r.target.model, respondedModel: r.respondedModel };
      }
    }
    if (visible && !ui.ctx.streamId) { const row = await addMessage({ conversationId: ui.conversationId, role: 'assistant', content: '', model: `${cfg.label} · ${cfg.model}`, meta: { streaming: true, v9: true, runId: ui.runId() } }); ui.ctx.streamId = row.id; ui.onEvent({ type: 'message', msg: row }); }
    const sid = ui.ctx.streamId;
    let acc = '';
    const t0 = Date.now();
    try {
      const reply = await (ui.call ?? chatAgent)(cfg, msgs, { tools: i.tools as never, stream: visible, signal: i.signal, maxTokens: i.purpose === 'compress' || i.purpose === 'repair' ? 1500 : 4096, thinking: false, onDelta: (d) => { acc += d.content; if (visible && sid) ui.onEvent({ type: 'delta', id: sid, content: d.content, reasoning: d.reasoning }); } });
      const cost = costOf(cfg.id, cfg.model, reply.usage);
      // 0.11.0：0.8 循环删除后，trace（B5）与 toolMode 记忆由 v9 接线负责
      ui.trace?.push({ kind: 'model', ms: reply.ms ?? Date.now() - t0, usage: { input: reply.usage.input ?? 0, output: reply.usage.output ?? 0, ...(reply.usage.cached != null ? { cached: reply.usage.cached } : {}) }, streamed: reply.streamed, chunks: reply.chunks, content: reply.content.slice(0, 400), mode: i.mode ?? 'native' });
      if (i.tools && cfg.toolMode === undefined && i.mode !== 'json') { await upsertProvider({ ...cfg, toolMode: 'native' }).catch(() => {}); turnCfg = turnCfg ? { ...turnCfg, toolMode: 'native' } : null; }
      // 消息标注“服务 · 实际返回的模型名”
      if (visible && sid && reply.model && reply.model !== cfg.model) await updateMessage(sid, { model: `${cfg.label} · ${reply.model}` });
      await recordUsage({ at: new Date().toISOString(), role: 'chat', vendor: cfg.id, model: cfg.model, requestedModel: cfg.model, respondedModel: reply.model, usage: reply.usage, cost, ms: reply.ms, ok: true, runId: ui.runId(), conversationId: ui.conversationId });
      if (visible && sid && reply.toolCalls.some((t) => t.name)) {
        // 这一轮是“调用工具”：把模型顺带说的话留在这条消息里，下一轮另起一条
        if (reply.content.trim()) { await updateMessage(sid, { content: reply.content, meta: { streaming: false, v9: true } }); ui.onEvent({ type: 'message', msg: { ...(await msgById(sid))! } }); }
        else { await updateMessage(sid, { meta: { hidden: true, v9: true, streaming: false } }); ui.onEvent({ type: 'message', msg: { ...(await msgById(sid))!, meta: { hidden: true } } }); }
        ui.ctx.streamId = null;
      }
      return { ok: true, text: reply.content, toolCalls: reply.toolCalls.filter((t) => t.name), reasoning: reply.reasoning, cost, model: cfg.model, respondedModel: reply.model };
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        // 停止：已收到的内容保留并标注“已停止”
        if (visible && sid) { await updateMessage(sid, { content: acc, stopped: true, meta: { streaming: false, v9: true, runId: ui.runId() } }); ui.onEvent({ type: 'message', msg: { ...(await msgById(sid))! } }); ui.ctx.streamId = null; }
        return { ok: false, error: callError('aborted') };
      }
      if (e instanceof ToolsUnsupportedError) { await upsertProvider({ ...cfg, toolMode: 'json' }).catch(() => {}); turnCfg = turnCfg ? { ...turnCfg, toolMode: 'json' } : null; ui.trace?.push({ kind: 'model', ms: Date.now() - t0, error: 'tools_unsupported', mode: 'native' }); ui.onEvent({ type: 'mode', toolMode: 'json' }); return { ok: false, error: callError('tools_unsupported') }; }
      ui.trace?.push({ kind: 'model', ms: Date.now() - t0, error: String((e as Error)?.message ?? e).slice(0, 200) });
      const me = e instanceof ModelError ? e : null;
      await recordUsage({ at: new Date().toISOString(), role: 'chat', vendor: cfg.id, model: cfg.model, requestedModel: cfg.model, usage: {}, cost: 0, ms: 0, ok: false, errorKind: me?.kind ?? 'unknown', runId: ui.runId() });
      const kind = me?.kind === 'key' ? 'key_invalid' : me?.kind === 'quota' ? 'quota' : me?.kind === 'timeout' ? 'timeout' : me?.kind === 'network' ? 'network' : me?.kind === 'cors' ? 'cors' : me?.kind === 'model' ? 'model_not_found' : 'server';
      return { ok: false, error: { kind, reason: me?.reason ?? String((e as Error)?.message ?? e), advice: me?.advice ?? '稍后重试', retriable: kind === 'timeout' || kind === 'server' || kind === 'network', actions: kind === 'key_invalid' ? ['fix_key', 'configure'] : kind === 'quota' ? ['topup', 'switch_model'] : ['retry'] } as never };
    }
  };
}

/* ---------------- 对外：与 0.8 runTurn 同形 ---------------- */
let current: AgentRuntime | null = null;
export async function runTurnV9(o: TurnOpts & { pick?: { providerId?: string | null; model?: string | null }; override?: Record<string, { accountId: string; modelEntryId: string; model: string }>; overrideLabels?: string[] }): Promise<void> {
  pick = o.pick ?? { providerId: o.cfg.id, model: o.cfg.model };
  turnCfg = o.cfg ?? null;
  await refreshSnapshots();
  const f = await flags();
  const userMsg = await addMessage({ conversationId: o.conversationId, role: 'user', content: o.text, ...(o.overrideLabels?.length ? { meta: { atOverride: o.overrideLabels } } : {}) });
  o.onEvent({ type: 'message', msg: userMsg });
  const ctx = { streamId: null as number | null, cardMsgs: new Map<string, number>() };
  let runId = '';
  const store = runStore((m) => o.onEvent({ type: 'message', msg: m }), ctx);
  const ref: { current: AgentRuntime | null } = { current: null };
  const tools = buildTools(ref);
  const taskSteps: { name: string; tool: string; status: 'done' | 'failed'; summary: string }[] = [];
  const flushTask = async (status: 'done' | 'stopped' | 'failed') => { if (!taskSteps.length) return; const t = await startTask(o.conversationId, o.text); for (const st of taskSteps) await addTaskStep(t.id, st); await finishTask(t.id, status); };
  const vfs = await getVfs();
  const limits = readLimits(JSON.parse((await vfs.text('config/limits.json')) ?? '{}'));
  const prefsAny = (await getPrefs()) as unknown as { spend?: { perCallConfirmYuan: number; perDayConfirmYuan: number } };
  if (prefsAny.spend) limits.budget = { ...limits.budget, ...prefsAny.spend };
  const rt = new AgentRuntime({
    model: modelPort({ onEvent: o.onEvent, conversationId: o.conversationId, ctx, runId: () => runId, call: o.call, trace: o.trace, jsonTools: () => tools.list().filter((t) => !t.userOnly).map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema })) }),
    tools, store, locks, limits, mode: o.cfg.toolMode === 'json' ? 'json' : 'native',
    flags: { planner: flagOn('agent.planner', f), subtasks: flagOn('agent.subtasks', f) },
    contextWindow: 64000,
    system: async ({ userText }) => (await systemPrompt(userText, o.cfg.toolMode === 'json' ? tools.list().filter((t) => !t.userOnly).map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema })) : undefined)).text,
    ask: (p: PendingItem) => new Promise((resolve) => {
      o.onEvent({ type: 'confirm', tool: p.tool ?? '', label: p.text, args: p.args, resolve: (d) => { void audit({ kind: 'approval', actor: 'user', summary: `${p.text} → ${d === 'deny' ? '拒绝' : d === 'remember' ? '允许并记住此类' : '允许'}`, tool: p.tool, cost: p.estCost ?? undefined, runId, outcome: d === 'deny' ? 'denied' : 'ok' }); resolve({ decision: d }); } });
    }),
    emit: (e) => {
      if (e.type === 'state' && !runId) runId = e.runId;
      if (e.type === 'tool' && e.status === 'running') void (async () => { const row = await addMessage({ conversationId: o.conversationId, role: 'assistant', content: '', cards: [{ type: 'tool', tool: e.tool, status: 'running' }], meta: { runId: e.runId, v9: true } }); ctx.cardMsgs.set(`${e.runId}:${e.stepId}`, row.id); o.onEvent({ type: 'message', msg: row }); })();
      if (e.type === 'tool' && (e.status === 'ok' || e.status === 'failed')) {
        const out = e.output;
        o.trace?.push({ kind: 'tool', name: e.tool, args: e.args, ms: e.ms ?? 0, ...(out?.ok ? { result: out.result } : { error: out && !out.ok ? out.error.reason : '失败' }) });
        // 0.8 任务检查点（tasks 表）继续写，task_resume 工具在 v9 上照常可用
        taskSteps.push({ name: e.tool, tool: e.tool, status: e.status === 'ok' ? 'done' : 'failed', summary: (out?.ok ? JSON.stringify(out.result ?? null) : out && !out.ok ? out.error.reason : '').slice(0, 200) });
      }
      if (e.type === 'tool' && (e.status === 'ok' || e.status === 'failed')) void audit({ kind: 'tool_call', actor: 'agent', summary: `${e.tool}：${e.status === 'ok' ? '成功' : `失败（${e.output && !e.output.ok ? e.output.error.reason : ''}）`}`, tool: e.tool, runId: e.runId, conversationId: o.conversationId, cost: e.output?.cost ?? undefined, outcome: e.status === 'ok' ? 'ok' : 'failed' });
      if (e.type === 'correction') void (async () => { const row = await addMessage({ conversationId: o.conversationId, role: 'assistant', content: e.text, meta: { correction: true, v9: true } }); o.onEvent({ type: 'message', msg: row }); })();
    },
    online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
    spentToday: async () => { const d = new Date().toISOString().slice(0, 10); return (await db.all('usage_log')).filter((r) => String(r.at ?? '').startsWith(d)).reduce((s, r) => s + Number(r.cost ?? 0), 0); },
    remembered: async () => (await db.getKV<{ tool: string; scope: string }[]>('approvals.remembered')) ?? [],
    remember: async (r) => { const l = (await db.getKV<{ tool: string; scope: string }[]>('approvals.remembered')) ?? []; await db.setKV('approvals.remembered', [...l, r]); },
    knownNumbers: async () => { const rev = (await db.all('revenue')) as unknown as RevenueRecord[]; return knownNumbers(rev, computeAttribution(rev)); },
    systemTexts: async () => { const fs = await vfsFiles(); return ['SYSTEM.md', 'SOUL.md', 'AGENTS.md', 'BOUNDARIES.md'].map((p) => fs[p] ?? ''); },
  });
  ref.current = rt; current = rt;
  const onAbort = () => { if (runId) rt.cancel(runId); };
  o.signal?.addEventListener('abort', onAbort, { once: true });
  const hb = setInterval(() => { if (runId) void locks.heartbeat(o.conversationId, runId); }, 5000);
  try {
    const r = await rt.send(o.conversationId, o.text, { fromQueue: true, ...(o.override ? { override: o.override } : {}) });   // 0.10.0：@ 指定只影响本轮
    if (r.status === 'queued') { o.onEvent({ type: 'done', error: `上一条还在处理，这条已排队（第 ${r.n} 条）` }); return; }
    if (r.status !== 'ran') { o.onEvent({ type: 'done' }); return; }
    const run = r.run;
    await audit({ kind: 'run_state', actor: 'system', summary: `运行结束：${run.state}${run.error ? `（${run.error.reason}）` : ''}，工具 ${run.toolCallCount} 次`, runId: run.id, conversationId: o.conversationId, outcome: run.state === 'done' ? 'ok' : run.state === 'cancelled' ? 'denied' : 'failed' });
    await flushTask(run.state === 'done' ? 'done' : run.state === 'cancelled' ? 'stopped' : 'failed').catch(() => {});
    o.onEvent({ type: 'done', stopped: run.state === 'cancelled', error: run.state === 'failed' ? run.error?.reason : undefined });
  } catch (e) {
    await flushTask('failed').catch(() => {});
    o.onEvent({ type: 'done', error: (e as Error)?.message ?? String(e) });
  } finally {
    clearInterval(hb);
    o.signal?.removeEventListener('abort', onAbort);
  }
}
export async function resumeRun(runId: string): Promise<boolean> { return !!(await current?.resume(runId)); }
export async function lastRuns(cid?: number): Promise<{ runId: string; state: string; conversationId: number }[]> { return (await db.all('runs')).filter((r: Row) => !cid || r.conversationId === cid).map((r) => ({ runId: String(r.runId), state: String(r.state), conversationId: Number(r.conversationId) })); }
export type { ChatMessage, CardSpec };
