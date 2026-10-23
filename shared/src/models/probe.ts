/**
 * 按角色的最小探测（5.5 + 5.10.4）：请求体里的 model 就是用户填的字符串，一个字符不改；探测同样走统一能力层（callRole + override）。
 * 会花钱的探测（生图 / 改图 / 视频）需要调用方先二次确认（paid=true）。
 */
import { PROBE_PNG_RED_32, MOCK_PNG_64, makeWav } from './assets.js';
import { callRole, type CallDeps, type CallResult } from './runner.js';
import type { ModelEntry, ProbeResult, ProviderAccount } from './config.js';
import type { RoleRequest } from './adapters/types.js';
import type { RoleId } from './roles.js';

export interface ProbeDef { role: RoleId; paid: boolean; describe: string; request(): RoleRequest; judge(r: Extract<CallResult, { ok: true }>): { ok: boolean; reason?: string; detail?: string } }
const text = (r: Extract<CallResult, { ok: true }>) => (r.value.type === 'text' ? r.value.text : r.value.type === 'transcript' ? r.value.text : '');
export const PROBES: Record<RoleId, ProbeDef> = {
  chat: { role: 'chat', paid: false, describe: '“只回复两个字：你好”，最多 16 token', request: () => ({ role: 'chat', messages: [{ role: 'user', content: '只回复两个字：你好' }], maxTokens: 16 }), judge: (r) => ({ ok: !!text(r).trim(), reason: text(r).trim() ? undefined : '返回为空' }) },
  fast: { role: 'fast', paid: false, describe: '同文本对话', request: () => ({ role: 'fast', messages: [{ role: 'user', content: '只回复两个字：你好' }], maxTokens: 16 }), judge: (r) => ({ ok: !!text(r).trim() }) },
  reason: { role: 'reason', paid: false, describe: '“1+1=? 只回答数字”，开启思考', request: () => ({ role: 'reason', messages: [{ role: 'user', content: '1+1=? 只回答数字' }], maxTokens: 512, thinking: true }), judge: (r) => ({ ok: /2/.test(text(r)), detail: r.value.type === 'text' && r.value.reasoning ? '支持思考' : '没有返回思考过程' }) },
  vision: { role: 'vision', paid: false, describe: '内置 32×32 纯色图，问“这张图主要是什么颜色？”', request: () => ({ role: 'vision', image: `data:image/png;base64,${PROBE_PNG_RED_32}`, question: '这张图主要是什么颜色？只回答颜色。', maxTokens: 32 }), judge: (r) => ({ ok: /红|red/i.test(text(r)), reason: /红|red/i.test(text(r)) ? undefined : `回答里没有颜色词：${text(r).slice(0, 30)}` }) },
  image: { role: 'image', paid: true, describe: '真实出一张小图（会花钱，需再点一次确认）', request: () => ({ role: 'image', prompt: '一个简单的蓝色圆形，白色背景', n: 1, aspect: '1:1' }), judge: (r) => ({ ok: r.value.type === 'media' ? r.value.items.length > 0 : r.value.type === 'job' }) },
  imageEdit: { role: 'imageEdit', paid: true, describe: '内置图 + “把背景改成白色”（会花钱）', request: () => ({ role: 'imageEdit', images: [`data:image/png;base64,${MOCK_PNG_64}`], instruction: '把背景改成白色' }), judge: (r) => ({ ok: r.value.type === 'media' && r.value.items.length > 0 }) },
  tts: { role: 'tts', paid: false, describe: '合成“你好”（2 个字）', request: () => ({ role: 'tts', text: '你好' }), judge: (r) => ({ ok: r.value.type === 'media' && r.value.items.length > 0 && (!!r.value.items[0]!.url || (r.value.items[0]!.base64?.length ?? 0) > 200) }) },
  asr: { role: 'asr', paid: false, describe: '随包短录音（真实服务请用自己的“你好”录音再测）', request: () => ({ role: 'asr', audio: { base64: makeWav(1.5, 8000), format: 'wav', mime: 'audio/wav' }, language: 'zh' }), judge: (r) => ({ ok: r.value.type === 'transcript', detail: text(r).slice(0, 40) }) },
  video: { role: 'video', paid: true, describe: '只做鉴权 / 列模型；真实生成仅在“试一试”且二次确认', request: () => ({ role: 'video', prompt: '一只猫在窗台上', duration: 5 }), judge: (r) => ({ ok: r.value.type === 'job' }) },
  embed: { role: 'embed', paid: false, describe: '嵌入“测试”', request: () => ({ role: 'embed', input: ['测试'] }), judge: (r) => ({ ok: r.value.type === 'vectors' && r.value.dims > 0, detail: r.value.type === 'vectors' ? `维度 ${r.value.dims}` : undefined }) },
  rerank: { role: 'rerank', paid: false, describe: '查询“猫”，候选[“猫咪”“汽车”]', request: () => ({ role: 'rerank', query: '猫', documents: ['猫咪', '汽车'] }), judge: (r) => ({ ok: r.value.type === 'ranking' && r.value.results[0]?.index === 0 }) },
};

/** 对一个模型名勾选的每个能力各发一次探测；返回逐能力结果（写回 entry.probes / status / lastProbe 由调用方完成）。 */
export async function probeEntry(account: ProviderAccount, entry: ModelEntry, deps: CallDeps, o: { allowPaid?: boolean; signal?: AbortSignal; roles?: RoleId[] } = {}): Promise<{ role: RoleId; result: ProbeResult }[]> {
  const out: { role: RoleId; result: ProbeResult }[] = [];
  for (const role of o.roles ?? entry.roles) {
    const def = PROBES[role];
    if (def.paid && !o.allowPaid) { out.push({ role, result: { ok: false, at: new Date().toISOString(), kind: 'needs_confirm', reason: '这项测试会花钱，需要你再点一次确认', paid: true, requestedModel: entry.model } }); continue; }
    const r = await callRole(role, def.request(), deps, { override: { accountId: account.id, modelEntryId: entry.id, model: entry.model }, signal: o.signal, noFallback: true, retry: { max: 0, baseMs: 0 } });
    if (!r.ok) { out.push({ role, result: { ok: false, at: new Date().toISOString(), ms: r.ms, kind: r.error.kind, reason: r.error.reason, requestedModel: entry.model, detail: r.error.detail } }); continue; }
    const j = def.judge(r);
    out.push({ role, result: { ok: j.ok, at: new Date().toISOString(), ms: r.ms, reason: j.reason, detail: j.detail, requestedModel: entry.model, respondedModel: r.respondedModel && r.respondedModel !== entry.model ? r.respondedModel : undefined, paid: def.paid } });
  }
  return out;
}
/** 把探测结果折算成模型名状态（model_not_found / model_not_enabled 等）。 */
export function statusFromProbes(results: { result: ProbeResult }[]): ModelEntry['status'] {
  if (results.some((r) => r.result.kind === 'model_not_found')) return 'not_found';
  if (results.some((r) => r.result.kind === 'model_not_enabled')) return 'not_enabled';
  const real = results.filter((r) => r.result.kind !== 'needs_confirm');
  if (real.length && real.every((r) => r.result.ok)) return 'ok';
  return real.length ? 'failed' : 'untested';
}
