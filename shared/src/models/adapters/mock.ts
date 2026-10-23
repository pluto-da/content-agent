/**
 * Mock（全角色，确定性，不联网）：用于首启演示、“试一试”、单测、回放与黄金评测。
 * 模型名里的标记可模拟失败：fail-401 / fail-quota / fail-429 / fail-500 / fail-timeout / filtered / notfound / notenabled / mismatch / slow；
 * respond-as:<名字> 模拟服务商把请求路由到另一个模型（respondedModel 不同）。
 */
import { MOCK_PNG_64, makeWav } from '../assets.js';
import { callError } from '../errors.js';
import type { Adapter, Parsed, RoleRequest } from './types.js';

export class MockFailure extends Error { constructor(public status: number, public body: string) { super(`mock ${status}`); } }
export function mockFailureFor(model: string): MockFailure | null {
  if (/fail-401/.test(model)) return new MockFailure(401, '{"error":{"message":"Incorrect API key provided"}}');
  if (/fail-quota/.test(model)) return new MockFailure(402, '{"error":{"message":"insufficient balance"}}');
  if (/fail-429/.test(model)) return new MockFailure(429, '{"error":{"message":"rate limit"}}');
  if (/fail-500/.test(model)) return new MockFailure(500, '{"error":{"message":"internal error"}}');
  if (/filtered/.test(model)) return new MockFailure(400, '{"error":{"code":"data_inspection_failed","message":"Input data may contain inappropriate content."}}');
  if (/notfound/.test(model)) return new MockFailure(404, '{"error":{"code":"model_not_found","message":"The model does not exist"}}');
  if (/notenabled/.test(model)) return new MockFailure(403, '{"error":{"message":"Model access denied: not activated"}}');
  if (/mismatch/.test(model)) return new MockFailure(400, '{"error":{"message":"This model does not support this operation"}}');
  return null;
}
const lastUser = (req: Extract<RoleRequest, { role: 'chat' | 'reason' | 'fast' }>) => {
  const m = [...req.messages].reverse().find((x) => x.role === 'user');
  return typeof m?.content === 'string' ? m.content : '';
};
export function mockLocal(req: RoleRequest, model: string): Parsed {
  const respondedModel = /respond-as:([\w.:/-]+)/.exec(model)?.[1] ?? model;
  switch (req.role) {
    case 'chat': case 'fast': { const u = lastUser(req); return { value: { type: 'text', text: /只回复两个字/.test(u) ? '你好' : `（模拟回复）${u.slice(0, 40)}` }, usage: { input: Math.ceil(u.length * 1.2) + 20, output: 12 }, respondedModel }; }
    case 'reason': { const u = lastUser(req); return { value: { type: 'text', text: /1\+1/.test(u) ? '2' : `（模拟结论）${u.slice(0, 30)}`, reasoning: '（模拟推理过程）先拆解问题，再核对条件。' }, usage: { input: 30, output: 20, reasoning: 12 }, respondedModel }; }
    case 'vision': return { value: { type: 'text', text: /颜色/.test(req.question) ? '主要是红色。' : '（模拟看图）图里是一块纯色。' }, usage: { input: 80, output: 10 }, respondedModel };
    case 'image': return { value: { type: 'media', items: Array.from({ length: Math.max(1, Math.min(req.n ?? 1, 4)) }, () => ({ base64: MOCK_PNG_64, mime: 'image/png', width: 64, height: 64 })) }, usage: { images: req.n ?? 1 }, respondedModel };
    case 'imageEdit': return { value: { type: 'media', items: [{ base64: MOCK_PNG_64, mime: 'image/png', width: 64, height: 64 }] }, usage: { images: 1 }, respondedModel };
    case 'tts': return { value: { type: 'media', items: [{ base64: makeWav(Math.max(0.4, Math.min(3, [...req.text].length * 0.2))), mime: 'audio/wav' }] }, usage: { chars: [...req.text].length }, respondedModel };
    case 'asr': return { value: { type: 'transcript', text: '你好', segments: [{ start: 0, end: 1.2, text: '你好' }] }, usage: { seconds: 1.5 }, respondedModel };
    case 'video': return { value: { type: 'job', jobId: `mockjob-${req.prompt.length}-${req.duration ?? 5}`, status: 'queued' }, usage: {}, respondedModel };
    case 'embed': return { value: { type: 'vectors', vectors: req.input.map((t) => vec(t)), dims: 8 }, usage: { input: req.input.join('').length }, respondedModel };
    case 'rerank': { const q = vec(req.query); const scored = req.documents.map((d, index) => ({ index, score: cos(q, vec(d)) })); return { value: { type: 'ranking', results: scored.sort((a, b) => b.score - a.score) }, usage: { calls: 1 }, respondedModel }; }
  }
}
/** 确定性“向量”：按字符 bigram 哈希到 8 维（只用于 Mock，能让“猫”与“猫咪”相近）。 */
function vec(t: string): number[] { const v = new Array(8).fill(0); for (const ch of t) v[ch.codePointAt(0)! % 8] += 1; const n = Math.hypot(...v) || 1; return v.map((x) => x / n); }
function cos(a: number[], b: number[]): number { return a.reduce((s, x, i) => s + x * b[i]!, 0); }

const adapter: Adapter = {
  id: 'mock', label: '模拟（不联网）', defaultBaseURL: 'mock://local', region: 'test', keyRequired: false,
  roles: ['chat', 'reason', 'fast', 'vision', 'image', 'imageEdit', 'tts', 'asr', 'video', 'embed', 'rerank'],
  declare: (role) => ({ verified: 'live', stream: false, tools: 'json', ...(role === 'image' ? { aspectRatios: ['1:1', '3:4', '9:16'], maxImages: 4 } : {}), ...(role === 'video' ? { async: true, durations: [5, 10] } : {}), ...(role === 'tts' ? { voices: [{ id: 'mock', label: '模拟音色' }], maxChars: 2000 } : {}) }),
  build: (req) => ({ method: 'POST', url: `mock://local/${req.role}`, headers: {}, body: '{}', responseType: 'json' }),
  parse: (req, _res, ctx) => mockLocal(req, ctx.target.model),
  local: (req, ctx) => { const f = mockFailureFor(ctx.target.model); if (f) throw f; return mockLocal(req, ctx.target.model); },
  poll: { build: (id) => ({ method: 'GET', url: `mock://local/job/${id}`, headers: {}, responseType: 'json' }), parse: (_res, ctx) => ({ value: { type: 'job', jobId: 'mock', status: 'succeeded', items: [{ base64: MOCK_PNG_64, mime: 'video/mp4' }] }, usage: { seconds: 5 }, respondedModel: ctx.target.model }) },
  classify: (status, body, ctx) => (status === 404 && /model_not_found/.test(body) ? callError('model_not_found', { model: ctx.target.model, status, detail: body }) : null),
  listModels: { build: () => ({ method: 'GET', url: 'mock://local/models', headers: {}, responseType: 'json' }), parse: () => [{ id: 'mock-omni' }, { id: 'mock-chat' }, { id: 'mock-image' }, { id: 'mock-tts' }] },
};
export default adapter;
