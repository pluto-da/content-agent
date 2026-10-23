/**
 * 阿里云百炼（refs-v9）：文本 / 看图 / 向量 / ASR(qwen3-asr-flash，input_audio Base64) 走 compatible-mode；
 * TTS：HTTP SpeechSynthesizer（cosyvoice，返回 output.audio.url，24 小时有效 → 立即下载入库）；
 * 生图 / 视频：原生异步（X-DashScope-Async: enable + GET /api/v1/tasks/{id} 轮询）；改图：multimodal-generation 同步；重排：compatible-api/v1/reranks。
 * 业务空间专属域名可在账号 workspaceId 填写。
 */
import { callError } from '../errors.js';
import { buildChat, buildEmbed, buildRerank, makeOpenAICompatible, parseChat, parseEmbed, parseRerank } from './openai-compatible.js';
import { bearer, json, ParseError, trimURL, type AdapterCtx, type HttpRequest, type Parsed } from './types.js';

const native = (ctx: AdapterCtx) => trimURL(ctx.account.nativeBaseURL || (ctx.account.workspaceId ? `https://${ctx.account.workspaceId}.cn-beijing.maas.aliyuncs.com` : 'https://dashscope.aliyuncs.com'));
const H = (k: string, async = false) => ({ 'content-type': 'application/json', ...bearer(k), ...(async ? { 'X-DashScope-Async': 'enable' } : {}) });
const sizeOf = (aspect?: string, size?: string) => size?.replace('x', '*') ?? ({ '1:1': '1024*1024', '3:4': '960*1280', '4:3': '1280*960', '9:16': '720*1280', '16:9': '1280*720' } as Record<string, string>)[aspect ?? '1:1'] ?? '1024*1024';
const parseTask = (j: any): Parsed => {
  const st = String(j.output?.task_status ?? '').toUpperCase();
  const status = st === 'SUCCEEDED' ? 'succeeded' : st === 'FAILED' || st === 'CANCELED' || st === 'UNKNOWN' ? 'failed' : st === 'RUNNING' ? 'running' : 'queued';
  const items = [...(j.output?.results ?? []).map((r: any) => ({ url: r.url, mime: 'image/png', ttlHours: 24 })), ...(j.output?.video_url ? [{ url: j.output.video_url, mime: 'video/mp4', ttlHours: 24 }] : [])];
  return { value: { type: 'job', jobId: String(j.output?.task_id ?? ''), status, items: items.length ? items : undefined, error: j.output?.message }, usage: { images: j.usage?.image_count, seconds: j.usage?.video_duration } };
};

export default makeOpenAICompatible({
  id: 'dashscope', label: '阿里云百炼', defaultBaseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', nativeBaseURL: 'https://dashscope.aliyuncs.com', region: 'cn', docs: 'https://help.aliyun.com/zh/model-studio/',
  roles: ['chat', 'reason', 'fast', 'vision', 'image', 'imageEdit', 'tts', 'asr', 'video', 'embed', 'rerank'],
  declare: (role) => ({ verified: 'doc', ...(role === 'asr' ? { maxAudioSeconds: 300, maxAudioBytes: 10 * 1024 * 1024, audioInput: true } : {}), ...(role === 'image' ? { async: true, resultTTLHours: 24, aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9'] } : {}), ...(role === 'video' ? { async: true, resultTTLHours: 24 } : {}), ...(role === 'tts' ? { resultTTLHours: 24, voices: [{ id: 'longanyang', label: '龙安洋' }] } : {}), ...(role === 'embed' ? { dims: [1024] } : {}) }),
  build(req, ctx): HttpRequest {
    switch (req.role) {
      case 'chat': case 'reason': case 'fast': case 'vision': return buildChat(req, ctx, { thinking: 'enable_thinking' });
      case 'embed': return buildEmbed(req, ctx);
      case 'rerank': return buildRerank(req, { ...ctx, baseURL: native(ctx) }, '/compatible-api/v1/reranks');
      case 'asr': return { method: 'POST', url: `${trimURL(ctx.baseURL)}/chat/completions`, headers: H(ctx.apiKey), body: JSON.stringify({ model: ctx.target.model, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:${req.audio.mime};base64,${req.audio.base64}` } }] }], asr_options: { language: req.language && req.language !== 'auto' ? req.language : undefined, enable_itn: true } }), responseType: 'json' };
      case 'tts': return { method: 'POST', url: `${native(ctx)}/api/v1/services/audio/tts/SpeechSynthesizer`, headers: H(ctx.apiKey), body: JSON.stringify({ model: ctx.target.model, input: { text: req.text, voice: req.voice ?? 'longanyang', format: req.format ?? 'mp3', ...(req.speed ? { rate: req.speed } : {}), ...(req.style ? { instruction: req.style } : {}) } }), responseType: 'json' };
      case 'image': return { method: 'POST', url: `${native(ctx)}/api/v1/services/aigc/text2image/image-synthesis`, headers: H(ctx.apiKey, true), body: JSON.stringify({ model: ctx.target.model, input: { prompt: req.prompt, ...(req.negative ? { negative_prompt: req.negative } : {}) }, parameters: { size: sizeOf(req.aspect, req.size), n: req.n ?? 1, ...(req.seed !== undefined ? { seed: req.seed } : {}) } }), responseType: 'json' };
      case 'imageEdit': return { method: 'POST', url: `${native(ctx)}/api/v1/services/aigc/multimodal-generation/generation`, headers: H(ctx.apiKey), body: JSON.stringify({ model: ctx.target.model, input: { messages: [{ role: 'user', content: [...req.images.map((image) => ({ image })), { text: req.instruction }] }] } }), responseType: 'json' };
      case 'video': return { method: 'POST', url: `${native(ctx)}/api/v1/services/aigc/video-generation/video-synthesis`, headers: H(ctx.apiKey, true), body: JSON.stringify({ model: ctx.target.model, input: { prompt: req.prompt, ...(req.firstFrame ? { img_url: req.firstFrame } : {}) }, parameters: { ...(req.duration ? { duration: req.duration } : {}), ...(req.aspect ? { size: sizeOf(req.aspect) } : {}) } }), responseType: 'json' };
    }
  },
  parse(req, res): Parsed {
    switch (req.role) {
      case 'chat': case 'reason': case 'fast': case 'vision': return parseChat(res);
      case 'embed': return parseEmbed(res);
      case 'rerank': return parseRerank(res);
      case 'asr': { const p = parseChat(res); return { ...p, value: { type: 'transcript', text: p.value.type === 'text' ? p.value.text : '' } }; }
      case 'tts': { const j = json(res); const url = j.output?.audio?.url; if (!url) throw new ParseError('返回里没有 output.audio.url'); return { value: { type: 'media', items: [{ url, mime: 'audio/mpeg', ttlHours: 24 }] }, usage: { chars: j.usage?.characters ?? [...req.text].length } }; }
      case 'image': case 'video': return parseTask(json(res));
      case 'imageEdit': { const j = json(res); const imgs = (j.output?.choices?.[0]?.message?.content ?? []).filter((c: any) => c.image).map((c: any) => ({ url: c.image, mime: 'image/png', ttlHours: 24 })); if (!imgs.length) throw new ParseError('返回里没有图片'); return { value: { type: 'media', items: imgs }, usage: { images: imgs.length } }; }
    }
  },
  poll: {
    build: (jobId, ctx) => ({ method: 'GET', url: `${native(ctx)}/api/v1/tasks/${encodeURIComponent(jobId)}`, headers: bearer(ctx.apiKey), responseType: 'json' }),
    parse: (res) => parseTask(json(res)),
    cancel: (jobId, ctx) => ({ method: 'POST', url: `${native(ctx)}/api/v1/tasks/${encodeURIComponent(jobId)}/cancel`, headers: bearer(ctx.apiKey), responseType: 'json' }),
  },
  classify(status, body, ctx) {
    if (/Model not exist|InvalidModel|model.*not.*found/i.test(body)) return callError('model_not_found', { vendor: '阿里云百炼', model: ctx.target.model, status, detail: body });
    if (/Model\.AccessDenied|not been activated|未开通/i.test(body)) return callError('model_not_enabled', { vendor: '阿里云百炼', model: ctx.target.model, status, detail: body });
    if (/DataInspectionFailed|data_inspection_failed/i.test(body)) return callError('content_filtered', { status, detail: body });
    if (/Arrearage|欠费/i.test(body)) return callError('quota', { vendor: '阿里云百炼', status, detail: body });
    return null;
  },
}, { thinking: 'enable_thinking' });
