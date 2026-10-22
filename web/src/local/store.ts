/** 本机设置：模型配置、写作助手覆盖、热点源、用量与日志。全部在本机（IndexedDB），密钥不进日志与默认备份。 */
import { db } from './db';
import type { ProviderConfig } from './llm';
import { presetOf } from '../data/providers';

export interface ModelsState {
  providers: ProviderConfig[];
  /** 默认写作模型：服务商 id（模型取该服务商配置里的 model） */
  defaultProvider: string | null;
  advanced: { thinking: 'off' | 'on'; temperature: number | null; fallbackProvider: string | null };
}
export const EMPTY_MODELS: Readonly<ModelsState> = { providers: [], defaultProvider: null, advanced: { thinking: 'off', temperature: null, fallbackProvider: null } };

export async function getModels(): Promise<ModelsState> {
  const m = await db.getKV<ModelsState>('models');
  // 注意：必须复制数组，避免 upsert 时 push 改到 EMPTY_MODELS 常量本身
  return { ...EMPTY_MODELS, ...(m ?? {}), providers: [...(m?.providers ?? [])], advanced: { ...EMPTY_MODELS.advanced, ...(m?.advanced ?? {}) } };
}
export const MODELS_CHANGED = 'ca:models-changed';
export async function saveModels(m: ModelsState): Promise<void> {
  await db.setKV('models', m);
  // 0.8.1：通知所有已挂载的页面（Agent 面板常驻不卸载）重新读取模型配置
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MODELS_CHANGED));
}

export async function upsertProvider(cfg: ProviderConfig): Promise<ModelsState> {
  const m = await getModels();
  const i = m.providers.findIndex((p) => p.id === cfg.id);
  if (i >= 0) m.providers[i] = cfg; else m.providers.push(cfg);
  // 第一次连通的服务自动成为默认写作模型
  if (cfg.check?.ok && (!m.defaultProvider || !m.providers.some((p) => p.id === m.defaultProvider && p.check?.ok))) m.defaultProvider = cfg.id;
  await saveModels(m);
  return m;
}
export async function removeProvider(id: string): Promise<ModelsState> {
  const m = await getModels();
  m.providers = m.providers.filter((p) => p.id !== id);
  if (m.defaultProvider === id) m.defaultProvider = m.providers.find((p) => p.check?.ok)?.id ?? null;
  await saveModels(m);
  return m;
}

/**
 * 0.8.1：唯一的“是否已配置”判断——首页、Agent 面板、模型胶囊、写作页、生成全都用它，避免一处说“未连接”另一处能发。
 * 填了 Key 即视为已配置（免 Key 服务如 Ollama 填了地址即可）；“测试连接”没通过或没测只做提示，不拦发送，发送失败由模型层给白话原因。
 */
export function isConfigured(p: ProviderConfig): boolean {
  if (p.apiKey?.trim()) return true;
  if (presetOf(p.id)?.noKey) return !!p.baseURL?.trim();
  return !!p.check?.ok;
}
export function configuredProviders(m: Pick<ModelsState, 'providers'>): ProviderConfig[] { return m.providers.filter(isConfigured); }
export function hasConfiguredModel(m: Pick<ModelsState, 'providers'> | null | undefined): boolean { return !!m && m.providers.some(isConfigured); }
/** 测试状态（只用于提示）：ok 已连通 / untested 没测过 / failed 上次测试没通过。 */
export function checkState(p: ProviderConfig): 'ok' | 'untested' | 'failed' { return p.check?.ok ? 'ok' : p.check ? 'failed' : 'untested'; }

/** 选择用哪个服务：指定的 → 默认 → 任一已连通 → 任一已填 Key；都只在“已配置”的服务里选。 */
export function resolveProvider(m: ModelsState, override?: { providerId?: string | null; model?: string | null }): ProviderConfig | null {
  const usable = configuredProviders(m);
  const byId = (id?: string | null) => (id ? usable.find((p) => p.id === id) : undefined);
  const base = byId(override?.providerId) ?? byId(m.defaultProvider) ?? usable.find((p) => p.check?.ok) ?? usable[0] ?? null;
  if (!base) return null;
  // 指定的模型名只用在它所属的服务上；指定服务不可用而回退时，用回退服务自己的模型
  const modelFits = !!override?.model && (!override.providerId || override.providerId === base.id);
  return modelFits ? { ...base, model: override!.model! } : base;
}

/** 当前可用于写作的服务。 */
export async function activeProvider(override?: { providerId?: string | null; model?: string | null }): Promise<ProviderConfig | null> {
  return resolveProvider(await getModels(), override);
}

export function newProviderConfig(id: string): ProviderConfig {
  const p = presetOf(id);
  return { id, label: p?.label ?? (id.startsWith('custom-') ? '自定义服务' : id), protocol: p?.protocol ?? 'openai', baseURL: p?.baseURL ?? '', apiKey: '', model: p?.models[0] ?? '', ...(id.startsWith('custom-') ? { custom: true } : {}) };
}

/* ---------- 写作助手覆盖 ---------- */
export interface AssistantOverride { body?: string; providerId?: string | null; model?: string | null }
export async function getAssistantOverrides(): Promise<Record<string, AssistantOverride>> { return (await db.getKV<Record<string, AssistantOverride>>('assistants')) ?? {}; }
export async function setAssistantOverride(platform: string, o: AssistantOverride | null): Promise<void> {
  const all = await getAssistantOverrides();
  if (o) all[platform] = o; else delete all[platform];
  await db.setKV('assistants', all);
}

/* ---------- 偏好 ---------- */
export interface Prefs {
  platforms: string[]; onboarded: boolean; backupHinted: boolean; hotSources: string[];
  /** 0.8.0 侧栏顺序、自定义网站、保活上限、平台↔会话绑定、关闭角标的平台、Agent 面板停靠边 */
  platformOrder?: string[]; customSites?: { id: string; label: string; url: string }[]; keepAlive?: number;
  bindSessions?: boolean; sessionBindings?: Record<string, string>; badgeOff?: string[]; agentDock?: 'right' | 'left'; newWindow?: 'inplace' | 'system';
}
export const DEFAULT_PREFS: Prefs = { platforms: [], onboarded: false, backupHinted: false, hotSources: ['baidu', 'solidot', 'sspai', '36kr'] };
export async function getPrefs(): Promise<Prefs> { return { ...DEFAULT_PREFS, ...((await db.getKV<Prefs>('prefs')) ?? {}) }; }
export async function setPrefs(p: Partial<Prefs>): Promise<Prefs> { const n = { ...(await getPrefs()), ...p }; await db.setKV('prefs', n); return n; }

/* ---------- 用量与日志 ---------- */
export interface UsageDay { date: string; calls: number; cost: number; input: number; output: number }
const today = () => new Date().toISOString().slice(0, 10);
export async function addUsage(cost: number, usage: { input: number; output: number }): Promise<void> {
  const all = (await db.getKV<UsageDay[]>('usage')) ?? [];
  const d = today();
  let row = all.find((u) => u.date === d);
  if (!row) { row = { date: d, calls: 0, cost: 0, input: 0, output: 0 }; all.push(row); }
  row.calls++; row.cost += cost; row.input += usage.input; row.output += usage.output;
  await db.setKV('usage', all.slice(-60));
}
export async function usageToday(): Promise<UsageDay> {
  const all = (await db.getKV<UsageDay[]>('usage')) ?? [];
  return all.find((u) => u.date === today()) ?? { date: today(), calls: 0, cost: 0, input: 0, output: 0 };
}
export async function log(level: 'info' | 'warn' | 'error', message: string, detail?: string): Promise<void> {
  await db.insert('logs', { level, message, detail: detail ?? '' });
  const all = await db.all('logs');
  if (all.length > 300) for (const r of all.slice(0, all.length - 300)) await db.del('logs', r.id);
}
