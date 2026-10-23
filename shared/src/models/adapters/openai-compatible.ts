/**
 * OpenAI 兼容（兜底，任何兼容服务都能接）：chat → /chat/completions，image → /images/generations，imageEdit → /images/edits（multipart），
 * tts → /audio/speech（二进制），asr → /audio/transcriptions（multipart），embed → /embeddings，rerank → /rerank（Cohere / Jina 风格）。
 * 每条路径可在账号 extra.path.<role> 里改（高级）。本文件同时导出可复用的 build/parse 片段，供其它兼容类适配器组合。
 */
import { splitReasoning } from '../../json.js';
import type { RoleId } from '../roles.js';
import { bearer, json, ParseError, trimURL, type Adapter, type AdapterCtx, type ChatMessage, type HttpRequest, type HttpResponse, type Parsed, type RoleRequest } from './types.js';

export const PATHS: Record<RoleId, string> = { chat: '/chat/completions', reason: '/chat/completions', fast: '/chat/completions', vision: '/chat/completions', image: '/images/generations', imageEdit: '/images/edits', tts: '/audio/speech', asr: '/audio/transcriptions', video: '/videos/generations', embed: '/embeddings', rerank: '/rerank' };
export const pathFor = (ctx: AdapterCtx, role: RoleId): string => ctx.account.extra?.[`path.${role}`] || PATHS[role];
const jsonHeaders = (k: string) => ({ 'content-type': 'application/json', ...bearer(k) });

export interface ChatDialect { maxTokensParam?: 'max_tokens' | 'max_completion_tokens'; thinking?: 'type' | 'enable_thinking' | 'none'; tempMax?: number }
export function buildChat(req: Extract<RoleRequest, { role: 'chat' | 'reason' | 'fast' }> | Extract<RoleRequest, { role: 'vision' }>, ctx: AdapterCtx, d: ChatDialect = {}, extraBody: Record<string, unknown> = {}): HttpRequest {
  const messages: ChatMessage[] = req.role === 'vision'
    ? [{ role: 'user', content: [{ type: 'image_url', image_url: { url: req.image } }, { type: 'text', text: req.question }] }]
    : req.messages;
  const body: Record<string, unknown> = { model: ctx.target.model, messages, ...extraBody };
  body[d.maxTokensParam ?? 'max_tokens'] = req.maxTokens ?? (req.role === 'fast' ? 512 : 4096);
  if (req.role !== 'vision') {
    const thinking = req.role === 'reason' ? true : !!req.thinking;
    if (d.thinking === 'type') body.thinking = { type: thinking ? 'enabled' : 'disabled' };
    else if (d.thinking === 'enable_thinking') body.enable_thinking = thinking;
    if (req.temperature !== undefined && !(d.thinking === 'type' && thinking)) body.temperature = d.tempMax !== undefined ? Math.min(req.temperature, d.tempMax) : req.temperature;
    if (req.tools?.length) { body.tools = req.tools; body.tool_choice = 'auto'; }
    if (req.json) body.response_format = { type: 'json_object' };
    if (req.stream) { body.stream = true; body.stream_options = { include_usage: true }; }
  } else if (d.thinking === 'type') body.thinking = { type: 'disabled' };
  return { method: 'POST', url: trimURL(ctx.baseURL) + pathFor(ctx, req.role), headers: jsonHeaders(ctx.apiKey), body: JSON.stringify(body), responseType: req.role !== 'vision' && req.stream ? 'sse' : 'json' };
}
export function parseChat(res: HttpResponse): Parsed {
  const j = json(res);
  const msg = j.choices?.[0]?.message;
  if (!msg) throw new ParseError('返回里没有 choices[0].message');
  const sr = splitReasoning(typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p: any) => p.text ?? '').join('') : '', msg.reasoning_content ?? msg.reasoning);
  return {
    value: { type: 'text', text: sr.content, reasoning: sr.reasoning, finishReason: j.choices[0].finish_reason, toolCalls: (msg.tool_calls ?? []).map((t: any) => ({ id: String(t.id ?? ''), name: String(t.function?.name ?? ''), arguments: String(t.function?.arguments ?? '') })) },
    usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0, cached: j.usage?.prompt_tokens_details?.cached_tokens ?? j.usage?.prompt_cache_hit_tokens, reasoning: j.usage?.completion_tokens_details?.reasoning_tokens },
    respondedModel: j.model,
  };
}
export function buildImages(req: Extract<RoleRequest, { role: 'image' }>, ctx: AdapterCtx, extra: Record<string, unknown> = {}): HttpRequest {
  const body: Record<string, unknown> = { model: ctx.target.model, prompt: req.prompt, n: req.n ?? 1, ...extra };
  if (req.size) body.size = req.size;
  if (req.negative) body.negative_prompt = req.negative;
  if (req.seed !== undefined) body.seed = req.seed;
  return { method: 'POST', url: trimURL(ctx.baseURL) + pathFor(ctx, 'image'), headers: jsonHeaders(ctx.apiKey), body: JSON.stringify(body), responseType: 'json' };
}
export function parseImages(res: HttpResponse, ttlHours?: number): Parsed {
  const j = json(res);
  const data = (j.data ?? j.images ?? []) as any[];
  if (!data.length) throw new ParseError('返回里没有图片');
  return { value: { type: 'media', items: data.map((d) => (d.b64_json ? { base64: d.b64_json, mime: 'image/png' } : { url: d.url, mime: 'image/png', ttlHours })) }, usage: { images: data.length }, respondedModel: j.model };
}
const dataUrlToPart = (name: string, dataUrl: string, filename: string) => {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) throw new ParseError('图片需要是本机素材（data URL）');
  return { name, filename, mime: m[1]!, base64: m[2]! };
};
export function buildImageEditMultipart(req: Extract<RoleRequest, { role: 'imageEdit' }>, ctx: AdapterCtx): HttpRequest {
  const parts = [{ name: 'model', value: ctx.target.model }, { name: 'prompt', value: req.instruction }, ...req.images.map((im, i) => dataUrlToPart(req.images.length > 1 ? 'image[]' : 'image', im, `image${i}.png`))];
  if (req.mask) parts.push(dataUrlToPart('mask', req.mask, 'mask.png'));
  if (req.size) parts.push({ name: 'size', value: req.size });
  return { method: 'POST', url: trimURL(ctx.baseURL) + pathFor(ctx, 'imageEdit'), headers: bearer(ctx.apiKey), multipart: parts, responseType: 'json' };
}
export function buildSpeech(req: Extract<RoleRequest, { role: 'tts' }>, ctx: AdapterCtx): HttpRequest {
  const body: Record<string, unknown> = { model: ctx.target.model, input: req.text, voice: req.voice ?? 'alloy', response_format: req.format ?? 'mp3' };
  if (req.speed) body.speed = req.speed;
  if (req.style) body.instructions = req.style;
  return { method: 'POST', url: trimURL(ctx.baseURL) + pathFor(ctx, 'tts'), headers: jsonHeaders(ctx.apiKey), body: JSON.stringify(body), responseType: 'binary' };
}
export function parseBinaryAudio(res: HttpResponse, req: Extract<RoleRequest, { role: 'tts' }>): Parsed {
  if (!res.base64) throw new ParseError('没有收到音频数据');
  return { value: { type: 'media', items: [{ base64: res.base64, mime: res.mime ?? `audio/${req.format ?? 'mpeg'}` }] }, usage: { chars: [...req.text].length } };
}
export function buildTranscribeMultipart(req: Extract<RoleRequest, { role: 'asr' }>, ctx: AdapterCtx): HttpRequest {
  const parts: any[] = [{ name: 'model', value: ctx.target.model }, { name: 'file', filename: `audio.${req.audio.format}`, mime: req.audio.mime, base64: req.audio.base64 }];
  if (req.language && req.language !== 'auto') parts.push({ name: 'language', value: req.language });
  if (req.timestamps) parts.push({ name: 'response_format', value: 'verbose_json' });
  return { method: 'POST', url: trimURL(ctx.baseURL) + pathFor(ctx, 'asr'), headers: bearer(ctx.apiKey), multipart: parts, responseType: 'json' };
}
export function parseTranscript(res: HttpResponse): Parsed {
  const j = json(res);
  if (typeof j.text !== 'string') throw new ParseError('返回里没有 text');
  return { value: { type: 'transcript', text: j.text, segments: Array.isArray(j.segments) ? j.segments.map((s: any) => ({ start: s.start, end: s.end, text: s.text })) : undefined }, usage: { seconds: j.duration }, respondedModel: j.model };
}
export function buildEmbed(req: Extract<RoleRequest, { role: 'embed' }>, ctx: AdapterCtx): HttpRequest {
  return { method: 'POST', url: trimURL(ctx.baseURL) + pathFor(ctx, 'embed'), headers: jsonHeaders(ctx.apiKey), body: JSON.stringify({ model: ctx.target.model, input: req.input, ...(req.dims ? { dimensions: req.dims } : {}) }), responseType: 'json' };
}
export function parseEmbed(res: HttpResponse): Parsed {
  const j = json(res);
  const vectors = ((j.data ?? []) as any[]).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding as number[]);
  if (!vectors.length || !Array.isArray(vectors[0])) throw new ParseError('返回里没有向量');
  return { value: { type: 'vectors', vectors, dims: vectors[0].length }, usage: { input: j.usage?.prompt_tokens ?? j.usage?.total_tokens ?? 0 }, respondedModel: j.model };
}
export function buildRerank(req: Extract<RoleRequest, { role: 'rerank' }>, ctx: AdapterCtx, path?: string): HttpRequest {
  return { method: 'POST', url: trimURL(ctx.baseURL) + (path ?? pathFor(ctx, 'rerank')), headers: jsonHeaders(ctx.apiKey), body: JSON.stringify({ model: ctx.target.model, query: req.query, documents: req.documents, top_n: req.topK ?? req.documents.length }), responseType: 'json' };
}
export function parseRerank(res: HttpResponse): Parsed {
  const j = json(res);
  const list = (j.results ?? j.output?.results ?? j.data ?? []) as any[];
  if (!list.length) throw new ParseError('返回里没有排序结果');
  return { value: { type: 'ranking', results: list.map((r) => ({ index: r.index, score: r.relevance_score ?? r.score ?? 0 })).sort((a, b) => b.score - a.score) }, usage: { calls: 1 } };
}
export const listOpenAIModels = {
  build: (ctx: Omit<AdapterCtx, 'target'>): HttpRequest => ({ method: 'GET', url: `${trimURL(ctx.baseURL)}/models`, headers: bearer(ctx.apiKey), responseType: 'json' }),
  parse: (res: HttpResponse) => {
    const j = json(res);
    return ((j.data ?? j.models ?? []) as any[]).map((m) => ({
      id: String(m.id ?? m.name), ownedBy: m.owned_by, contextLength: m.context_length ?? m.context_window,
      caps: { imageIn: m.supports_image_in, reasoning: m.supports_reasoning, vision: m.supports_image_in },
    }));
  },
};

export function makeOpenAICompatible(over: Partial<Adapter> & Pick<Adapter, 'id' | 'label' | 'defaultBaseURL'>, dialect: ChatDialect = {}): Adapter {
  const a: Adapter = {
    roles: ['chat', 'reason', 'fast', 'vision', 'image', 'imageEdit', 'tts', 'asr', 'embed', 'rerank'],
    keyRequired: true, region: 'global',
    declare: () => ({ verified: 'doc', stream: true, tools: 'native' }),
    build(req, ctx) {
      switch (req.role) {
        case 'chat': case 'reason': case 'fast': case 'vision': return buildChat(req, ctx, dialect);
        case 'image': return buildImages(req, ctx);
        case 'imageEdit': return buildImageEditMultipart(req, ctx);
        case 'tts': return buildSpeech(req, ctx);
        case 'asr': return buildTranscribeMultipart(req, ctx);
        case 'embed': return buildEmbed(req, ctx);
        case 'rerank': return buildRerank(req, ctx);
        default: throw new ParseError(`${a.label}不支持${req.role}`);
      }
    },
    parse(req, res) {
      switch (req.role) {
        case 'chat': case 'reason': case 'fast': case 'vision': return parseChat(res);
        case 'image': case 'imageEdit': return parseImages(res);
        case 'tts': return parseBinaryAudio(res, req);
        case 'asr': return parseTranscript(res);
        case 'embed': return parseEmbed(res);
        case 'rerank': return parseRerank(res);
        default: throw new ParseError(`${a.label}不支持${req.role}`);
      }
    },
    listModels: listOpenAIModels,
    ...over,
  };
  return a;
}
export default makeOpenAICompatible({ id: 'openai-compatible', label: 'OpenAI 兼容（自定义）', defaultBaseURL: '', region: 'global' });
