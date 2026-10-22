/**
 * 本机模型直连：OpenAI 兼容（/chat/completions）与 Anthropic 兼容（/messages）。
 * - Android / iOS：capacitor.config.json 开启 CapacitorHttp 后，window.fetch 由原生发出，不受浏览器跨域限制；
 * - Electron / 网页：浏览器 fetch，服务不允许跨域时给出白话提示“请用 App 或连接服务端”。
 * 密钥只在请求头里出现，不写日志、不进错误信息。
 */
import { classifyHttpError, classifyThrown, splitReasoning, type FriendlyError, type ModelErrorKind } from '@content-agent/shared';
import { presetOf, type Protocol } from '../data/providers';
import { runtime } from '../runtime';

export interface ProviderConfig {
  id: string; label: string; protocol: Protocol; baseURL: string; apiKey: string; model: string;
  custom?: boolean;
  /** 0.8.0：工具调用方式。native = OpenAI / Anthropic 原生 tools；json = 兼容模式（JSON 指令）。首次在 Agent 中使用时自动探测。 */
  toolMode?: 'native' | 'json';
  /** 最近一次测试连接结果 */
  check?: { ok: boolean; at: string; ms?: number; model?: string; reason?: string };
}
export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatOut { content: string; reasoning?: string; ms: number; model: string; provider: string; usage: { input: number; output: number; cached?: number }; finishReason?: string }

export class ModelError extends Error implements FriendlyError {
  kind: ModelErrorKind; reason: string; advice: string; status?: number;
  constructor(f: FriendlyError) { super(f.reason); this.kind = f.kind; this.reason = f.reason; this.advice = f.advice; this.status = f.status; }
}

const trim = (u: string) => u.trim().replace(/\/+$/, '');
export const maskKey = (k: string) => (k ? `••••${k.slice(-4)}` : '');

/** 地址自检：常见填错直接提示，不发请求。 */
export function checkBaseURL(url: string): FriendlyError | null {
  const u = url.trim();
  if (!u) return { kind: 'address', reason: '地址没填', advice: '填服务商文档里的 Base URL，例如 https://api.xiaomimimo.com/v1' };
  if (!/^https?:\/\//i.test(u)) return { kind: 'address', reason: '地址不对', advice: '地址要以 https:// 开头' };
  if (/\/chat\/completions\/?$|\/messages\/?$/.test(u)) return { kind: 'address', reason: '地址多写了一段', advice: '只填基础地址（一般以 /v1 结尾），不要带 /chat/completions' };
  try { new URL(u); } catch { return { kind: 'address', reason: '地址格式不对', advice: '检查是否有空格或中文符号' }; }
  if (runtime() === 'capacitor' && /\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(u)) return { kind: 'address', reason: '手机上的 localhost 指手机自己', advice: '请填电脑的局域网地址，例如 http://192.168.1.10:11434/v1' };
  return null;
}

export async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  // 0.8.0：调用方的“停止”信号也能中止请求（停止 ≠ 超时，原样抛 AbortError）
  const outer = init.signal;
  if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', () => ctl.abort(), { once: true }); }
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (outer?.aborted) throw new DOMException('已停止', 'AbortError');
    throw new ModelError(classifyThrown(e, { web: runtime() !== 'capacitor', timedOut: ctl.signal.aborted, offline: typeof navigator !== 'undefined' && navigator.onLine === false }));
  } finally {
    clearTimeout(t);
  }
}

export interface ChatOpts { maxTokens?: number; json?: boolean; temperature?: number; thinking?: boolean; timeoutMs?: number }

export async function chat(cfg: ProviderConfig, messages: ChatMsg[], opts: ChatOpts = {}): Promise<ChatOut> {
  const bad = checkBaseURL(cfg.baseURL);
  if (bad) throw new ModelError(bad);
  if (!cfg.model.trim()) throw new ModelError({ kind: 'model', reason: '还没填模型名', advice: '从下拉里选一个模型，或手动输入服务商文档里的模型名' });
  const preset = presetOf(cfg.id);
  if (!cfg.apiKey.trim() && !preset?.noKey) throw new ModelError({ kind: 'key', reason: '还没填 Key', advice: '到服务商后台复制 API Key 粘贴进来' });
  const started = Date.now();
  const root = trim(cfg.baseURL);
  const timeoutMs = opts.timeoutMs ?? 90000;
  let res: Response;
  if (cfg.protocol === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    res = await timedFetch(`${root}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: cfg.model.trim(), max_tokens: opts.maxTokens ?? 4096, ...(system ? { system } : {}), messages: messages.filter((m) => m.role !== 'system') }),
    }, timeoutMs);
  } else {
    const d = preset?.dialect ?? {};
    const body: Record<string, unknown> = { model: cfg.model.trim(), messages };
    if (opts.maxTokens) body[d.maxTokensParam ?? 'max_tokens'] = opts.maxTokens;
    if (d.thinkingType) body.thinking = { type: opts.thinking ? 'enabled' : 'disabled' };
    if (opts.temperature !== undefined && !(opts.thinking && d.thinkingType)) body.temperature = opts.temperature;
    if (opts.json && (d.jsonObject || cfg.custom)) body.response_format = { type: 'json_object' };
    res = await timedFetch(`${root}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cfg.apiKey.trim() ? { authorization: `Bearer ${cfg.apiKey.trim()}` } : {}) },
      body: JSON.stringify(body),
    }, timeoutMs);
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    // 自定义服务不认 response_format 时退回一次纯文本（本地还会做 Schema 校验）
    if (res.status === 400 && opts.json && /response_format/i.test(text) && cfg.protocol === 'openai') return chat(cfg, messages, { ...opts, json: false });
    throw new ModelError(classifyHttpError(res.status, text.split(cfg.apiKey).join('***')));
  }
  let j: Record<string, any>;
  try { j = JSON.parse(text); } catch { throw new ModelError({ kind: 'format', reason: '返回的不是 JSON', advice: '地址可能指向了网页而不是接口，检查 Base URL' }); }
  if (cfg.protocol === 'anthropic') {
    const content = ((j.content ?? []) as { type: string; text?: string }[]).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    return { content, ms: Date.now() - started, model: cfg.model, provider: cfg.id, usage: { input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0 }, finishReason: j.stop_reason };
  }
  const msg = j.choices?.[0]?.message;
  if (typeof msg?.content !== 'string') throw new ModelError({ kind: 'format', reason: '返回格式不符合 OpenAI 协议', advice: '确认这个服务是 OpenAI 兼容的，或把协议改成 Anthropic 兼容' });
  const sr = splitReasoning(msg.content, msg.reasoning_content ?? msg.reasoning);
  return {
    content: sr.content, reasoning: sr.reasoning, ms: Date.now() - started, model: j.model ?? cfg.model, provider: cfg.id,
    usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0, cached: j.usage?.prompt_tokens_details?.cached_tokens ?? j.usage?.prompt_cache_hit_tokens },
    finishReason: j.choices?.[0]?.finish_reason ?? undefined,
  };
}

/** 测试连接：发一条极短请求（约 10 个 token），返回用时。 */
export async function testConnection(cfg: ProviderConfig): Promise<{ ms: number; model: string }> {
  const r = await chat(cfg, [{ role: 'user', content: '只回复两个字：你好' }], { maxTokens: 16, timeoutMs: 30000 });
  return { ms: r.ms, model: r.model };
}

/** 估算花费（元）：只对内置单价已知的模型。 */
export function costOf(provider: string, model: string, usage: { input: number; output: number }): number {
  const p = presetOf(provider)?.prices?.[model];
  if (!p) return 0;
  return (usage.input * p.input + usage.output * p.output) / 1_000_000;
}
