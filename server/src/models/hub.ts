import type { DB } from '../db.js';
import { getSetting, setSetting } from '../db.js';
import type { SecretVault } from '../crypto.js';
import type { HttpClient } from '../http.js';
import { defaultHttp } from '../http.js';
import { BUILTIN_PROVIDERS } from './providers.js';
import { createAdapter } from './adapters.js';
import { mockAdapter } from './mock.js';
import type { WsFactory } from './cosyvoice.js';
import { estimateTokens, isThinkingModel, planMaxTokens } from './util.js';
import type {
  AsrResult, AudioResult, BaseResult, Capability, ChatMessage, ChatOptions, ChatResult, EmbedResult, ImageEditOptions, ImageInput, ImageResult, ProviderAdapter, ProviderDef, RerankResult, Usage, VideoResult,
} from './types.js';
import { CAPABILITIES, CAPABILITY_LABELS, NotConfiguredError, NotSupportedError } from './types.js';

/** model：模型名；editModel：图像编辑模型名（image 能力）；voice：语音合成音色（tts 能力） */
export interface RouteTarget { provider: string; model?: string; editModel?: string; voice?: string; /** 思考模式（不填按模型名推断） */ thinking?: boolean }
export interface CapabilityRoute { default?: RouteTarget; fallback?: RouteTarget; tasks?: Record<string, RouteTarget> }
export type Routes = Partial<Record<Capability, CapabilityRoute>>;
export interface ProviderOverride { baseURL?: string; nativeBaseURL?: string; useProxy?: boolean; models?: Partial<Record<Capability, string>>; imageEditModel?: string; ttsVoice?: string }
/** 单价：token 为每百万；image 为每张；char 为每万字符；second 为每分钟；call 为每次。cachedInput：缓存命中输入每百万（不填按 input 计）。 */
export interface Price { input?: number; output?: number; cachedInput?: number }

/** 健康路由：近 windowMin 分钟内样本 ≥ minSamples 且失败率 ≥ maxFailRate 视为不健康，主路不健康时先走备用。 */
export interface HealthPolicy { windowMin: number; minSamples: number; maxFailRate: number }
export const DEFAULT_HEALTH: HealthPolicy = { windowMin: 30, minSamples: 4, maxFailRate: 0.5 };
export interface ProviderHealth { provider: string; calls: number; failed: number; failRate: number; p50: number; p95: number }

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

const CAP_METHOD: Record<Capability, keyof ProviderAdapter> = {
  llm: 'chat', vision: 'vision', ocr: 'vision', image: 'image', tts: 'tts', asr: 'asr', video: 'video', embedding: 'embed',
};

export function computeCost(usage: Usage, price: Price | undefined): number {
  if (!price) return 0;
  const i = price.input ?? 0;
  const o = price.output ?? 0;
  switch (usage.unit) {
    case 'token': {
      const cached = Math.min(usage.cachedInput ?? 0, usage.input);
      const ci = price.cachedInput ?? i;
      return ((usage.input - cached) * i + cached * ci + usage.output * o) / 1_000_000;
    }
    case 'image': return usage.output * (o || i);
    case 'char': return (usage.input / 10_000) * i;
    case 'second': return (usage.input / 60) * i;
    case 'call': return usage.input * i;
  }
}

export class ModelHub {
  private adapterOverride = new Map<string, ProviderAdapter>();
  constructor(
    private readonly db: DB,
    private readonly vault: SecretVault,
    private readonly http: HttpClient = defaultHttp,
    private readonly opts: { pollMs?: number; pollMax?: number; wsFactory?: WsFactory } = {},
  ) {}

  /** 测试用：替换某个提供方的适配器。 */
  setAdapter(providerId: string, adapter: ProviderAdapter): void {
    this.adapterOverride.set(providerId, adapter);
  }

  providers(): ProviderDef[] {
    const ov = getSetting<Record<string, ProviderOverride>>(this.db, 'models.providers', {});
    return BUILTIN_PROVIDERS.map((p) => {
      const o = ov[p.id] ?? {};
      return {
        ...p, baseURL: o.baseURL ?? p.baseURL, nativeBaseURL: o.nativeBaseURL ?? p.nativeBaseURL, useProxy: o.useProxy ?? p.useProxy, models: { ...p.models, ...(o.models ?? {}) },
        imageEditModel: o.imageEditModel ?? p.imageEditModel, ttsVoice: o.ttsVoice ?? p.ttsVoice,
      };
    });
  }

  routes(): Routes { return getSetting<Routes>(this.db, 'models.routes', {}); }
  setRoutes(r: Routes): void { setSetting(this.db, 'models.routes', r); }
  prices(): Record<string, Price> { return getSetting<Record<string, Price>>(this.db, 'models.prices', {}); }

  private provider(id: string): ProviderDef | undefined { return this.providers().find((p) => p.id === id); }

  /** 判断某提供方是否已具备调用条件。 */
  providerReady(def: ProviderDef): { ok: boolean; reason?: string } {
    if (def.protocol === 'mock') return { ok: true };
    if (def.secretName && !this.vault.has(def.secretName)) return { ok: false, reason: `缺少密钥 ${def.secretName}` };
    if (!def.baseURL || def.baseURL.includes('{')) return { ok: false, reason: '基础地址未填写完整' };
    return { ok: true };
  }

  private resolve(cap: Capability, task: string, which: 'primary' | 'fallback', kind: 'default' | 'edit' = 'default'): { def: ProviderDef; model: string; target: RouteTarget } {
    const r = this.routes()[cap];
    const target = which === 'primary' ? (r?.tasks?.[task] ?? r?.default) : r?.fallback;
    if (!target) throw new NotConfiguredError(cap, which === 'primary' ? '尚未选择提供方' : '无备用提供方');
    const def = this.provider(target.provider);
    if (!def) throw new NotConfiguredError(cap, `提供方 ${target.provider} 不存在`);
    if (!def.capabilities.includes(cap)) throw new NotConfiguredError(cap, `${def.label} 不提供该能力`);
    const ready = this.providerReady(def);
    if (!ready.ok) throw new NotConfiguredError(cap, `${def.label}：${ready.reason}`);
    if (kind === 'edit') {
      const model = target.editModel || def.imageEditModel || '';
      if (!model) throw new NotConfiguredError(cap, `${def.label} 未填写图像编辑模型名（或该提供方未接图像编辑）`);
      return { def, model, target };
    }
    const model = target.model || def.models[cap] || '';
    if (!model) throw new NotConfiguredError(cap, `${def.label} 未填写模型名`);
    return { def, model, target };
  }

  private adapter(def: ProviderDef): ProviderAdapter {
    const o = this.adapterOverride.get(def.id);
    if (o) return o;
    if (def.protocol === 'mock') return mockAdapter();
    return createAdapter({
      def, apiKey: def.secretName ? (this.vault.get(def.secretName) ?? '') : '', http: this.http,
      proxy: getSetting<string>(this.db, 'proxy.url', '') || undefined,
      pollMs: this.opts.pollMs, pollMax: this.opts.pollMax,
      comfyWorkflow: getSetting<string>(this.db, 'models.comfyui.workflow', '') || undefined,
      wsFactory: this.opts.wsFactory,
    });
  }

  private record(cap: Capability, task: string, r: BaseResult | null, def: ProviderDef, model: string, ok: boolean, ms: number): void {
    const usage = r?.usage ?? { unit: 'call' as const, input: 0, output: 0 };
    const prices = this.prices();
    const cost = computeCost(usage, prices[`${def.id}:${model}`] ?? prices[def.id]);
    this.db.prepare('INSERT INTO usage(task, provider, model, prompt_tokens, completion_tokens, cost, ms, ok, cached_tokens) VALUES(?,?,?,?,?,?,?,?,?)').run(
      `${cap}:${task}:${usage.unit}`, def.id, model, usage.input, usage.output, cost, ms, ok ? 1 : 0, usage.unit === 'token' && typeof usage.cachedInput === 'number' ? usage.cachedInput : null,
    );
  }

  /** 统一执行：主提供方 → 失败时启用备用（并在结果中注明实际提供方）。 */
  private async run<T extends BaseResult>(
    cap: Capability, task: string, call: (a: ProviderAdapter, model: string, target: RouteTarget, def: ProviderDef) => Promise<T> | undefined,
    kind: 'default' | 'edit' = 'default',
  ): Promise<T & { fallbackUsed?: boolean; routedBy?: 'health' }> {
    const attempt = async (which: 'primary' | 'fallback') => {
      const { def, model, target } = this.resolve(cap, task, which, kind);
      const a = this.adapter(def);
      if (typeof a[kind === 'edit' ? 'imageEdit' : CAP_METHOD[cap]] !== 'function') throw new NotSupportedError(def.label, cap);
      const started = Date.now();
      try {
        const p = call(a, model, target, def);
        if (!p) throw new NotSupportedError(def.label, cap);
        const r = await p;
        this.record(cap, kind === 'edit' ? `edit:${task}` : task, r, def, model, true, Date.now() - started);
        return r;
      } catch (e) {
        this.record(cap, kind === 'edit' ? `edit:${task}` : task, null, def, model, false, Date.now() - started);
        throw e;
      }
    };
    const hasFallback = !!this.routes()[cap]?.fallback;
    // 健康路由：主路近期失败率过高且备用健康时，先走备用；备用也失败再回主路
    if (hasFallback && this.healthRoutingEnabled()) {
      const primaryId = this.routeProviderId(cap, task, 'primary');
      const fallbackId = this.routeProviderId(cap, task, 'fallback');
      if (primaryId && fallbackId && primaryId !== fallbackId && !this.isHealthy(primaryId) && this.isHealthy(fallbackId)) {
        try {
          const r = await attempt('fallback');
          return { ...r, fallbackUsed: true, routedBy: 'health' as const };
        } catch (e) {
          if (e instanceof NotConfiguredError) throw e;
        }
        return await attempt('primary');
      }
    }
    try {
      return await attempt('primary');
    } catch (primaryErr) {
      if (primaryErr instanceof NotConfiguredError) throw primaryErr;
      if (!hasFallback) throw primaryErr;
      const r = await attempt('fallback');
      return { ...r, fallbackUsed: true };
    }
  }

  private routeProviderId(cap: Capability, task: string, which: 'primary' | 'fallback'): string | undefined {
    const r = this.routes()[cap];
    return (which === 'primary' ? (r?.tasks?.[task] ?? r?.default) : r?.fallback)?.provider;
  }

  healthPolicy(): HealthPolicy & { enabled: boolean } {
    return { enabled: true, ...DEFAULT_HEALTH, ...getSetting<Partial<HealthPolicy & { enabled: boolean }>>(this.db, 'models.health', {}) };
  }
  private healthRoutingEnabled(): boolean { return this.healthPolicy().enabled; }

  isHealthy(providerId: string): boolean {
    const p = this.healthPolicy();
    const rows = this.db.prepare("SELECT ok FROM usage WHERE provider = ? AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 50").all(providerId, `-${p.windowMin} minutes`) as { ok: number }[];
    if (rows.length < p.minSamples) return true;
    return rows.filter((r) => !r.ok).length / rows.length < p.maxFailRate;
  }

  /** 各服务商近期成功率与延迟分位数（运行状态页与健康路由共用）。 */
  health(minutes = 24 * 60): ProviderHealth[] {
    const rows = this.db.prepare("SELECT provider, ms, ok FROM usage WHERE created_at >= datetime('now', ?)").all(`-${Math.max(1, Math.floor(minutes))} minutes`) as { provider: string; ms: number; ok: number }[];
    const by = new Map<string, { ms: number[]; failed: number }>();
    for (const r of rows) {
      const e = by.get(r.provider) ?? { ms: [], failed: 0 };
      e.ms.push(r.ms);
      if (!r.ok) e.failed++;
      by.set(r.provider, e);
    }
    return [...by.entries()].map(([provider, e]) => {
      const sorted = [...e.ms].sort((a, b) => a - b);
      return { provider, calls: sorted.length, failed: e.failed, failRate: sorted.length ? e.failed / sorted.length : 0, p50: percentile(sorted, 50), p95: percentile(sorted, 95) };
    }).sort((a, b) => b.calls - a.calls);
  }

  /** 解析某能力某任务当前会用到的提供方与模型（不调用），供评测记录模型版本。 */
  resolveInfo(cap: Capability, task: string): { provider: string; model: string; jsonMode?: string; supportsSeed?: boolean } {
    const { def, model } = this.resolve(cap, task, 'primary');
    return { provider: def.id, model, jsonMode: def.jsonMode, supportsSeed: def.supportsSeed };
  }

  /**
   * 统一对话入口：按思考模式给 max_tokens 默认值（非思考 8192 / 思考 65536，受提供方输出上限截断），
   * 请求前粗估提示词长度做上下文上限预检；思考内容只在 reasoning 字段，不进入 content。
   */
  chat(task: string, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
    const promptTokens = estimateTokens(messages.map((m) => m.content).join('\n'));
    return this.run('llm', task, (a, m, target, def) => {
      const thinking = isThinkingModel(m, opts.thinking ?? target.thinking);
      const maxTokens = planMaxTokens(promptTokens, { thinking, requested: opts.maxTokens, maxOutput: def.maxOutputTokens, contextWindow: def.contextWindow });
      return a.chat?.(messages, m, { ...opts, thinking, maxTokens });
    });
  }
  vision(task: string, images: ImageInput[], prompt: string): Promise<ChatResult> { return this.run('vision', task, (a, m) => a.vision?.(images, prompt, m)); }
  ocr(task: string, images: ImageInput[]): Promise<ChatResult> {
    return this.run('ocr', task, (a, m) => a.vision?.(images, '请做 OCR：逐行输出图片中的全部文字，不要解释，不要补充图片中没有的文字。', m));
  }
  image(task: string, prompt: string, opts?: { n?: number; size?: string }): Promise<ImageResult> { return this.run('image', task, (a, m) => a.image?.(prompt, m, opts)); }
  /** 图像编辑：输入 1-3 张图（url / base64）+ 编辑指令。路由沿用 image 能力（tasks.edit 可单独指定），按输出张数计费。 */
  imageEdit(task: string, images: ImageInput[], instruction: string, opts?: ImageEditOptions): Promise<ImageResult> {
    if (!images.length) return Promise.reject(new Error('图像编辑需要至少一张输入图'));
    if (!instruction.trim()) return Promise.reject(new Error('图像编辑需要编辑指令'));
    return this.run('image', task.startsWith('edit') ? task : 'edit', (a, m) => a.imageEdit?.(images, instruction, m, opts), 'edit');
  }
  /** 音色优先级：调用参数 → 路由 voice → 提供方默认音色。 */
  tts(task: string, text: string, opts?: { voice?: string }): Promise<AudioResult> {
    return this.run('tts', task, (a, m, target, def) => a.tts?.(text, m, { voice: opts?.voice || target.voice || def.ttsVoice }));
  }
  asr(task: string, audio: { url?: string; data?: Buffer; mime?: string }): Promise<AsrResult> { return this.run('asr', task, (a, m) => a.asr?.(audio, m)); }
  video(task: string, prompt: string, opts?: { imageUrl?: string }): Promise<VideoResult> { return this.run('video', task, (a, m) => a.video?.(prompt, m, opts)); }
  videoStatus(task: string, taskId: string): Promise<VideoResult> { return this.run('video', task, (a, m) => a.videoStatus?.(taskId, m)); }
  embed(task: string, texts: string[]): Promise<EmbedResult> { return this.run('embedding', task, (a, m) => a.embed?.(texts, m)); }
  rerank(task: string, query: string, docs: string[]): Promise<RerankResult> { return this.run('embedding', task, (a, m) => a.rerank?.(query, docs, m)); }

  /** 各能力模块的状态，用于界面显示“已配置 / 未配置”。 */
  status(): { capability: Capability; label: string; configured: boolean; provider?: string; model?: string; reason?: string }[] {
    return CAPABILITIES.map((cap) => {
      try {
        const { def, model } = this.resolve(cap, 'default', 'primary');
        return { capability: cap, label: CAPABILITY_LABELS[cap], configured: true, provider: def.id, model };
      } catch (e) {
        return { capability: cap, label: CAPABILITY_LABELS[cap], configured: false, reason: e instanceof Error ? e.message : String(e) };
      }
    });
  }

  /** 图像编辑是否可用（与其他能力一致：未配置时给出原因）。 */
  imageEditStatus(): { configured: boolean; provider?: string; model?: string; reason?: string } {
    try {
      const { def, model } = this.resolve('image', 'edit', 'primary', 'edit');
      const a = this.adapter(def);
      if (typeof a.imageEdit !== 'function') return { configured: false, reason: new NotSupportedError(def.label, 'image').message };
      return { configured: true, provider: def.id, model };
    } catch (e) {
      return { configured: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  isConfigured(cap: Capability): boolean {
    return this.status().find((s) => s.capability === cap)?.configured ?? false;
  }

  costSummary(days = 30): { byDay: unknown[]; byCapability: unknown[]; byProvider: unknown[]; total: number } {
    const since = `-${Math.max(1, Math.floor(days))} days`;
    const byDay = this.db.prepare("SELECT date(created_at) AS day, ROUND(SUM(cost), 6) AS cost, COUNT(*) AS calls FROM usage WHERE created_at >= datetime('now', ?) GROUP BY day ORDER BY day").all(since);
    const byCapability = this.db.prepare("SELECT substr(task, 1, instr(task, ':') - 1) AS capability, ROUND(SUM(cost), 6) AS cost, COUNT(*) AS calls, SUM(ok = 0) AS failed FROM usage WHERE created_at >= datetime('now', ?) GROUP BY capability").all(since);
    const byProvider = this.db.prepare("SELECT provider, model, ROUND(SUM(cost), 6) AS cost, COUNT(*) AS calls, SUM(prompt_tokens) AS input, SUM(completion_tokens) AS output FROM usage WHERE created_at >= datetime('now', ?) GROUP BY provider, model").all(since);
    const total = (this.db.prepare("SELECT COALESCE(SUM(cost), 0) AS t FROM usage WHERE created_at >= datetime('now', ?)").get(since) as { t: number }).t;
    return { byDay, byCapability, byProvider, total };
  }
}
