/**
 * Agent 循环（0.8.0）：模型 → 工具 → 模型 … → 结束。
 * - 每轮最多 8 次工具调用、单次工具 60 秒超时、整轮 3 分钟上限；同一工具同一参数连续两次即停止并说明；
 * - 原生 tools 不被支持时自动切换为 JSON 指令模式（toolMode='json'，存进 ProviderConfig），解析出的调用走同一执行器、同一卡片；
 * - L2 工具执行前出确认卡（允许 / 拒绝 / 记住此类）；userOnly 工具（publish_mark 等）Agent 调用一律拒绝；
 * - 每完成一步写任务检查点（只存引用与摘要）；“停止”保留已收到的内容并标注“已停止”。
 */
import { checkToolArgs, extractJsonToolCall, parseToolArguments, toolRepairMessage, type ToolCallAcc } from '@content-agent/shared';
import { ModelError, costOf, type ProviderConfig } from '../local/llm';
import { addUsage, getModels, getPrefs, upsertProvider } from '../local/store';
import { center } from '../data/platforms';
import { chatAgent, ToolsUnsupportedError, type AgentMsg, type AgentReply } from './model';
import { buildAgentSystem } from './prompts';
import { addMessage, addTaskStep, finishTask, getConversation, getProfile, listMessages, profileText, rememberApproval, rememberedApprovals, startTask, updateConversation, updateMessage, type CardData, type StoredMsg } from './store';
import { TOOL_DEFS, TOOLS, ToolError, toolByName, type ToolCtx } from './tools';

export const LIMITS = { toolCallsPerTurn: 8, toolTimeoutMs: 60000, turnMs: 180000, historyMessages: 40 };

export type AgentEvent =
  | { type: 'message'; msg: StoredMsg }
  | { type: 'delta'; id: number; content: string; reasoning: string }
  | { type: 'card'; id: number; index: number; card: CardData }
  | { type: 'confirm'; tool: string; label: string; args: unknown; resolve: (d: 'allow' | 'deny' | 'remember') => void }
  | { type: 'done'; stopped?: boolean; error?: string }
  | { type: 'mode'; toolMode: 'native' | 'json' };

export interface TurnOpts {
  conversationId: number;
  text: string;
  cfg: ProviderConfig;
  signal?: AbortSignal;
  onEvent: (e: AgentEvent) => void;
  /** 测试注入：替换模型调用 */
  call?: typeof chatAgent;
  /** trace（B5）：记录每步 */
  trace?: TraceStep[];
}
export interface TraceStep { kind: 'model' | 'tool'; name?: string; args?: unknown; result?: unknown; ms: number; usage?: { input: number; output: number; cached?: number }; streamed?: boolean; firstTokenMs?: number; chunks?: number; content?: string; error?: string; mode?: string }

/** 历史 → 模型消息；较早轮次压缩为一段摘要（本机拼接，不调用模型）。 */
export function historyToMessages(msgs: StoredMsg[], keep = LIMITS.historyMessages): AgentMsg[] {
  const recent = msgs.slice(-keep);
  // 截断后第一条不能是孤立的 tool 消息
  while (recent[0]?.role === 'tool') recent.shift();
  const older = msgs.slice(0, msgs.length - recent.length);
  const out: AgentMsg[] = [];
  if (older.length) out.push({ role: 'user', content: `（较早的对话摘要）${older.filter((m) => m.role === 'user').map((m) => m.content.slice(0, 40)).join(' / ').slice(0, 600)}` }, { role: 'assistant', content: '好的，我记得这些。' });
  for (const m of recent) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content });
    else if (m.role === 'assistant') {
      const x: AgentMsg = { role: 'assistant', content: m.content };
      if (m.reasoning) x.reasoning_content = m.reasoning;
      if (m.toolCalls?.length && !m.meta?.json) x.tool_calls = m.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } }));
      out.push(x);
    } else out.push({ role: 'user', content: m.content });
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ToolError(`工具执行超过 ${Math.round(ms / 1000)} 秒`, '稍后重试')), ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('已停止', 'AbortError')); }, { once: true });
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function runTurn(o: TurnOpts): Promise<void> {
  const call = o.call ?? chatAgent;
  const started = Date.now();
  const conv = await getConversation(o.conversationId);
  const userMsg = await addMessage({ conversationId: o.conversationId, role: 'user', content: o.text });
  o.onEvent({ type: 'message', msg: userMsg });
  let cfg = o.cfg;
  let jsonMode = cfg.toolMode === 'json';
  const prefs = await getPrefs();
  const profile = profileText(await getProfile());
  const platforms = prefs.platforms.map((p) => center(p)?.label ?? p);
  const sys = () => buildAgentSystem({ profile, platforms, jsonTools: jsonMode ? TOOLS.filter((t) => !t.userOnly).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) : undefined });
  const adv = (await getModels()).advanced;
  let toolCalls = 0;
  let lastSig = '';
  let task: { id: number } | null = null;
  const remembered = await rememberedApprovals();
  const trace = o.trace;
  const partial = { id: 0, content: '' };
  if (conv && conv.title === '新会话') await updateConversation(o.conversationId, { title: o.text.replace(/\s+/g, ' ').slice(0, 12) });

  try {
    for (let step = 0; step < LIMITS.toolCallsPerTurn + 2; step++) {
      if (Date.now() - started > LIMITS.turnMs) throw new ToolError('这一轮已超过 3 分钟上限，先停在这里', '说“继续”可以接着上次的检查点往下做');
      const history = historyToMessages(await listMessages(o.conversationId));
      const messages: AgentMsg[] = [{ role: 'system', content: sys() }, ...history];
      const asst = await addMessage({ conversationId: o.conversationId, role: 'assistant', content: '', model: `${cfg.label} · ${cfg.model}`, cards: [] });
      o.onEvent({ type: 'message', msg: asst });
      let reply: AgentReply;
      const t0 = Date.now();
      try {
        reply = await call(cfg, messages, { tools: jsonMode ? undefined : TOOL_DEFS, stream: true, thinking: adv.thinking === 'on', signal: o.signal, maxTokens: 4096, onDelta: (d) => { partial.id = asst.id; partial.content += d.content; o.onEvent({ type: 'delta', id: asst.id, ...d }); } });
        partial.id = 0; partial.content = '';
      } catch (e) {
        if (e instanceof ToolsUnsupportedError && !jsonMode) {
          jsonMode = true;
          cfg = { ...cfg, toolMode: 'json' };
          await upsertProvider(cfg).catch(() => {});
          o.onEvent({ type: 'mode', toolMode: 'json' });
          trace?.push({ kind: 'model', ms: Date.now() - t0, error: 'tools_unsupported → json mode' });
          await updateMessage(asst.id, { content: '（这个模型不支持原生工具调用，已切换为兼容模式）', meta: { system: true } });
          continue;
        }
        throw e;
      }
      if (cfg.toolMode === undefined && !jsonMode) { cfg = { ...cfg, toolMode: 'native' }; await upsertProvider(cfg).catch(() => {}); }
      const cost = costOf(cfg.id, cfg.model, reply.usage);
      await addUsage(cost, reply.usage);
      // JSON 指令解析（兼容模式；或原生模式下模型没给 tool_calls 却输出了指令）
      let calls: ToolCallAcc[] = reply.toolCalls.filter((t) => t.name);
      let content = reply.content;
      let parsedJson = false;
      if (!calls.length) {
        const j = extractJsonToolCall(content);
        if (j && toolByName(j.tool)) {
          calls = [{ id: `json_${Date.now().toString(36)}`, name: j.tool, arguments: JSON.stringify(j.args) }];
          content = '';
          parsedJson = true;
          if (!jsonMode) { jsonMode = true; cfg = { ...cfg, toolMode: 'json' }; await upsertProvider(cfg).catch(() => {}); o.onEvent({ type: 'mode', toolMode: 'json' }); }
        }
      }
      trace?.push({ kind: 'model', ms: reply.ms, usage: reply.usage, streamed: reply.streamed, firstTokenMs: reply.firstTokenMs, chunks: reply.chunks, content: content.slice(0, 400), mode: jsonMode ? 'json' : 'native' });
      await updateMessage(asst.id, { content, reasoning: reply.reasoning, toolCalls: calls, usage: reply.usage, cost, streamed: reply.streamed, model: `${cfg.label} · ${reply.model}`, meta: parsedJson || jsonMode ? { json: true } : undefined });
      o.onEvent({ type: 'message', msg: { ...asst, content, reasoning: reply.reasoning, toolCalls: calls, usage: reply.usage, cost, streamed: reply.streamed } });
      if (!calls.length) { if (task) await finishTask(task.id, 'done'); o.onEvent({ type: 'done' }); return; }

      if (!task) task = await startTask(o.conversationId, o.text);
      const cards: CardData[] = [];
      for (const tc of calls) {
        const spec = toolByName(tc.name);
        const idx = cards.length;
        const card: CardData = { type: 'tool', tool: tc.name, status: 'running' };
        cards.push(card);
        o.onEvent({ type: 'card', id: asst.id, index: idx, card: { ...card } });
        const t1 = Date.now();
        let resultForModel: unknown;
        const finish = async (patch: Partial<CardData>) => {
          Object.assign(card, patch, { ms: Date.now() - t1 });
          await updateMessage(asst.id, { cards: cards.map((c) => ({ ...c })) });
          o.onEvent({ type: 'card', id: asst.id, index: idx, card: { ...card } });
        };
        const sig = `${tc.name}:${tc.arguments}`;
        toolCalls++;
        try {
          if (!spec) throw new ToolError(`没有名为 ${tc.name} 的工具`);
          if (sig === lastSig) throw new ToolError('同一个工具、同样的参数已经连续调用两次，先停下来', '换个说法告诉我下一步');
          if (toolCalls > LIMITS.toolCallsPerTurn) throw new ToolError('这一轮已用满 8 次工具调用', '说“继续”接着做');
          if (spec.userOnly) throw new ToolError(`${spec.label}只能由你在卡片上点击触发`, '我已准备好，请在卡片上点按钮');
          let args = parseToolArguments(tc.arguments);
          let errs = args ? checkToolArgs(spec.parameters, args) : [];
          if (!args || errs.length) {
            // 参数不合格：带错误让模型修复一次
            const fix = await call(cfg, [...messages, { role: 'assistant', content: jsonMode ? `\`\`\`json\n{"tool":"${tc.name}","args":${tc.arguments || '{}'}}\n\`\`\`` : '' }, { role: 'user', content: toolRepairMessage(tc.name, args ? errs : '参数不是合法 JSON') }], { stream: false, signal: o.signal, maxTokens: 1024 });
            const j = extractJsonToolCall(fix.content) ?? (fix.toolCalls[0] ? { tool: fix.toolCalls[0].name, args: parseToolArguments(fix.toolCalls[0].arguments) ?? {} } : null);
            args = j && j.tool === tc.name ? j.args : null;
            errs = args ? checkToolArgs(spec.parameters, args) : [];
            if (!args || errs.length) throw new ToolError(`参数修复后仍不合格：${errs.map((e) => e.message).join('；') || '无法解析'}`);
            tc.arguments = JSON.stringify(args);
          }
          card.args = args;
          if (spec.level === 'L2' && (!spec.needsConfirm || await spec.needsConfirm(args)) && !remembered.includes(spec.name)) {
            const decision = await new Promise<'allow' | 'deny' | 'remember'>((resolve) => o.onEvent({ type: 'confirm', tool: spec.name, label: spec.label, args, resolve }));
            if (decision === 'deny') throw new ToolError('你拒绝了这一步', '');
            if (decision === 'remember') { await rememberApproval(spec.name); remembered.push(spec.name); }
          }
          const ctx: ToolCtx = { conversationId: o.conversationId, cfg, signal: o.signal, userText: o.text };
          const out = await withTimeout(spec.run(args, ctx), LIMITS.toolTimeoutMs, o.signal);
          resultForModel = out.result;
          await finish({ status: 'done', ...(out.card ? { type: out.card.type, data: out.card.data } : {}) });
          await addTaskStep(task.id, { name: spec.label, tool: spec.name, status: 'done', summary: JSON.stringify(out.result).slice(0, 200), refs: out.refs });
          trace?.push({ kind: 'tool', name: spec.name, args, result: out.result, ms: Date.now() - t1 });
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') throw e;
          const reason = e instanceof ToolError ? e.reason : e instanceof ModelError ? e.reason : e instanceof Error ? e.message : String(e);
          const advice = e instanceof ToolError ? e.advice : e instanceof ModelError ? e.advice : '';
          resultForModel = { error: reason, advice };
          await finish({ status: 'error', error: { reason, advice } });
          await addTaskStep(task.id, { name: spec?.label ?? tc.name, tool: tc.name, status: 'failed', summary: reason });
          trace?.push({ kind: 'tool', name: tc.name, ms: Date.now() - t1, error: reason });
        }
        lastSig = sig;
        // 工具结果回给模型：原生模式用 tool 消息；JSON 模式用一条用户消息
        if (jsonMode || parsedJson) await addMessage({ conversationId: o.conversationId, role: 'user', content: `工具 ${tc.name} 的结果：${JSON.stringify(resultForModel).slice(0, 6000)}`, meta: { toolResult: true } });
        else await addMessage({ conversationId: o.conversationId, role: 'tool', toolCallId: tc.id, toolName: tc.name, content: JSON.stringify(resultForModel).slice(0, 6000) });
      }
    }
    throw new ToolError('这一轮步骤太多，先停在这里', '说“继续”接着做');
  } catch (e) {
    const stopped = e instanceof DOMException && e.name === 'AbortError';
    if (task) await finishTask(task.id, stopped ? 'stopped' : 'failed');
    if (stopped && partial.id) await updateMessage(partial.id, { content: partial.content, stopped: true }).catch(() => {});
    const reason = stopped ? '已停止' : e instanceof ModelError ? `${e.reason}（${e.advice}）` : e instanceof ToolError ? `${e.reason}${e.advice ? `（${e.advice}）` : ''}` : e instanceof Error ? e.message : String(e);
    if (!stopped) {
      const m = await addMessage({ conversationId: o.conversationId, role: 'assistant', content: reason, meta: { error: true } });
      o.onEvent({ type: 'message', msg: m });
    }
    o.onEvent({ type: 'done', stopped, error: stopped ? undefined : reason });
  }
}
