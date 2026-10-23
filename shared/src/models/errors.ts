/**
 * 能力层错误目录（5.4 + 5.10.4）：每个 CallError = { kind, reason, advice, retriable, status?, actions[] }。
 * classify 按“状态码 + 响应体关键词”判定；各适配器可以追加自己的关键词（adapter.classify 先跑，未命中再走通用）。
 * 所有密钥在错误文本中替换为 ***。
 */
import { redact } from '../core/redact.js';
import { t } from '../core/i18n.js';
import { roleLabel, type RoleId } from './roles.js';

export type CallErrorKind =
  | 'content_filtered' | 'size_unsupported' | 'audio_too_long' | 'text_too_long' | 'model_not_found' | 'capability_mismatch' | 'model_not_enabled'
  | 'quota' | 'rate_limited' | 'job_timeout' | 'result_expired' | 'cors' | 'network_offline' | 'network' | 'timeout' | 'server' | 'key_invalid'
  | 'format' | 'role_not_configured' | 'tools_unsupported' | 'address' | 'aborted' | 'unknown';
export type ActionId = 'configure' | 'fix_key' | 'topup' | 'use_fallback' | 'shorten' | 'retry' | 'fetch_list' | 'rename_model' | 'edit_roles' | 'open_console' | 'copy_detail' | 'skip' | 'continue' | 'rewrite';
export interface CallError { kind: CallErrorKind; reason: string; advice: string; retriable: boolean; status?: number; actions: ActionId[]; detail?: string }

/** 5.6：只有这些才允许自动重试 / 切备用；计费、鉴权、审核、模型名类错误一律不切（要告诉用户，而不是悄悄花另一家的钱）。 */
export const RETRIABLE: ReadonlySet<CallErrorKind> = new Set(['network', 'timeout', 'rate_limited', 'server']);
export const NEVER_FALLBACK: ReadonlySet<CallErrorKind> = new Set(['content_filtered', 'key_invalid', 'quota', 'model_not_enabled', 'model_not_found', 'capability_mismatch', 'role_not_configured']);

export function callError(kind: CallErrorKind, v: { vendor?: string; model?: string; role?: RoleId; status?: number; detail?: string; step?: number; limit?: string; minutes?: number; hours?: number } = {}): CallError {
  const vars = { vendor: v.vendor ?? '服务商', model: v.model ?? '', role: v.role ? roleLabel(v.role) : '', roleName: v.role ? roleLabel(v.role) : '', status: v.status ?? '', detail: (v.detail ?? '').slice(0, 120), step: v.step ?? '', limit: v.limit ?? '', minutes: v.minutes ?? 15, hours: v.hours ?? 24 };
  const T = (id: string) => t(id, vars);
  const base = { status: v.status, detail: v.detail ? redact(v.detail).slice(0, 400) : undefined, retriable: RETRIABLE.has(kind) };
  switch (kind) {
    case 'key_invalid': return { ...base, kind, reason: T('err.key_invalid'), advice: T('err.key_invalid.advice'), actions: ['fix_key', 'use_fallback'] };
    case 'quota': return { ...base, kind, reason: T('err.quota'), advice: T('err.quota.advice'), actions: ['topup', 'use_fallback'] };
    case 'rate_limited': return { ...base, kind, reason: T('err.rate_limited'), advice: T('err.rate_limited.advice'), actions: ['retry'] };
    case 'model_not_found': return { ...base, kind, reason: T('err.model_not_found'), advice: '模型名就是请求里的 model 参数，以服务商文档或「获取列表」为准', actions: ['fetch_list', 'rename_model'] };
    case 'model_not_enabled': return { ...base, kind, reason: T('err.model_not_enabled'), advice: '开通后回来点重试', actions: ['open_console', 'retry'] };
    case 'capability_mismatch': return { ...base, kind, reason: T('err.capability_mismatch'), advice: '把这个模型名勾到它真正支持的能力下', actions: ['edit_roles'] };
    case 'content_filtered': return { ...base, kind, reason: T('err.content_filtered'), advice: '换个说法后重试，不会自动切到别家', actions: ['rewrite'] };
    case 'network_offline': return { ...base, kind, reason: v.step ? T('err.network_offline') : '网络断了。', advice: '网络恢复后点继续', actions: ['continue'] };
    case 'network': return { ...base, kind, reason: '网络连接失败', advice: '检查网络后重试', actions: ['retry'] };
    case 'cors': return { ...base, kind, reason: T('err.cors'), advice: '在安卓 / iOS App 里没有这个限制', actions: ['copy_detail'] };
    case 'timeout': return { ...base, kind, reason: T('err.timeout'), advice: '稍后重试，或换一个更快的模型', actions: ['retry', 'use_fallback'] };
    case 'server': return { ...base, kind, reason: T('err.server'), advice: '稍后再试', actions: ['retry', 'use_fallback'] };
    case 'format': return { ...base, kind, reason: T('err.format'), advice: '检查地址是不是接口地址（一般以 /v1 结尾）', actions: ['copy_detail'] };
    case 'job_timeout': return { ...base, kind, reason: T('err.job_timeout'), advice: '可以稍后点“现在查询”', actions: ['retry'] };
    case 'result_expired': return { ...base, kind, reason: T('err.result_expired'), advice: '重新生成一次', actions: ['retry'] };
    case 'size_unsupported': return { ...base, kind, reason: v.detail ?? T('err.size_unsupported'), advice: '换一个支持的尺寸', actions: ['retry'] };
    case 'audio_too_long': return { ...base, kind, reason: T('err.audio_too_long'), advice: '先切分再转写', actions: ['shorten'] };
    case 'text_too_long': return { ...base, kind, reason: T('err.text_too_long'), advice: '会自动分段', actions: ['shorten'] };
    case 'role_not_configured': return { ...base, kind, reason: T('err.role_not_configured'), advice: '配置并测试成功后回到对话继续', actions: ['configure', 'skip'] };
    case 'tools_unsupported': return { ...base, kind, reason: '这个模型不支持原生工具调用', advice: '已自动切换为兼容模式', actions: [] };
    case 'address': return { ...base, kind, reason: '地址不对', advice: 'Base URL 一般以 /v1 结尾，不要带具体路径', actions: ['copy_detail'] };
    case 'aborted': return { ...base, kind, reason: '已停止', advice: '', actions: ['continue'] };
    default: return { ...base, kind: 'unknown', reason: t('err.unknown', vars), advice: '可以重试，或复制详情给我看', actions: ['retry', 'copy_detail'] };
  }
}

const has = (b: string, ...words: (string | RegExp)[]) => words.some((w) => (typeof w === 'string' ? b.includes(w) : w.test(b)));
/** 通用分类（适配器未命中时使用）。body 已是原始响应文本。 */
export function classifyGeneric(status: number, body: string, ctx: { vendor?: string; model?: string; role?: RoleId; secrets?: string[] } = {}): CallError {
  const raw = redact(body ?? '', ctx.secrets ?? []);
  const b = raw.toLowerCase();
  const v = { vendor: ctx.vendor, model: ctx.model, role: ctx.role, status, detail: raw };
  if (has(b, 'data_inspection_failed', 'content_filter', 'content filter', 'sensitive', '敏感', '审核', 'inappropriate', 'safety system', 'moderation', 'content_policy')) return callError('content_filtered', v);
  if (has(b, 'model_not_found', 'does not exist', 'not exist', 'invalid model', 'model not found', '模型不存在', 'unknown model', 'no such model', /model .* not (found|supported)/)) {
    if ((status === 404 || status === 400 || status === 422 || status === 403) && !has(b, 'not activated', '未开通')) return callError('model_not_found', v);
  }
  if (status === 403 && has(b, 'not activated', '未开通', 'access denied', 'accessdenied', 'not enabled', 'no permission to access model', '没有权限', 'not authorized to access')) return callError('model_not_enabled', v);
  if (has(b, 'does not support', 'not support this', 'unsupported', '不支持') && !has(b, 'tools', 'tool_choice', 'function')) {
    if (has(b, 'size', 'resolution', '尺寸', '分辨率')) return callError('size_unsupported', { ...v, detail: '这个模型不支持所选尺寸' });
    if (status === 400 || status === 404 || status === 422) return callError('capability_mismatch', v);
  }
  if (status === 401 || (status === 403 && has(b, 'key', 'auth', 'token')) || has(b, 'invalid_api_key', 'incorrect api key', 'invalid api key', 'authentication', 'unauthorized')) return callError('key_invalid', v);
  if (status === 402 || has(b, 'insufficient', 'quota', 'balance', '余额', '欠费', 'arrear', 'billing')) return callError('quota', v);
  if (status === 429) return callError('rate_limited', v);
  if (status === 408 || status === 504) return callError('timeout', v);
  if (status >= 500) return callError('server', v);
  if (status === 404) return callError('address', v);
  return callError('unknown', { ...v, detail: raw.slice(0, 120) || `HTTP ${status}` });
}
export function classifyThrownError(e: unknown, opts: { web: boolean; offline?: boolean; timedOut?: boolean }): CallError {
  if (opts.timedOut) return callError('timeout');
  if (e && typeof e === 'object' && (e as Error).name === 'AbortError') return callError('aborted');
  if (opts.offline) return callError('network_offline');
  if (opts.web) return callError('cors');
  return callError('network');
}
