/** 智谱（refs-v9）：/chat/completions、/images/generations、/videos/generations + /async-result/{id}、/embeddings、/audio/speech、/audio/transcriptions、/rerank。 */
import { callError } from '../errors.js';
import { makeOpenAICompatible, parseImages } from './openai-compatible.js';
import { bearer, json, trimURL } from './types.js';

const base = makeOpenAICompatible({ id: 'zhipu', label: '智谱', defaultBaseURL: 'https://open.bigmodel.cn/api/paas/v4', region: 'cn', docs: 'https://docs.bigmodel.cn/' });
export default makeOpenAICompatible({
  id: 'zhipu', label: '智谱', defaultBaseURL: 'https://open.bigmodel.cn/api/paas/v4', region: 'cn', docs: 'https://docs.bigmodel.cn/',
  roles: ['chat', 'reason', 'fast', 'vision', 'image', 'tts', 'asr', 'video', 'embed', 'rerank'],
  declare: (role) => ({ verified: 'doc', ...(role === 'video' ? { async: true } : {}) }),
  build(req, ctx) {
    if (req.role === 'video') return { method: 'POST', url: `${trimURL(ctx.baseURL)}/videos/generations`, headers: { 'content-type': 'application/json', ...bearer(ctx.apiKey) }, body: JSON.stringify({ model: ctx.target.model, prompt: req.prompt, ...(req.firstFrame ? { image_url: req.firstFrame } : {}), ...(req.duration ? { duration: req.duration } : {}) }), responseType: 'json' };
    return base.build(req, ctx);
  },
  parse(req, res, ctx) {
    if (req.role === 'video') { const j = json(res); return { value: { type: 'job', jobId: String(j.id), status: 'queued' }, usage: {} }; }
    if (req.role === 'image') return parseImages(res, 24);
    return base.parse(req, res, ctx);
  },
  poll: {
    build: (jobId, ctx) => ({ method: 'GET', url: `${trimURL(ctx.baseURL)}/async-result/${encodeURIComponent(jobId)}`, headers: bearer(ctx.apiKey), responseType: 'json' }),
    parse: (res) => { const j = json(res); const st = j.task_status; return { value: { type: 'job', jobId: String(j.id ?? ''), status: st === 'SUCCESS' ? 'succeeded' : st === 'FAIL' ? 'failed' : 'running', items: (j.video_result ?? []).map((v: any) => ({ url: v.url, mime: 'video/mp4' })) }, usage: {} }; },
  },
  classify(status, body, ctx) {
    if (/"code"\s*:\s*"?1211|模型不存在/.test(body)) return callError('model_not_found', { vendor: '智谱', model: ctx.target.model, status, detail: body });
    if (/"code"\s*:\s*"?1113|余额不足|欠费/.test(body)) return callError('quota', { vendor: '智谱', status, detail: body });
    if (/"code"\s*:\s*"?1301|敏感/.test(body)) return callError('content_filtered', { status, detail: body });
    return null;
  },
});
