/** 本机设置：模型配置、写作助手覆盖、热点源、用量与日志。全部在本机（IndexedDB），密钥不进日志与默认备份。 */
import { db, emitStoreChange } from './db';
import type { ProviderConfig } from './llm';
import { presetOf } from '../data/providers';
import { addModelEntry, emptyModelsV3, findSecrets, legacyVendor, ModelsMigrator, normalizeModelName, removeModelEntry, type LegacyProvider, type ModelsStateV2, type ModelsStateV3, type ProviderAccount } from '@content-agent/shared';
import { deleteSecret, getSecret, setSecret } from './secrets';

export interface ModelsState {
  providers: ProviderConfig[];
  /** 默认写作模型：服务商 id（模型取该服务商配置里的 model） */
  defaultProvider: string | null;
  advanced: { thinking: 'off' | 'on'; temperature: number | null; fallbackProvider: string | null };
}
export const EMPTY_MODELS: Readonly<ModelsState> = { providers: [], defaultProvider: null, advanced: { thinking: 'off', temperature: null, fallbackProvider: null } };

/**
 * 0.9.0：模型配置的唯一存储是 kv `models_v3`（ModelsStateV3，按能力角色，不含 Key）+ 加密的 `secrets`。
 * 这里保留 0.6–0.8 的“服务商视角”接口（getModels / saveModels / ProviderConfig），由 v3 + 解密的 Key 实时推导，
 * 让既有的写作、Agent 对话、测试连接代码不用改；首次读取时把旧 kv `models`（含明文 Key）迁移到 v3 + secrets，并把旧值里的 Key 抹掉（ADR-003 / ADR-004）。
 */
export async function getModels(): Promise<ModelsState> {
  const v3 = await getModelsV3();
  const providers: ProviderConfig[] = [];
  for (const a of v3.accounts) {
    const chat = a.models.find((e) => e.roles.includes('chat')) ?? a.models.find((e) => e.roles.some((r) => r === 'reason' || r === 'fast'));
    if (!chat && !a.extra?.v2) continue;
    const p = chat?.lastProbe;
    providers.push({
      id: a.id, label: a.label, protocol: (a.extra?.protocol as ProviderConfig['protocol']) ?? (a.vendor === 'anthropic' ? 'anthropic' : 'openai'), baseURL: a.baseURL, apiKey: await getSecret(a.secretRef), model: chat?.model ?? '',
      ...(a.extra?.custom ? { custom: true } : {}), ...(a.extra?.toolMode ? { toolMode: a.extra.toolMode as 'native' | 'json' } : {}),
      ...(p ? { check: { ok: p.ok, at: p.at, ms: p.ms, model: p.respondedModel, reason: p.reason } } : {}),
    });
  }
  const chat = v3.roles.chat;
  return { providers, defaultProvider: chat.primary?.accountId ?? null, advanced: { thinking: v3.advanced?.thinking ?? 'off', temperature: v3.advanced?.temperature ?? null, fallbackProvider: chat.fallback?.accountId ?? null } };
}
export const MODELS_CHANGED = 'ca:models-changed';
export async function saveModels(m: ModelsState): Promise<void> {
  const v3 = await getModelsV3();
  const keep = v3.accounts.filter((a) => !a.extra?.v2 || m.providers.some((p) => p.id === a.id));
  // 被删除的“服务商视角”账号：同时清掉它的 Key 与所有绑定
  for (const a of v3.accounts) if (!keep.includes(a)) { if (a.secretRef) await deleteSecret(a.secretRef); for (const e of a.models) Object.assign(v3, { roles: removeModelEntry(v3, e.id).roles }); }
  v3.accounts = v3.accounts.filter((a) => keep.some((k) => k.id === a.id));
  for (const p of m.providers) {
    const found = v3.accounts.find((x) => x.id === p.id);
    const a: ProviderAccount = found ?? { id: p.id, vendor: legacyVendor(p), label: p.label, baseURL: p.baseURL, region: p.id === 'ollama' ? 'local' : 'cn', models: [], secretRef: `secret:${p.id}`, hasKey: false, preset: p.custom ? undefined : p.id, extra: { v2: '1' } };
    if (!found) v3.accounts.push(a);
    a.label = p.label; a.baseURL = p.baseURL; a.vendor = legacyVendor(p);
    a.extra = { ...(a.extra ?? {}), v2: '1', protocol: p.protocol, ...(p.custom ? { custom: '1' } : {}), ...(p.toolMode ? { toolMode: p.toolMode } : {}) };
    a.secretRef ??= `secret:${p.id}`;
    const key = p.apiKey?.trim() ?? '';
    if (key) { if ((await getSecret(a.secretRef)) !== key) await setSecret(a.secretRef, key); a.hasKey = true; a.keyTail = key.slice(-4); }
    else { await deleteSecret(a.secretRef); a.hasKey = false; a.keyTail = undefined; }
    const name = normalizeModelName(p.model ?? '');
    let e = a.models.find((x) => x.roles.includes('chat'));
    if (name && !e) { const r = addModelEntry(a, { model: name, roles: ['chat'], source: 'manual' }); if (r.ok) e = r.entry; }
    else if (e && name && e.model !== name) { e.model = name; e.status = 'untested'; e.lastProbe = undefined; e.updatedAt = Date.now(); for (const b of Object.values(v3.roles)) for (const t of [b.primary, b.fallback]) if (t?.modelEntryId === e.id) t.model = name; }
    if (e && p.check) { e.lastProbe = { ok: p.check.ok, at: p.check.at, ms: p.check.ms, reason: p.check.reason, requestedModel: e.model, respondedModel: p.check.model }; e.status = p.check.ok ? 'ok' : 'failed'; }
  }
  const target = (id: string | null | undefined) => { const a = v3.accounts.find((x) => x.id === id); const e = a?.models.find((x) => x.roles.includes('chat')); return a && e ? { accountId: a.id, modelEntryId: e.id, model: e.model } : undefined; };
  v3.roles.chat = { ...v3.roles.chat, primary: target(m.defaultProvider), fallback: m.advanced.fallbackProvider && m.advanced.fallbackProvider !== m.defaultProvider ? target(m.advanced.fallbackProvider) : undefined };
  v3.advanced = { ...(v3.advanced ?? {}), thinking: m.advanced.thinking, temperature: m.advanced.temperature };
  await saveModelsV3(v3);
  // 0.8.1：通知所有已挂载的页面（Agent 面板常驻不卸载）重新读取模型配置
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MODELS_CHANGED));
}

/* ---------- 0.9.0 能力角色配置（v3） ---------- */
let migrating: Promise<void> | null = null;
/** 首次读取：旧 kv `models`（v2，含明文 Key）→ v3 + secrets；旧值抹掉 Key 后保留为回滚快照 models_v2_backup。幂等。 */
export async function migrateModelsIfNeeded(): Promise<void> {
  return (migrating ??= (async () => {
    const have = await db.getKV<ModelsStateV3>('models_v3');
    if (have?.schemaVersion === 3) return;
    const old = await db.getKV<ModelsStateV2 & { providers: (LegacyProvider & { apiKey?: string })[] }>('models');
    const v3 = old ? ModelsMigrator.migrate<ModelsStateV3 & { legacy?: unknown }>({ ...old, schemaVersion: 2 }).doc : emptyModelsV3();
    for (const a of v3.accounts) a.extra = { ...(a.extra ?? {}), v2: '1', ...(old?.providers.find((p) => p.id === a.id)?.custom ? { custom: '1' } : {}) };
    for (const p of old?.providers ?? []) if (p.apiKey?.trim()) await setSecret(`secret:${p.id}`, p.apiKey);
    delete (v3 as { legacy?: unknown }).legacy;
    await db.setKV('models_v3', v3);
    if (old) { await db.setKV('models_v2_backup', { ...old, providers: old.providers.map((p) => ({ ...p, apiKey: undefined })) }); await db.setKV('models', { ...old, providers: old.providers.map((p) => ({ ...p, apiKey: '' })), migratedTo: 3 }); }
    const sch = (await db.getKV<Record<string, number>>('schema')) ?? {};
    await db.setKV('schema', { ...sch, db: 3, models: 3 });
  })().finally(() => { migrating = null; }));
}
export async function getModelsV3(): Promise<ModelsStateV3> {
  await migrateModelsIfNeeded();
  const v = await db.getKV<ModelsStateV3>('models_v3');
  return v ? { ...emptyModelsV3(), ...v, roles: { ...emptyModelsV3().roles, ...v.roles } } : emptyModelsV3();
}
export async function saveModelsV3(v: ModelsStateV3): Promise<void> {
  if (findSecrets(JSON.stringify(v)).length) throw new Error('模型配置里出现了疑似 Key，已拒绝保存（Key 只能存安全存储）');
  await db.setKV('models_v3', v);
  emitStoreChange('kv:models');   // 兼容 0.8.1 的订阅键：所有读 getModels 的常驻组件立即刷新
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
  /** 0.9.0（prefs schemaVersion 2）：实验功能开关覆盖、花钱确认阈值（单次 / 当日，元）、Key 共用方式 */
  schemaVersion?: number; flags?: Record<string, boolean>; spend?: { perCallConfirmYuan: number; perDayConfirmYuan: number }; keyPolicy?: 'account' | 'per-role';
}
export const DEFAULT_PREFS: Prefs = { platforms: [], onboarded: false, backupHinted: false, hotSources: ['baidu', 'solidot', 'sspai', '36kr'], schemaVersion: 2, flags: {}, spend: { perCallConfirmYuan: 1, perDayConfirmYuan: 10 }, keyPolicy: 'account' };
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
