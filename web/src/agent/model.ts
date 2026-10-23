/**
 * Agent 用的模型调用（0.8.0）：OpenAI 兼容 function calling + 流式；Anthropic 兼容 tools / tool_use / tool_result。
 * - 网页 / Electron：fetch 的 ReadableStream 解析 SSE；
 * - 安卓 App：原生 StreamHttp 插件（CapacitorHttp 会缓冲流式响应）；插件不可用 → 一次性请求，不伪造逐字效果；
 * - 不支持 tools 的服务：抛 ToolsUnsupportedError，由 loop 切换为 JSON 指令模式。
 * 密钥只出现在请求头里，不进日志、错误、trace。
 */
import { classifyHttpError, createStreamAccumulator, looksLikeToolsUnsupported, splitReasoning, type ToolCallAcc } from '@content-agent/shared';
import { presetOf } from '../data/providers';
import { checkBaseURL, ModelError, timedFetch, type ProviderConfig } from '../local/llm';
import { isMockURL } from '../local/mockLlm';
import { nativeStream, nativeStreamAvailable } from '../local/streamHttp';
import { runtime } from '../runtime';

export interface AgentMsg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  reasoning_content?: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}
export interface ToolDef { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface AgentReply {
  content: string; reasoning?: string; toolCalls: ToolCallAcc[]; finishReason?: string;
  usage: { input: number; output: number; cached?: number }; ms: number; model: string;
  streamed: boolean; firstTokenMs?: number; chunks: number;
}
export interface AgentCallOpts {
  tools?: ToolDef[];
  stream?: boolean;
  thinking?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
  onDelta?: (d: { content: string; reasoning: string }) => void;
  timeoutMs?: number;
}
export class ToolsUnsupportedError extends Error { constructor() { super('这个服务不支持原生工具调用'); } }

const trim = (u: string) => u.trim().replace(/\/+$/, '');
function safeJson(s: string): unknown { try { return JSON.parse(s || '{}'); } catch { return {}; } }

function anthropicMessages(messages: AgentMsg[]) {
  const out: { role: 'user' | 'assistant'; content: unknown }[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content };
      const last = out.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content)) (last.content as unknown[]).push(block);
      else out.push({ role: 'user', content: [block] });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const blocks: unknown[] = m.content ? [{ type: 'text', text: m.content }] : [];
      for (const tc of m.tool_calls) blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: safeJson(tc.function.arguments) });
      out.push({ role: 'assistant', content: blocks });
      continue;
    }
    out.push({ role: m.role as 'user' | 'assistant', content: m.content });
  }
  return out;
}

export function buildRequest(cfg: ProviderConfig, messages: AgentMsg[], o: AgentCallOpts, stream: boolean): { url: string; headers: Record<string, string>; body: string } {
  const root = trim(cfg.baseURL);
  const key = cfg.apiKey.trim();
  if (cfg.protocol === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const body: Record<string, unknown> = { model: cfg.model.trim(), max_tokens: o.maxTokens ?? 4096, messages: anthropicMessages(messages), stream };
    if (system) body.system = system;
    if (o.tools?.length) body.tools = o.tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
    return { url: `${root}/messages`, headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) };
  }
  const d = presetOf(cfg.id)?.dialect ?? {};
  // MiMo 等思考模型：历史 assistant 消息原样带回 reasoning_content（MiMo 文档要求）
  const msgs = messages.map((m) => {
    const x: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.tool_calls?.length) x.tool_calls = m.tool_calls;
    if (m.tool_call_id) x.tool_call_id = m.tool_call_id;
    if (m.role === 'assistant' && m.reasoning_content && d.thinkingType) x.reasoning_content = m.reasoning_content;
    return x;
  });
  const body: Record<string, unknown> = { model: cfg.model.trim(), messages: msgs };
  body[d.maxTokensParam ?? 'max_tokens'] = o.maxTokens ?? 4096;
  if (d.thinkingType) body.thinking = { type: o.thinking ? 'enabled' : 'disabled' };
  if (o.tools?.length) { body.tools = o.tools; body.tool_choice = 'auto'; }
  if (stream) { body.stream = true; body.stream_options = { include_usage: true }; }
  return { url: `${root}/chat/completions`, headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) };
}

function parseFull(cfg: ProviderConfig, text: string): Omit<AgentReply, 'ms' | 'streamed' | 'chunks'> {
  let j: Record<string, any>;
  try { j = JSON.parse(text); } catch { throw new ModelError({ kind: 'format', reason: '返回的不是 JSON', advice: '地址可能指向了网页而不是接口，检查 Base URL' }); }
  if (cfg.protocol === 'anthropic') {
    const blocks = (j.content ?? []) as Record<string, any>[];
    return {
      content: blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''),
      reasoning: blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking ?? '').join('') || undefined,
      toolCalls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({ id: String(b.id), name: String(b.name), arguments: JSON.stringify(b.input ?? {}) })),
      finishReason: j.stop_reason === 'tool_use' ? 'tool_calls' : j.stop_reason,
      usage: { input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0, cached: j.usage?.cache_read_input_tokens },
      model: j.model ?? cfg.model,
    };
  }
  const msg = j.choices?.[0]?.message ?? {};
  const sr = splitReasoning(typeof msg.content === 'string' ? msg.content : '', msg.reasoning_content ?? msg.reasoning);
  return {
    content: sr.content, reasoning: sr.reasoning,
    toolCalls: ((msg.tool_calls ?? []) as Record<string, any>[]).map((t) => ({ id: String(t.id ?? ''), name: String(t.function?.name ?? ''), arguments: String(t.function?.arguments ?? '') })),
    finishReason: j.choices?.[0]?.finish_reason ?? undefined,
    usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0, cached: j.usage?.prompt_tokens_details?.cached_tokens ?? j.usage?.prompt_cache_hit_tokens },
    model: j.model ?? cfg.model,
  };
}

function fail(cfg: ProviderConfig, status: number, text: string, withTools: boolean): never {
  if (withTools && looksLikeToolsUnsupported(status, text)) throw new ToolsUnsupportedError();
  throw new ModelError(classifyHttpError(status, cfg.apiKey ? text.split(cfg.apiKey).join('***') : text));
}

/** 能否在当前环境做真流式：网页 / Electron 用 fetch 流；安卓用原生插件。 */
export async function streamMode(): Promise<'fetch' | 'native' | 'none'> {
  if (runtime() === 'capacitor') return (await nativeStreamAvailable()) ? 'native' : 'none';
  return typeof ReadableStream !== 'undefined' ? 'fetch' : 'none';
}

export async function chatAgent(cfg: ProviderConfig, messages: AgentMsg[], o: AgentCallOpts = {}): Promise<AgentReply> {
  const bad = checkBaseURL(cfg.baseURL);
  if (bad) throw new ModelError(bad);
  if (!cfg.model.trim()) throw new ModelError({ kind: 'model', reason: '还没填模型名', advice: '到“我的 → 模型”选一个模型' });
  if (!cfg.apiKey.trim() && !presetOf(cfg.id)?.noKey && !isMockURL(cfg.baseURL)) throw new ModelError({ kind: 'key', reason: '还没填 Key', advice: '到服务商后台复制 API Key 粘贴进来' });
  const started = Date.now();
  const mode = o.stream === false || isMockURL(cfg.baseURL) ? 'none' : await streamMode();
  const withTools = !!o.tools?.length;
  const timeoutMs = o.timeoutMs ?? 180000;

  if (mode === 'none') {
    const req = buildRequest(cfg, messages, o, false);
    const res = await timedFetch(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: o.signal }, timeoutMs);
    const text = await res.text().catch(() => '');
    if (!res.ok) fail(cfg, res.status, text, withTools);
    return { ...parseFull(cfg, text), ms: Date.now() - started, streamed: false, chunks: 0 };
  }

  const req = buildRequest(cfg, messages, o, true);
  let firstTokenMs: number | undefined;
  const acc = createStreamAccumulator(cfg.protocol, (d) => { if (firstTokenMs === undefined) firstTokenMs = Date.now() - started; o.onDelta?.(d); });
  if (mode === 'native') {
    const r = await nativeStream(req.url, { method: 'POST', headers: req.headers, body: req.body }, (t) => acc.feed(t), o.signal, timeoutMs).catch((e: Error & { timeout?: boolean }) => {
      if (e.name === 'AbortError') throw e;
      throw new ModelError(e.timeout ? { kind: 'timeout', reason: '模型响应超时', advice: '稍后重试，或换一个更快的模型' } : { kind: 'network', reason: '网络连接失败', advice: '检查网络后重试' });
    });
    if (r.status >= 400) fail(cfg, r.status, r.text, withTools);
  } else {
    const res = await timedFetch(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: o.signal }, timeoutMs);
    if (!res.ok) fail(cfg, res.status, await res.text().catch(() => ''), withTools);
    const ct = res.headers.get('content-type') ?? '';
    if (!res.body || /application\/json/.test(ct)) {
      // 服务忽略了 stream=true，整段返回：如实标为非流式
      return { ...parseFull(cfg, await res.text()), ms: Date.now() - started, streamed: false, chunks: 0 };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      acc.feed(dec.decode(value, { stream: true }));
    }
  }
  const s = acc.end();
  const err = (s as typeof s & { error?: string }).error;
  if (err) throw new ModelError({ kind: 'server', reason: `模型服务报错：${err.slice(0, 120)}`, advice: '稍后重试，或换一个模型' });
  const sr = splitReasoning(s.content, s.reasoning || undefined);
  return {
    content: sr.content, reasoning: sr.reasoning, toolCalls: s.toolCalls.filter(Boolean), finishReason: s.finishReason,
    usage: s.usage ?? { input: 0, output: 0 }, ms: Date.now() - started, model: s.model ?? cfg.model, streamed: true, firstTokenMs, chunks: s.chunks,
  };
}
