/** MiniMax（refs-v9）：/v1/chat/completions、/v1/image_generation（image-01，base64 / 参考图）、/v1/t2a_v2（hex 音频）、/v1/video_generation + /v1/query/video_generation。两个域名都给预设。 */
import { callError } from '../errors.js';
import { makeOpenAICompatible } from './openai-compatible.js';
import { hexToBase64 as hexToB64 } from '../../core/base64.js';
import { bearer, json, ParseError, trimURL } from './types.js';

const base = makeOpenAICompatible({ id: 'minimax', label: 'MiniMax', defaultBaseURL: 'https://api.minimaxi.com/v1', region: 'cn' });
const H = (k: string) => ({ 'content-type': 'application/json', ...bearer(k) });
export default makeOpenAICompatible({
  id: 'minimax', label: 'MiniMax', defaultBaseURL: 'https://api.minimaxi.com/v1', region: 'cn', docs: 'https://platform.minimaxi.com/docs',
  baseURLPresets: [{ label: 'api.minimaxi.com', url: 'https://api.minimaxi.com/v1' }, { label: 'api.minimax.cn', url: 'https://api.minimax.cn/v1' }],
  roles: ['chat', 'fast', 'image', 'imageEdit', 'tts', 'video'],
  declare: (role) => ({ verified: 'doc', ...(role === 'video' ? { async: true } : {}), ...(role === 'image' ? { aspectRatios: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'] } : {}) }),
  build(req, ctx) {
    const u = trimURL(ctx.baseURL);
    if (req.role === 'image' || req.role === 'imageEdit') {
      const prompt = req.role === 'image' ? req.prompt : req.instruction;
      return { method: 'POST', url: `${u}/image_generation`, headers: H(ctx.apiKey), body: JSON.stringify({ model: ctx.target.model, prompt, response_format: 'base64', n: req.role === 'image' ? req.n ?? 1 : 1, ...(req.role === 'image' && req.aspect ? { aspect_ratio: req.aspect } : {}), ...(req.role === 'imageEdit' ? { subject_reference: req.images.map((image_file) => ({ type: 'character', image_file })) } : {}) }), responseType: 'json' };
    }
    if (req.role === 'tts') return { method: 'POST', url: `${u}/t2a_v2`, headers: H(ctx.apiKey), body: JSON.stringify({ model: ctx.target.model, text: req.text, stream: false, voice_setting: { voice_id: req.voice ?? 'male-qn-qingse', speed: req.speed ?? 1 }, audio_setting: { format: req.format ?? 'mp3' } }), responseType: 'json' };
    if (req.role === 'video') return { method: 'POST', url: `${u}/video_generation`, headers: H(ctx.apiKey), body: JSON.stringify({ model: ctx.target.model, prompt: req.prompt, ...(req.firstFrame ? { first_frame_image: req.firstFrame } : {}), ...(req.duration ? { duration: req.duration } : {}) }), responseType: 'json' };
    return base.build(req, ctx);
  },
  parse(req, res, ctx) {
    if (req.role === 'image' || req.role === 'imageEdit') { const j = json(res); const list = j.data?.image_base64 ?? []; if (!list.length) throw new ParseError(j.base_resp?.status_msg || '返回里没有图片'); return { value: { type: 'media', items: list.map((b: string) => ({ base64: b, mime: 'image/jpeg' })) }, usage: { images: list.length } }; }
    if (req.role === 'tts') { const j = json(res); const hex = j.data?.audio; if (!hex) throw new ParseError(j.base_resp?.status_msg || '返回里没有音频'); return { value: { type: 'media', items: [{ base64: hexToB64(hex), mime: 'audio/mpeg' }] }, usage: { chars: j.extra_info?.usage_characters ?? [...req.text].length } }; }
    if (req.role === 'video') { const j = json(res); if (!j.task_id) throw new ParseError(j.base_resp?.status_msg || '没有 task_id'); return { value: { type: 'job', jobId: String(j.task_id), status: 'queued' }, usage: {} }; }
    return base.parse(req, res, ctx);
  },
  poll: {
    build: (jobId, ctx) => ({ method: 'GET', url: `${trimURL(ctx.baseURL)}/query/video_generation?task_id=${encodeURIComponent(jobId)}`, headers: bearer(ctx.apiKey), responseType: 'json' }),
    parse: (res) => { const j = json(res); const st = j.status; return { value: { type: 'job', jobId: String(j.task_id), status: st === 'Success' ? 'succeeded' : st === 'Fail' ? 'failed' : 'running', items: j.file_id ? [{ url: `file:${j.file_id}`, mime: 'video/mp4' }] : undefined }, usage: {} }; },
  },
  classify(status, body, ctx) {
    if (/"status_code"\s*:\s*1008|insufficient balance/i.test(body)) return callError('quota', { vendor: 'MiniMax', status, detail: body });
    if (/"status_code"\s*:\s*1004|authorized/i.test(body)) return callError('key_invalid', { vendor: 'MiniMax', status, detail: body });
    if (/"status_code"\s*:\s*1026|sensitive/i.test(body)) return callError('content_filtered', { status, detail: body });
    if (/invalid model|model.*not.*support/i.test(body)) return callError('model_not_found', { vendor: 'MiniMax', model: ctx.target.model, status, detail: body });
    return null;
  },
});
