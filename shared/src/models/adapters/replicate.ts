/** Replicate：POST /v1/models/{owner}/{name}/predictions（模型名 = owner/name，官方模型免版本号），Prefer: wait=60 同步等待，超时返回进行中 → 轮询 /v1/predictions/{id}。输入字段名由“字段对照表”映射（extra.map.<字段>）。 */
import { bearer, json, ParseError, trimURL, type Adapter, type AdapterCtx, type Parsed } from './types.js';
const mapKey = (ctx: AdapterCtx, k: string) => ctx.account.extra?.[`map.${k}`] || k;
const parsePred = (j: any): Parsed => {
  const st = j.status;
  const out = Array.isArray(j.output) ? j.output : j.output ? [j.output] : [];
  const status = st === 'succeeded' ? 'succeeded' : st === 'failed' || st === 'canceled' ? 'failed' : st === 'processing' ? 'running' : 'queued';
  return { value: { type: 'job', jobId: String(j.id), status, items: out.filter((u: unknown) => typeof u === 'string').map((url: string) => ({ url, mime: /\.mp4/.test(url) ? 'video/mp4' : 'image/png', ttlHours: 1 })), error: j.error ?? undefined }, usage: { seconds: j.metrics?.predict_time } };
};
const adapter: Adapter = {
  id: 'replicate', label: 'Replicate', defaultBaseURL: 'https://api.replicate.com/v1', region: 'global', keyRequired: true, roles: ['image', 'imageEdit', 'video'],
  declare: () => ({ verified: 'doc', async: true, resultTTLHours: 1 }),
  build(req, ctx) {
    const input: Record<string, unknown> = {};
    if (req.role === 'image') { input[mapKey(ctx, 'prompt')] = req.prompt; if (req.aspect) input[mapKey(ctx, 'aspect_ratio')] = req.aspect; if (req.seed !== undefined) input[mapKey(ctx, 'seed')] = req.seed; }
    else if (req.role === 'imageEdit') { input[mapKey(ctx, 'prompt')] = req.instruction; input[mapKey(ctx, 'image')] = req.images[0]; }
    else if (req.role === 'video') { input[mapKey(ctx, 'prompt')] = req.prompt; if (req.firstFrame) input[mapKey(ctx, 'image')] = req.firstFrame; if (req.duration) input[mapKey(ctx, 'duration')] = req.duration; }
    else throw new ParseError('Replicate 只接生图、改图、视频');
    if (!/^[\w.-]+\/[\w.-]+$/.test(ctx.target.model)) throw new ParseError('Replicate 模型名格式为 owner/name');
    return { method: 'POST', url: `${trimURL(ctx.baseURL)}/models/${ctx.target.model}/predictions`, headers: { 'content-type': 'application/json', ...bearer(ctx.apiKey), Prefer: 'wait=60' }, body: JSON.stringify({ input }), responseType: 'json' };
  },
  parse: (_req, res) => parsePred(json(res)),
  poll: {
    build: (id, ctx) => ({ method: 'GET', url: `${trimURL(ctx.baseURL)}/predictions/${encodeURIComponent(id)}`, headers: bearer(ctx.apiKey), responseType: 'json' }),
    parse: (res) => parsePred(json(res)),
    cancel: (id, ctx) => ({ method: 'POST', url: `${trimURL(ctx.baseURL)}/predictions/${encodeURIComponent(id)}/cancel`, headers: bearer(ctx.apiKey), responseType: 'json' }),
  },
};
export default adapter;
