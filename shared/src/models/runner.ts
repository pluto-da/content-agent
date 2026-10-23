/**
 * 统一能力层执行器（5.4–5.6）：callRole(role, req) → Result，绝不抛出未分类异常。
 * 选目标（本轮 @ 覆盖 > 按任务路由 > 默认；fast/reason 未配置回退 chat）→ 大小守卫 → 缓存 → 发送（超时 / 取消）→ 分类 →
 * 可重试类错误指数退避 1/2/4 秒 ±20%（最多 2 次，尊重 Retry-After）→ 仍失败且有备用时切备用一次（卡片写明）→ 记账。
 * 传输、取 Key、记账、缓存存储都由调用方注入（本机 runner 与服务端 hub 共用）。
 */
import { adapterOf, type AdapterCtx, type HttpRequest, type HttpResponse, type Parsed, type RoleRequest, type Usage } from './adapters/index.js';
import { callError, classifyGeneric, classifyThrownError, NEVER_FALLBACK, type CallError } from './errors.js';
import { findEntry, type ModelsStateV3, type ProviderAccount, type RoleTarget } from './config.js';
import { mergeDecl, guardInput, type CapabilityDecl } from './decl.js';
import { costOf, priceOf } from './pricing.js';
import { cacheKey, cacheable } from './cache.js';
import { HealthTracker } from './health.js';
import { roleLabel, type RoleId } from './roles.js';
import { resolveModel, type Resolved } from './unify.js';
import { redact } from '../core/redact.js';

export class TransportError extends Error { constructor(msg: string, public flags: { timedOut?: boolean; offline?: boolean; aborted?: boolean } = {}) { super(msg); this.name = flags.aborted ? 'AbortError' : 'TransportError'; } }
export interface Transport { send(req: HttpRequest, o: { signal?: AbortSignal; timeoutMs: number }): Promise<HttpResponse> }
export interface UsageRecord { at: string; role: RoleId; vendor: string; model: string; requestedModel: string; respondedModel?: string; usage: Usage; cost: number | null; ms: number; ok: boolean; errorKind?: string; runId?: string; toolCallId?: string; conversationId?: number; fromCache?: boolean; fallback?: boolean; thinking?: boolean }
export interface CallDeps {
  state: ModelsStateV3;
  getKey(account: ProviderAccount, target: RoleTarget): Promise<string>;
  transport: Transport;
  web?: boolean;
  online?(): boolean;
  health?: HealthTracker;
  onUsage?(r: UsageRecord): void | Promise<void>;
  cache?: { get(k: string): Promise<Parsed | undefined>; set(k: string, v: Parsed): Promise<void> };
  sleep?(ms: number, signal?: AbortSignal): Promise<void>;
  random?(): number;
  healthRouting?: boolean;
}
export interface CallOpts { override?: RoleTarget | null; task?: string; signal?: AbortSignal; timeoutMs?: number; retry?: { max: number; baseMs: number }; runId?: string; toolCallId?: string; conversationId?: number; noFallback?: boolean; inputSize?: Parameters<typeof guardInput>[1] }
export type CallResult =
  | { ok: true; value: Parsed['value']; usage: Usage; cost: number | null; ms: number; target: RoleTarget; account: ProviderAccount; decl: CapabilityDecl; respondedModel?: string; fromCache?: boolean; warnings: string[]; usedFallback?: boolean; note?: string }
  | { ok: false; error: CallError; ms: number; target?: RoleTarget; account?: ProviderAccount };

export const DEFAULT_TIMEOUTS: Record<RoleId, number> = { chat: 180000, reason: 240000, fast: 30000, vision: 60000, image: 120000, imageEdit: 120000, tts: 60000, asr: 90000, video: 30000, embed: 30000, rerank: 30000 };

/** 选目标（1.1.0）：唯一的选模型链在 unify.ts resolveModel —— 本轮 @ 覆盖 > 按任务指定 > 主模型 > 同服务商 > 其他已接入 > 无。这里只是兼容旧调用名。 */
export function resolveTarget(state: ModelsStateV3, role: RoleId, o: { override?: RoleTarget | null; task?: string; health?: HealthTracker; healthRouting?: boolean } = {}): Resolved | null {
  return resolveModel(state, o.task, role, o);
}

const defaultSleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => { const t = setTimeout(res, ms); signal?.addEventListener('abort', () => { clearTimeout(t); rej(new TransportError('已停止', { aborted: true })); }, { once: true }); });

export async function callRole(role: RoleId, req: RoleRequest, deps: CallDeps, o: CallOpts = {}): Promise<CallResult> {
  const started = Date.now();
  const picked = resolveTarget(deps.state, role, { override: o.override, task: o.task, health: deps.health, healthRouting: deps.healthRouting });
  if (!picked) return { ok: false, error: callError('role_not_configured', { role }), ms: 0 };
  // reason 回退到 chat 时开思考
  const effReq: RoleRequest = picked.via === 'role-fallback' && role === 'reason' && 'messages' in req && picked.thinking !== false ? { ...req, role: 'chat', thinking: true } as RoleRequest : picked.via === 'role-fallback' && role === 'fast' && 'messages' in req ? { ...req, role: 'chat' } as RoleRequest : req;
  const first = await attempt(picked.target, effReq, deps, o);
  if (first.ok || !picked.fallback || o.noFallback || !first.error.retriable || NEVER_FALLBACK.has(first.error.kind)) return { ...first, ms: Date.now() - started };
  const fbEntry = findEntry(deps.state, picked.fallback.modelEntryId);
  const second = await attempt(picked.fallback, effReq, deps, o, true);
  if (second.ok) return { ...second, ms: Date.now() - started, usedFallback: true, note: `默认「${picked.target.model}」${first.error.kind === 'timeout' ? '超时' : '出错'}，已改用备用：${fbEntry?.entry.label ? `${fbEntry.entry.label}（${picked.fallback.model}）` : picked.fallback.model}`, warnings: [...second.warnings, `默认模型失败：${first.error.reason}`] };
  return { ...second, ms: Date.now() - started };
}

async function attempt(target: RoleTarget, req: RoleRequest, deps: CallDeps, o: CallOpts, isFallback = false): Promise<CallResult> {
  const t0 = Date.now();
  const found = findEntry(deps.state, target.modelEntryId);
  if (!found) return { ok: false, error: callError('role_not_configured', { role: req.role as RoleId }), ms: 0, target };
  const { account, entry } = found;
  const adapter = adapterOf(account.vendor);
  if (!adapter) return { ok: false, error: callError('unknown', { detail: `未知的接口类型 ${account.vendor}` }), ms: 0, target, account };
  const role = req.role as RoleId;
  if (!adapter.roles.includes(role)) return { ok: false, error: callError('capability_mismatch', { model: target.model, role }), ms: 0, target, account };
  const decl = mergeDecl(role, account.vendor, target.model, adapter.declare(role, target.model), entry.decl);
  if (o.inputSize) { const g = guardInput(decl, o.inputSize); if (!g.ok) return { ok: false, error: { ...callError(g.kind, { limit: g.reason }), reason: g.reason, advice: g.advice }, ms: 0, target, account }; }
  if (deps.online && !deps.online()) return { ok: false, error: callError('network_offline'), ms: 0, target, account };
  const key = await deps.getKey(account, target).catch(() => '');
  if (adapter.keyRequired && !key && !target.overrideSecretRef) return { ok: false, error: callError('key_invalid', { vendor: account.label, detail: '还没填 Key' }), ms: 0, target, account };
  const ctx: AdapterCtx = { account, target, apiKey: key, baseURL: target.overrideBaseURL || account.baseURL || adapter.defaultBaseURL, options: target.options };
  const ck = deps.cache && cacheable(req) ? cacheKey(role, account.vendor, target.model, req) : null;
  if (ck) { const hit = await deps.cache!.get(ck); if (hit) { const r = finish(hit, true); return r; } }
  const max = o.retry?.max ?? 2, base = o.retry?.baseMs ?? 1000;
  const sleep = deps.sleep ?? defaultSleep, rnd = deps.random ?? Math.random;
  let lastErr: CallError = callError('unknown');
  for (let i = 0; i <= max; i++) {
    try {
      let parsed: Parsed;
      if (adapter.local) {
        try { parsed = adapter.local(req, ctx); } catch (e: any) { if (typeof e?.status === 'number') throw { __http: true, status: e.status, text: e.body }; throw e; }
      } else {
        const httpReq = adapter.build(req, ctx);
        const res = await deps.transport.send(httpReq, { signal: o.signal, timeoutMs: o.timeoutMs ?? DEFAULT_TIMEOUTS[role] });
        if (res.status >= 400) throw { __http: true, status: res.status, text: res.text ?? '', retryAfter: res.headers?.['retry-after'] };
        parsed = adapter.parse(req, res, ctx);
      }
      if (ck) await deps.cache!.set(ck, parsed).catch(() => {});
      deps.health?.record(`${account.id}:${target.model}`, true);
      return finish(parsed, false);
    } catch (e: any) {
      if (e?.__http) {
        lastErr = adapter.classify?.(e.status, e.text, { ...ctx, role }) ?? classifyGeneric(e.status, e.text, { vendor: account.label, model: target.model, role, secrets: [key] });
        if (lastErr.kind === 'rate_limited' && e.retryAfter) { const s = Number(e.retryAfter); if (s > 0 && s <= 30 && i < max) { await sleep(s * 1000, o.signal).catch(() => {}); continue; } }
      } else if (e instanceof TransportError || e?.name === 'AbortError' || e instanceof TypeError) {
        lastErr = e?.name === 'AbortError' || e?.flags?.aborted ? callError('aborted') : classifyThrownError(e, { web: !!deps.web, offline: e.flags?.offline, timedOut: e.flags?.timedOut });
      } else if (e?.name === 'ParseError') {
        lastErr = callError('format', { detail: e.message });
      } else lastErr = callError('unknown', { detail: redact(String(e?.message ?? e), [key]) });
      if (lastErr.retriable) deps.health?.record(`${account.id}:${target.model}`, false);
      if (!lastErr.retriable || lastErr.kind === 'aborted' || i === max) break;
      const delay = base * 2 ** i * (1 + (rnd() * 0.4 - 0.2));
      try { await sleep(delay, o.signal); } catch { lastErr = callError('aborted'); break; }
    }
  }
  await deps.onUsage?.({ at: new Date().toISOString(), role, vendor: account.vendor, model: target.model, requestedModel: target.model, usage: {}, cost: 0, ms: Date.now() - t0, ok: false, errorKind: lastErr.kind, runId: o.runId, toolCallId: o.toolCallId, conversationId: o.conversationId, fallback: isFallback });
  return { ok: false, error: lastErr, ms: Date.now() - t0, target, account };

  function finish(parsed: Parsed, fromCache: boolean): CallResult {
    const cost = fromCache ? 0 : costOf(priceOf(account.vendor, target.model, deps.state.prices), parsed.usage);
    void deps.onUsage?.({ at: new Date().toISOString(), role, vendor: account.vendor, model: target.model, requestedModel: target.model, respondedModel: parsed.respondedModel, usage: parsed.usage, cost, ms: Date.now() - t0, ok: true, runId: o.runId, toolCallId: o.toolCallId, conversationId: o.conversationId, fromCache, fallback: isFallback });
    return { ok: true, value: parsed.value, usage: parsed.usage, cost, ms: Date.now() - t0, target, account, decl, respondedModel: parsed.respondedModel, fromCache, warnings: parsed.warnings ?? [] };
  }
}

/** 异步任务轮询一次（jobs 持久化与退避由调用方负责：2s→4s→8s…上限 30s，总时限按声明，默认 15 分钟）。 */
export async function pollJob(target: RoleTarget, jobId: string, deps: CallDeps, o: { signal?: AbortSignal } = {}): Promise<CallResult> {
  const t0 = Date.now();
  const found = findEntry(deps.state, target.modelEntryId);
  if (!found) return { ok: false, error: callError('role_not_configured', { role: 'video' }), ms: 0 };
  const adapter = adapterOf(found.account.vendor);
  if (!adapter?.poll) return { ok: false, error: callError('unknown', { detail: '这家服务没有提供任务查询接口' }), ms: 0 };
  const key = await deps.getKey(found.account, target).catch(() => '');
  const ctx: AdapterCtx = { account: found.account, target, apiKey: key, baseURL: target.overrideBaseURL || found.account.baseURL || adapter.defaultBaseURL, options: target.options };
  try {
    const res = adapter.local ? { status: 200, text: '{}' } : await deps.transport.send(adapter.poll.build(jobId, ctx), { signal: o.signal, timeoutMs: 30000 });
    if (res.status >= 400) return { ok: false, error: adapter.classify?.(res.status, res.text ?? '', { ...ctx, role: 'video' }) ?? classifyGeneric(res.status, res.text ?? '', { secrets: [key] }), ms: Date.now() - t0, target };
    const p = adapter.poll.parse(res, ctx);
    const decl = mergeDecl('video', found.account.vendor, target.model, adapter.declare('video', target.model), found.entry.decl);
    return { ok: true, value: p.value, usage: p.usage, cost: costOf(priceOf(found.account.vendor, target.model, deps.state.prices), p.usage), ms: Date.now() - t0, target, account: found.account, decl, warnings: [] };
  } catch (e: any) {
    return { ok: false, error: e?.name === 'AbortError' ? callError('aborted') : classifyThrownError(e, { web: !!deps.web, offline: e?.flags?.offline, timedOut: e?.flags?.timedOut }), ms: Date.now() - t0, target };
  }
}
export const nextPollDelay = (attempt: number): number => Math.min(30000, 2000 * 2 ** attempt);

/** 获取模型列表（5.10.3）：404/405 → listSupport='no'；失败从不阻塞手填。 */
export async function listModels(account: ProviderAccount, deps: Pick<CallDeps, 'transport' | 'web'> & { apiKey: string }): Promise<{ ok: true; models: { id: string; caps?: Record<string, unknown>; contextLength?: number }[] } | { ok: false; error: CallError; unsupported?: boolean }> {
  const adapter = adapterOf(account.vendor);
  if (!adapter?.listModels) return { ok: false, unsupported: true, error: { ...callError('unknown'), reason: '这家服务没有提供模型列表，请手动填写模型名（可参考服务商文档里的模型 ID）', advice: '获取失败不影响手填与保存' } };
  try {
    const res = adapter.local ? { status: 200, text: '{}' } : await deps.transport.send(adapter.listModels.build({ account, apiKey: deps.apiKey, baseURL: account.baseURL || adapter.defaultBaseURL }), { timeoutMs: 20000 });
    if (res.status === 404 || res.status === 405) return { ok: false, unsupported: true, error: { ...callError('address', { status: res.status }), reason: '这家服务没有提供模型列表，请手动填写模型名（可参考服务商文档里的模型 ID）', advice: '获取失败不影响手填与保存' } };
    if (res.status === 401 || res.status === 403) return { ok: false, error: { ...callError('key_invalid', { vendor: account.label, status: res.status }), reason: 'Key 不对或没有权限，先检查 Key' } };
    if (res.status >= 400) return { ok: false, error: classifyGeneric(res.status, res.text ?? '', { secrets: [deps.apiKey] }) };
    return { ok: true, models: adapter.listModels.parse(res) };
  } catch (e: any) {
    return { ok: false, error: classifyThrownError(e, { web: !!deps.web, offline: e?.flags?.offline, timedOut: e?.flags?.timedOut }) };
  }
}
export const roleName = roleLabel;
