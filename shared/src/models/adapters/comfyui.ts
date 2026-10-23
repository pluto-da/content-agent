/**
 * ComfyUI（本地，5.10.7）：没有 model 参数，提交工作流 JSON（POST /prompt），GET /history/{id} 轮询，GET /view 取图。
 * ModelEntry.model 存 "workflow:<名称>"，只用于显示与日志，不发给 ComfyUI；字段对照表 map：prompt / negative / seed / width / height / image → "节点id.输入名"。
 */
import { json, ParseError, trimURL, type Adapter, type AdapterCtx, type Parsed } from './types.js';
function fill(ctx: AdapterCtx, values: Record<string, unknown>): Record<string, any> {
  const wf = (ctx.target.options?.workflow as string) ?? ctx.account.extra?.workflow;
  const map = (ctx.target.options?.map as Record<string, string>) ?? {};
  if (!wf) throw new ParseError('还没有导入 ComfyUI 工作流（API 格式 JSON）');
  let graph: Record<string, any>;
  try { graph = JSON.parse(wf); } catch { throw new ParseError('工作流不是合法 JSON'); }
  for (const [field, v] of Object.entries(values)) {
    const at = map[field];
    if (!at || v === undefined) continue;
    const [node, input] = at.split('.');
    if (!graph[node!]?.inputs) throw new ParseError(`字段对照表里的节点 ${node} 不存在`);
    graph[node!].inputs[input!] = v;
  }
  return graph;
}
/** 解析工作流里常见的 checkpoint 名（只读显示，解析不到就不显示）。 */
export function workflowCheckpoint(wf: string): string | undefined {
  try { const g = JSON.parse(wf) as Record<string, any>; for (const n of Object.values(g)) if (n?.class_type === 'CheckpointLoaderSimple' && n.inputs?.ckpt_name) return String(n.inputs.ckpt_name); } catch { /* ignore */ }
  return undefined;
}
const parseHistory = (j: any, jobId: string, ctx: AdapterCtx): Parsed => {
  const h = j[jobId];
  if (!h) return { value: { type: 'job', jobId, status: 'running' }, usage: {} };
  const imgs: any[] = [];
  for (const out of Object.values(h.outputs ?? {}) as any[]) for (const im of out.images ?? []) imgs.push({ url: `${trimURL(ctx.baseURL)}/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder ?? '')}&type=${encodeURIComponent(im.type ?? 'output')}`, mime: 'image/png' });
  const failed = h.status?.status_str === 'error';
  return { value: { type: 'job', jobId, status: failed ? 'failed' : imgs.length ? 'succeeded' : 'running', items: imgs }, usage: { images: imgs.length } };
};
const adapter: Adapter = {
  id: 'comfyui', label: 'ComfyUI（本地工作流）', defaultBaseURL: 'http://192.168.1.10:8188', region: 'local', keyRequired: false, roles: ['image', 'imageEdit'],
  declare: () => ({ verified: 'doc', async: true }),
  build(req, ctx) {
    if (req.role !== 'image' && req.role !== 'imageEdit') throw new ParseError('ComfyUI 只接生图、改图工作流');
    const graph = req.role === 'image' ? fill(ctx, { prompt: req.prompt, negative: req.negative, seed: req.seed }) : fill(ctx, { prompt: req.instruction, image: req.images[0] });
    return { method: 'POST', url: `${trimURL(ctx.baseURL)}/prompt`, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph }), responseType: 'json' };
  },
  parse(_req, res) { const j = json(res); if (!j.prompt_id) throw new ParseError('ComfyUI 没有返回 prompt_id'); return { value: { type: 'job', jobId: String(j.prompt_id), status: 'queued' }, usage: {} }; },
  poll: { build: (id, ctx) => ({ method: 'GET', url: `${trimURL(ctx.baseURL)}/history/${encodeURIComponent(id)}`, headers: {}, responseType: 'json' }), parse: (res, ctx) => { const j = json(res); const id = Object.keys(j)[0] ?? ''; return parseHistory(j, id, ctx); } },
  listModels: undefined,
};
export default adapter;
