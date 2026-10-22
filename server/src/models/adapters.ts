import type { HttpClient, HttpResponse } from '../http.js';
import type {
  AsrResult, AudioResult, ChatMessage, ChatOptions, ChatResult, EmbedResult, ImageInput, ImageResult, ProviderAdapter, ProviderDef, RerankResult, Segment, VideoResult,
} from './types.js';
import { estimateSegments, sleep, splitReasoning } from './util.js';
import { stripExtensions } from './schema.js';
import { cosyvoiceTts, cosyvoiceWsUrl, type WsFactory } from './cosyvoice.js';

export interface AdapterCtx {
  def: ProviderDef;
  apiKey: string;
  http: HttpClient;
  proxy?: string;
  /** 轮询间隔（测试中可设为 0） */
  pollMs?: number;
  /** 轮询次数上限 */
  pollMax?: number;
  /** ComfyUI 工作流 JSON（含 {{prompt}} 占位符） */
  comfyWorkflow?: string;
  /** WebSocket 工厂（CosyVoice；测试中可替换） */
  wsFactory?: WsFactory;
}

const trim = (u: string) => u.replace(/\/+$/, '');

function check(res: HttpResponse, what: string): void {
  if (res.status >= 400) throw new Error(`${what} 返回 ${res.status}: ${res.text.slice(0, 200)}`);
}

function base(ctx: AdapterCtx) {
  const proxy = ctx.def.useProxy ? ctx.proxy : undefined;
  const json = async (url: string, body: unknown, headers: Record<string, string> = {}, what = '接口') => {
    const res = await ctx.http(url, {
      method: 'POST', proxy, timeoutMs: 120000,
      headers: { 'content-type': 'application/json', ...(ctx.apiKey ? { authorization: `Bearer ${ctx.apiKey}` } : {}), ...headers },
      body: JSON.stringify(body),
    });
    check(res, what);
    return res;
  };
  const get = async (url: string, headers: Record<string, string> = {}, what = '接口') => {
    const res = await ctx.http(url, { proxy, timeoutMs: 60000, headers: { ...(ctx.apiKey ? { authorization: `Bearer ${ctx.apiKey}` } : {}), ...headers } });
    check(res, what);
    return res;
  };
  return { proxy, json, get };
}

function meta(ctx: AdapterCtx, model: string, started: number) {
  return { provider: ctx.def.id, model, ms: Date.now() - started, mock: false };
}

/** 把输入图转为字节（OpenAI 风格 multipart 需要上传文件）；只允许 data/base64 或公网地址。 */
async function loadImageBytes(ctx: AdapterCtx, img: ImageInput): Promise<{ data: Buffer; mime: string }> {
  if (img.b64) return { data: Buffer.from(img.b64, 'base64'), mime: img.mime ?? 'image/png' };
  if (img.url?.startsWith('data:')) {
    const m = /^data:([^;,]+)?;base64,(.*)$/s.exec(img.url);
    if (!m) throw new Error('无法解析 data URL 图像');
    return { data: Buffer.from(m[2]!, 'base64'), mime: m[1] ?? 'image/png' };
  }
  if (!img.url) throw new Error('输入图缺少 url 或 b64');
  const r = await ctx.http(img.url, { timeoutMs: 60000, maxBytes: 20 * 1024 * 1024 });
  check(r, '下载输入图');
  return { data: r.body, mime: img.mime ?? r.headers['content-type']?.split(';')[0] ?? 'image/png' };
}

function dataUrl(img: ImageInput): string {
  if (img.url) return img.url;
  return `data:${img.mime ?? 'image/png'};base64,${img.b64 ?? ''}`;
}

function imgContent(images: ImageInput[]) {
  return images.map((i) => ({ type: 'image_url', image_url: { url: i.url ?? `data:${i.mime ?? 'image/png'};base64,${i.b64}` } }));
}

/* ---------------- OpenAI 风格（OpenAI、DeepSeek、方舟、Kimi、Gemini、Ollama、MiMo、百炼兼容模式、智谱） ---------------- */

/**
 * 组装 OpenAI 兼容对话请求体，按提供方方言（chatDialect）调整：
 * - 输出上限参数名（MiMo 用 max_completion_tokens）
 * - 思考开关 thinking: {type: enabled|disabled}；思考模式下服务商强制采样参数时不传 temperature
 * - temperature 按范围截断；response_format：仅 json_object 的服务商把 json_schema 降级（本地再做 Schema 校验）
 */
export function buildChatBody(def: ProviderDef, messages: unknown[], model: string, opts: ChatOptions = {}): Record<string, unknown> {
  const d = def.chatDialect ?? {};
  const body: Record<string, unknown> = { model, messages };
  if (opts.maxTokens) body[d.maxTokensParam ?? 'max_tokens'] = opts.maxTokens;
  const thinking = !!opts.thinking;
  if (d.thinkingParam === 'type') body.thinking = { type: thinking ? 'enabled' : 'disabled' };
  if (opts.temperature !== undefined && !(thinking && d.thinkingIgnoresSampling)) {
    const [lo, hi] = d.temperatureRange ?? [0, 2];
    body.temperature = Math.min(hi, Math.max(lo, opts.temperature));
  }
  if (opts.seed !== undefined && def.supportsSeed) body.seed = opts.seed;
  const rf = opts.responseFormat;
  if (rf?.type === 'json_schema' && def.jsonMode === 'json_schema') body.response_format = { type: 'json_schema', json_schema: { name: rf.name, schema: stripExtensions(rf.schema), strict: false } };
  else if (rf && def.jsonMode) body.response_format = { type: 'json_object' };
  return body;
}

/** 解析 OpenAI 兼容对话返回：正文 / 思考分离、finish_reason、缓存命中与思考 token。 */
export function parseChatResponse(text: string): { content: string; reasoning?: string; finishReason?: string; usage: ChatResult['usage'] } {
  const j = JSON.parse(text) as {
    choices?: { finish_reason?: string | null; message?: { content?: string | null; reasoning_content?: string; reasoning?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };
  };
  const choice = j.choices?.[0];
  const msg = choice?.message;
  const raw = msg?.content;
  if (typeof raw !== 'string') throw new Error('对话接口返回格式不符合 OpenAI 协议');
  const { content, reasoning } = splitReasoning(raw, msg?.reasoning_content ?? msg?.reasoning);
  // 缓存命中：DeepSeek 为 prompt_cache_hit_tokens；OpenAI / MiMo / 百炼兼容 / Kimi 等为 prompt_tokens_details.cached_tokens
  const cached = j.usage?.prompt_cache_hit_tokens ?? j.usage?.prompt_tokens_details?.cached_tokens;
  const rt = j.usage?.completion_tokens_details?.reasoning_tokens;
  return {
    content, ...(reasoning ? { reasoning } : {}), ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {}),
    usage: { unit: 'token', input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0, ...(typeof cached === 'number' ? { cachedInput: cached } : {}), ...(typeof rt === 'number' ? { reasoningOutput: rt } : {}) },
  };
}

export function openaiAdapter(ctx: AdapterCtx): ProviderAdapter {
  const { json, proxy } = base(ctx);
  const root = trim(ctx.def.baseURL);
  const chatCall = async (messages: unknown[], model: string, opts: ChatOptions = {}): Promise<ChatResult> => {
    const t = Date.now();
    const body = buildChatBody(ctx.def, messages, model, opts);
    const once = async () => {
      const res = await json(`${root}/chat/completions`, body, {}, '对话接口');
      return parseChatResponse(res.text);
    };
    let r = await once();
    const retryOn = ctx.def.chatDialect?.retryFinishReasons ?? [];
    const warnings: string[] = [];
    if (r.finishReason && retryOn.includes(r.finishReason)) {
      // 例：MiMo 检测到复读被截断（repetition_truncation）→ 重试一次；仍截断则带告警返回，由上层决定是否采用
      const first = r.finishReason;
      r = await once();
      warnings.push(r.finishReason && retryOn.includes(r.finishReason) ? `${first}：重试后仍被截断，输出可能不完整` : `${first}：已自动重试一次`);
    }
    return {
      ...meta(ctx, model, t), content: r.content, ...(r.reasoning ? { reasoning: r.reasoning } : {}),
      ...(r.finishReason ? { finishReason: r.finishReason } : {}), ...(warnings.length ? { warnings } : {}),
      usage: r.usage,
    };
  };
  return {
    chat: (messages: ChatMessage[], model, opts) => chatCall(messages, model, opts),
    // 视觉理解不需要思考：有思考开关的服务商（MiMo 默认开启）显式关掉，省时省钱
    vision: (images, prompt, model) => chatCall([{ role: 'user', content: [{ type: 'text', text: prompt }, ...imgContent(images)] }], model, ctx.def.chatDialect?.thinkingParam ? { thinking: false } : {}),
    async image(prompt, model, opts) {
      const t = Date.now();
      const res = await json(`${root}/images/generations`, { model, prompt, n: opts?.n ?? 1, ...(opts?.size ? { size: opts.size } : {}) }, {}, '图像接口');
      const j = JSON.parse(res.text) as { data?: { url?: string; b64_json?: string }[] };
      const images = (j.data ?? []).map((d) => ({ url: d.url, b64: d.b64_json }));
      return { ...meta(ctx, model, t), images, usage: { unit: 'image', input: 0, output: images.length } };
    },
    async imageEdit(images, instruction, model, opts): Promise<ImageResult> {
      if (!images.length) throw new Error('图像编辑需要至少一张输入图');
      const t = Date.now();
      const fd = new FormData();
      fd.append('model', model);
      fd.append('prompt', instruction);
      fd.append('n', String(opts?.n ?? 1));
      if (opts?.size) fd.append('size', opts.size);
      const field = images.length > 1 ? 'image[]' : 'image';
      for (const [i, img] of images.entries()) {
        const { data, mime } = await loadImageBytes(ctx, img);
        fd.append(field, new Blob([new Uint8Array(data)], { type: mime }), `image-${i + 1}.${mime.split('/')[1] ?? 'png'}`);
      }
      const res = await ctx.http(`${root}/images/edits`, { method: 'POST', proxy, timeoutMs: 180000, headers: { authorization: `Bearer ${ctx.apiKey}` }, body: fd });
      check(res, '图像编辑接口');
      const j = JSON.parse(res.text) as { data?: { url?: string; b64_json?: string }[] };
      const out = (j.data ?? []).map((d) => ({ url: d.url, b64: d.b64_json }));
      if (!out.length) throw new Error('图像编辑接口未返回图像');
      return { ...meta(ctx, model, t), images: out, usage: { unit: 'image', input: images.length, output: out.length } };
    },
    async tts(text, model, opts): Promise<AudioResult> {
      const t = Date.now();
      const res = await json(`${root}/audio/speech`, { model, input: text, voice: opts?.voice ?? 'alloy', response_format: 'mp3' }, {}, '语音合成接口');
      return { ...meta(ctx, model, t), audio: res.body, mime: 'audio/mpeg', usage: { unit: 'char', input: text.length, output: 0 } };
    },
    async asr(audio, model): Promise<AsrResult> {
      if (!audio.data) throw new Error('OpenAI 风格转写需要上传音频数据');
      const t = Date.now();
      const fd = new FormData();
      fd.append('file', new Blob([new Uint8Array(audio.data)], { type: audio.mime ?? 'audio/mpeg' }), 'audio.mp3');
      fd.append('model', model);
      fd.append('response_format', 'verbose_json');
      const res = await ctx.http(`${root}/audio/transcriptions`, { method: 'POST', proxy, timeoutMs: 180000, headers: { authorization: `Bearer ${ctx.apiKey}` }, body: fd });
      check(res, '转写接口');
      const j = JSON.parse(res.text) as { text?: string; duration?: number; segments?: Segment[] };
      const text = j.text ?? '';
      return { ...meta(ctx, model, t), text, segments: j.segments?.length ? j.segments.map((s) => ({ start: s.start, end: s.end, text: s.text })) : estimateSegments(text), usage: { unit: 'second', input: j.duration ?? 0, output: 0 } };
    },
    async embed(texts, model): Promise<EmbedResult> {
      const t = Date.now();
      const res = await json(`${root}/embeddings`, { model, input: texts }, {}, '向量接口');
      const j = JSON.parse(res.text) as { data?: { embedding: number[]; index: number }[]; usage?: { prompt_tokens?: number; total_tokens?: number } };
      const vectors = (j.data ?? []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
      return { ...meta(ctx, model, t), vectors, usage: { unit: 'token', input: j.usage?.prompt_tokens ?? j.usage?.total_tokens ?? 0, output: 0 } };
    },
    async rerank(query, docs, model): Promise<RerankResult> {
      const t = Date.now();
      const res = await json(`${root}/rerank`, { model, query, documents: docs }, {}, '重排序接口');
      const j = JSON.parse(res.text) as { results?: { index: number; relevance_score: number }[] };
      return { ...meta(ctx, model, t), scores: (j.results ?? []).map((r) => ({ index: r.index, score: r.relevance_score })), usage: { unit: 'call', input: 1, output: 0 } };
    },
  };
}

/* ---------------- 智谱：OpenAI 风格 + 异步视频 ---------------- */

export function zhipuAdapter(ctx: AdapterCtx): ProviderAdapter {
  const o = openaiAdapter(ctx);
  const { json, get } = base(ctx);
  const root = trim(ctx.def.baseURL);
  const status = async (taskId: string, model: string): Promise<VideoResult> => {
    const t = Date.now();
    const res = await get(`${root}/async-result/${encodeURIComponent(taskId)}`, {}, '视频结果接口');
    const j = JSON.parse(res.text) as { task_status?: string; video_result?: { url?: string }[] };
    const s = j.task_status === 'SUCCESS' ? 'succeeded' : j.task_status === 'FAIL' ? 'failed' : 'running';
    return { ...meta(ctx, model, t), taskId, status: s, url: j.video_result?.[0]?.url, usage: { unit: 'call', input: 0, output: 0 } };
  };
  const { imageEdit: _noEdit, ...rest } = o; // 智谱未提供 OpenAI 风格 images/edits，不暴露
  void _noEdit;
  return {
    ...rest,
    async video(prompt, model, opts) {
      const t = Date.now();
      const res = await json(`${root}/videos/generations`, { model, prompt, ...(opts?.imageUrl ? { image_url: opts.imageUrl } : {}) }, {}, '视频接口');
      const j = JSON.parse(res.text) as { id?: string };
      if (!j.id) throw new Error('视频接口未返回任务编号');
      return { ...meta(ctx, model, t), taskId: j.id, status: 'pending', usage: { unit: 'call', input: 1, output: 0 } };
    },
    videoStatus: status,
  };
}

/* ---------------- 百炼：兼容模式（对话/视觉/向量）+ 原生异步（万相图/视频、Paraformer） ---------------- */

export function dashscopeAdapter(ctx: AdapterCtx): ProviderAdapter {
  const o = openaiAdapter(ctx);
  const { json, get } = base(ctx);
  const native = trim(ctx.def.nativeBaseURL ?? 'https://dashscope.aliyuncs.com/api/v1');
  const asyncH = { 'X-DashScope-Async': 'enable' };
  const poll = async (taskId: string) => {
    for (let i = 0; i < (ctx.pollMax ?? 60); i++) {
      const res = await get(`${native}/tasks/${encodeURIComponent(taskId)}`, {}, '任务查询接口');
      const j = JSON.parse(res.text) as { output?: { task_status?: string; results?: { url?: string; transcription_url?: string }[]; video_url?: string; message?: string } };
      const st = j.output?.task_status;
      if (st === 'SUCCEEDED') return j.output!;
      if (st === 'FAILED' || st === 'CANCELED' || st === 'UNKNOWN') throw new Error(`百炼任务失败：${j.output?.message ?? st}`);
      await sleep(ctx.pollMs ?? 3000);
    }
    throw new Error('百炼任务轮询超时');
  };
  const createTask = async (path: string, body: unknown) => {
    const res = await json(`${native}/services/${path}`, body, asyncH, '百炼任务接口');
    const j = JSON.parse(res.text) as { output?: { task_id?: string } };
    if (!j.output?.task_id) throw new Error('百炼未返回任务编号');
    return j.output.task_id;
  };
  return {
    chat: o.chat,
    vision: o.vision,
    embed: o.embed,
    async image(prompt, model, opts) {
      const t = Date.now();
      const id = await createTask('aigc/text2image/image-synthesis', { model, input: { prompt }, parameters: { n: opts?.n ?? 1, size: (opts?.size ?? '1024*1024').replace('x', '*') } });
      const out = await poll(id);
      const images = (out.results ?? []).map((r) => ({ url: r.url }));
      return { ...meta(ctx, model, t), images, usage: { unit: 'image', input: 0, output: images.length } };
    },
    /** 千问图像编辑（qwen-image-2.0 系列等），同步接口 multimodal-generation/generation，1-3 张输入图。 */
    async imageEdit(images, instruction, model, opts) {
      if (!images.length) throw new Error('图像编辑需要至少一张输入图');
      if (images.length > 3) throw new Error('百炼图像编辑最多支持 3 张输入图');
      const t = Date.now();
      const res = await json(`${native}/services/aigc/multimodal-generation/generation`, {
        model,
        input: { messages: [{ role: 'user', content: [...images.map((i) => ({ image: dataUrl(i) })), { text: instruction }] }] },
        parameters: { n: opts?.n ?? 1, watermark: false, prompt_extend: true, ...(opts?.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}), ...(opts?.size ? { size: opts.size.replace('x', '*') } : {}) },
      }, {}, '百炼图像编辑接口');
      const j = JSON.parse(res.text) as { code?: string; message?: string; output?: { choices?: { message?: { content?: { image?: string }[] } }[] }; usage?: { image_count?: number } };
      if (j.code) throw new Error(`百炼图像编辑错误 ${j.code} ${j.message ?? ''}`);
      const out = (j.output?.choices ?? []).flatMap((c) => c.message?.content ?? []).filter((c) => c.image).map((c) => ({ url: c.image }));
      if (!out.length) throw new Error('百炼图像编辑未返回图像');
      return { ...meta(ctx, model, t), images: out, usage: { unit: 'image', input: images.length, output: j.usage?.image_count ?? out.length } };
    },
    /** CosyVoice 语音合成（官方 WebSocket 协议） */
    async tts(text, model, opts) {
      const t = Date.now();
      const r = await cosyvoiceTts({ url: cosyvoiceWsUrl(native), apiKey: ctx.apiKey, model, voice: opts?.voice || ctx.def.ttsVoice || 'longanyang', text, wsFactory: ctx.wsFactory });
      return { ...meta(ctx, model, t), ...r };
    },
    async video(prompt, model, opts) {
      const t = Date.now();
      const id = await createTask('aigc/video-generation/video-synthesis', { model, input: { prompt, ...(opts?.imageUrl ? { img_url: opts.imageUrl } : {}) } });
      return { ...meta(ctx, model, t), taskId: id, status: 'pending', usage: { unit: 'call', input: 1, output: 0 } };
    },
    async videoStatus(taskId, model) {
      const t = Date.now();
      const res = await get(`${native}/tasks/${encodeURIComponent(taskId)}`, {}, '任务查询接口');
      const j = JSON.parse(res.text) as { output?: { task_status?: string; video_url?: string; message?: string } };
      const st = j.output?.task_status;
      const status = st === 'SUCCEEDED' ? 'succeeded' : st === 'FAILED' ? 'failed' : st === 'PENDING' ? 'pending' : 'running';
      return { ...meta(ctx, model, t), taskId, status, url: j.output?.video_url, message: j.output?.message, usage: { unit: 'call', input: 0, output: 0 } };
    },
    async asr(audio, model) {
      if (!audio.url) throw new Error('Paraformer 录音文件识别需要公网可访问的音频链接');
      const t = Date.now();
      const id = await createTask('audio/asr/transcription', { model, input: { file_urls: [audio.url] } });
      const out = await poll(id);
      const tu = out.results?.[0]?.transcription_url;
      if (!tu) throw new Error('转写结果缺少 transcription_url');
      const r = await ctx.http(tu, { timeoutMs: 60000 });
      const j = JSON.parse(r.text) as { transcripts?: { text?: string; sentences?: { begin_time: number; end_time: number; text: string }[] }[]; properties?: { original_duration_in_milliseconds?: number } };
      const tr = j.transcripts?.[0];
      const segments = (tr?.sentences ?? []).map((s) => ({ start: s.begin_time / 1000, end: s.end_time / 1000, text: s.text }));
      return { ...meta(ctx, model, t), text: tr?.text ?? '', segments, usage: { unit: 'second', input: (j.properties?.original_duration_in_milliseconds ?? 0) / 1000, output: 0 } };
    },
  };
}

/* ---------------- Anthropic Messages ---------------- */

export function anthropicAdapter(ctx: AdapterCtx): ProviderAdapter {
  const { proxy } = base(ctx);
  const root = trim(ctx.def.baseURL);
  const call = async (system: string | undefined, messages: unknown[], model: string, opts: ChatOptions = {}): Promise<ChatResult> => {
    const t = Date.now();
    const res = await ctx.http(`${root}/messages`, {
      method: 'POST', proxy, timeoutMs: 120000,
      headers: { 'content-type': 'application/json', 'x-api-key': ctx.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: opts.maxTokens ?? 4096,
        // 稳定前缀：system 整段标记为可缓存（命中时按缓存价计费）
        ...(system ? { system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        messages,
      }),
    });
    check(res, 'Anthropic 接口');
    const j = JSON.parse(res.text) as { content?: { type: string; text?: string; thinking?: string }[]; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
    const content = (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    const reasoning = (j.content ?? []).filter((c) => c.type === 'thinking').map((c) => c.thinking ?? '').join('\n') || undefined;
    const u = j.usage ?? {};
    const cached = u.cache_read_input_tokens ?? 0;
    // Anthropic 的 input_tokens 不含缓存读写部分，这里换算为输入总量
    const input = (u.input_tokens ?? 0) + cached + (u.cache_creation_input_tokens ?? 0);
    return { ...meta(ctx, model, t), content, ...(reasoning ? { reasoning } : {}), usage: { unit: 'token', input, output: u.output_tokens ?? 0, cachedInput: cached } };
  };
  return {
    chat(messages, model, opts) {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n') || undefined;
      return call(system, messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })), model, opts);
    },
    vision(images, prompt, model) {
      const blocks = images.map((i) => (i.url ? { type: 'image', source: { type: 'url', url: i.url } } : { type: 'image', source: { type: 'base64', media_type: i.mime ?? 'image/png', data: i.b64 } }));
      return call(undefined, [{ role: 'user', content: [...blocks, { type: 'text', text: prompt }] }], model);
    },
  };
}

/* ---------------- MiniMax：t2a_v2 语音、海螺视频 ---------------- */

export function minimaxAdapter(ctx: AdapterCtx): ProviderAdapter {
  const o = openaiAdapter(ctx);
  const { json, get } = base(ctx);
  const native = trim(ctx.def.nativeBaseURL ?? 'https://api.minimaxi.com');
  return {
    chat: o.chat,
    async tts(text, model, opts) {
      const t = Date.now();
      const res = await json(`${native}/v1/t2a_v2`, {
        model, text, stream: false, voice_setting: { voice_id: opts?.voice ?? 'male-qn-qingse', speed: 1, vol: 1, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 }, output_format: 'hex',
      }, {}, 'MiniMax 语音接口');
      const j = JSON.parse(res.text) as { data?: { audio?: string }; base_resp?: { status_code?: number; status_msg?: string } };
      if (j.base_resp?.status_code) throw new Error(`MiniMax 语音错误 ${j.base_resp.status_code} ${j.base_resp.status_msg ?? ''}`);
      if (!j.data?.audio) throw new Error('MiniMax 未返回音频');
      return { ...meta(ctx, model, t), audio: Buffer.from(j.data.audio, 'hex'), mime: 'audio/mpeg', usage: { unit: 'char', input: text.length, output: 0 } };
    },
    async video(prompt, model, opts) {
      const t = Date.now();
      const res = await json(`${native}/v1/video_generation`, { model, prompt, ...(opts?.imageUrl ? { first_frame_image: opts.imageUrl } : {}) }, {}, 'MiniMax 视频接口');
      const j = JSON.parse(res.text) as { task_id?: string };
      if (!j.task_id) throw new Error('MiniMax 未返回任务编号');
      return { ...meta(ctx, model, t), taskId: j.task_id, status: 'pending', usage: { unit: 'call', input: 1, output: 0 } };
    },
    async videoStatus(taskId, model) {
      const t = Date.now();
      const res = await get(`${native}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`, {}, 'MiniMax 视频查询');
      const j = JSON.parse(res.text) as { status?: string; file_id?: string };
      const s = j.status === 'Success' ? 'succeeded' : j.status === 'Fail' ? 'failed' : 'running';
      // 成功后返回 file_id，需再调用文件检索接口获取下载地址；此处如实返回 file_id
      return { ...meta(ctx, model, t), taskId, status: s, message: j.file_id ? `file_id=${j.file_id}（需通过文件检索接口下载）` : undefined, usage: { unit: 'call', input: 0, output: 0 } };
    },
  };
}

/* ---------------- ElevenLabs TTS ---------------- */

export function elevenlabsAdapter(ctx: AdapterCtx): ProviderAdapter {
  const { proxy } = base(ctx);
  const root = trim(ctx.def.baseURL);
  return {
    async tts(text, model, opts) {
      const t = Date.now();
      const voice = opts?.voice ?? '21m00Tcm4TlvDq8ikWAM';
      const res = await ctx.http(`${root}/text-to-speech/${encodeURIComponent(voice)}`, {
        method: 'POST', proxy, timeoutMs: 120000,
        headers: { 'content-type': 'application/json', 'xi-api-key': ctx.apiKey, accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: model }),
      });
      check(res, 'ElevenLabs 接口');
      return { ...meta(ctx, model, t), audio: res.body, mime: 'audio/mpeg', usage: { unit: 'char', input: text.length, output: 0 } };
    },
  };
}

/* ---------------- ComfyUI（本地） ---------------- */

export function comfyuiAdapter(ctx: AdapterCtx): ProviderAdapter {
  const root = trim(ctx.def.baseURL);
  return {
    async image(prompt, model) {
      if (!ctx.comfyWorkflow) throw new Error('未配置 ComfyUI 工作流 JSON（需包含 {{prompt}} 占位符，导出自 ComfyUI 的 API 格式）');
      const t = Date.now();
      const wf = JSON.parse(ctx.comfyWorkflow.replaceAll('{{prompt}}', JSON.stringify(prompt).slice(1, -1))) as unknown;
      const res = await ctx.http(`${root}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: wf }) });
      check(res, 'ComfyUI /prompt');
      const id = (JSON.parse(res.text) as { prompt_id?: string }).prompt_id;
      if (!id) throw new Error('ComfyUI 未返回 prompt_id');
      for (let i = 0; i < (ctx.pollMax ?? 120); i++) {
        const h = await ctx.http(`${root}/history/${id}`, {});
        const j = JSON.parse(h.text) as Record<string, { outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }>;
        const outs = j[id]?.outputs;
        if (outs) {
          const images = Object.values(outs).flatMap((o) => o.images ?? []).map((im) => ({ url: `${root}/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder)}&type=${im.type}` }));
          return { ...meta(ctx, model, t), images, usage: { unit: 'image', input: 0, output: images.length } };
        }
        await sleep(ctx.pollMs ?? 2000);
      }
      throw new Error('ComfyUI 生成超时');
    },
  };
}

export function createAdapter(ctx: AdapterCtx): ProviderAdapter {
  switch (ctx.def.protocol) {
    case 'openai': return openaiAdapter(ctx);
    case 'zhipu': return zhipuAdapter(ctx);
    case 'dashscope': return dashscopeAdapter(ctx);
    case 'anthropic': return anthropicAdapter(ctx);
    case 'minimax': return minimaxAdapter(ctx);
    case 'elevenlabs': return elevenlabsAdapter(ctx);
    case 'comfyui': return comfyuiAdapter(ctx);
    default: throw new Error(`未知协议 ${ctx.def.protocol}`);
  }
}
