/** 火山方舟（refs-v9）：对话（model 可填接入点 ep-… 或模型 ID）、/images/generations（Seedream，image 参数 = 参考图生图 = 改图）、/contents/generations/tasks（Seedance 视频，异步，链接 24 小时）、/embeddings。 */
import { callError } from '../errors.js';
import { buildImages, makeOpenAICompatible, parseImages } from './openai-compatible.js';
import { bearer, json, trimURL } from './types.js';

const base = makeOpenAICompatible({ id: 'ark', label: '火山方舟', defaultBaseURL: 'https://ark.cn-beijing.volces.com/api/v3', region: 'cn' });
export default makeOpenAICompatible({
  id: 'ark', label: '火山方舟（豆包）', defaultBaseURL: 'https://ark.cn-beijing.volces.com/api/v3', region: 'cn', docs: 'https://www.volcengine.com/docs/82379',
  roles: ['chat', 'reason', 'fast', 'vision', 'image', 'imageEdit', 'video', 'embed'],
  declare: (role) => ({ verified: 'doc', ...(role === 'video' ? { async: true, resultTTLHours: 24 } : {}), ...(role === 'image' || role === 'imageEdit' ? { resultTTLHours: 24 } : {}) }),
  build(req, ctx) {
    if (req.role === 'imageEdit') return buildImages({ role: 'image', prompt: req.instruction, size: req.size }, ctx, { image: req.images.length === 1 ? req.images[0] : req.images, response_format: 'url' });
    if (req.role === 'image') return buildImages(req, ctx, { response_format: 'url' });
    if (req.role === 'video') return { method: 'POST', url: `${trimURL(ctx.baseURL)}/contents/generations/tasks`, headers: { 'content-type': 'application/json', ...bearer(ctx.apiKey) }, body: JSON.stringify({ model: ctx.target.model, content: [{ type: 'text', text: `${req.prompt}${req.duration ? ` --duration ${req.duration}` : ''}${req.aspect ? ` --ratio ${req.aspect}` : ''}` }, ...(req.firstFrame ? [{ type: 'image_url', image_url: { url: req.firstFrame } }] : [])] }), responseType: 'json' };
    return base.build(req, ctx);
  },
  parse(req, res, ctx) {
    if (req.role === 'image' || req.role === 'imageEdit') return parseImages(res, 24);
    if (req.role === 'video') { const j = json(res); return { value: { type: 'job', jobId: String(j.id), status: 'queued' }, usage: {} }; }
    return base.parse(req, res, ctx);
  },
  poll: {
    build: (jobId, ctx) => ({ method: 'GET', url: `${trimURL(ctx.baseURL)}/contents/generations/tasks/${encodeURIComponent(jobId)}`, headers: bearer(ctx.apiKey), responseType: 'json' }),
    parse: (res) => { const j = json(res); const st = j.status; return { value: { type: 'job', jobId: String(j.id), status: st === 'succeeded' ? 'succeeded' : st === 'failed' || st === 'cancelled' ? 'failed' : st === 'running' ? 'running' : 'queued', items: j.content?.video_url ? [{ url: j.content.video_url, mime: 'video/mp4', ttlHours: 24 }] : undefined, error: j.error?.message }, usage: { seconds: j.usage?.completion_tokens ? undefined : undefined } }; },
    cancel: (jobId, ctx) => ({ method: 'DELETE', url: `${trimURL(ctx.baseURL)}/contents/generations/tasks/${encodeURIComponent(jobId)}`, headers: bearer(ctx.apiKey), responseType: 'json' }),
  },
  classify(status, body, ctx) {
    if (/InvalidEndpointOrModel|ModelNotOpen/i.test(body)) return callError(/ModelNotOpen/i.test(body) ? 'model_not_enabled' : 'model_not_found', { vendor: '火山方舟', model: ctx.target.model, status, detail: body });
    if (/SensitiveContent|OutputImageSensitive/i.test(body)) return callError('content_filtered', { status, detail: body });
    return null;
  },
});
