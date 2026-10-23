/**
 * 模型配置 v3（5.2 + 5.10）：账号（一家服务商的一把 Key + 地址）→ 模型名条目（任意多个，各勾能力）→ 角色绑定（默认 / 备用 / 按任务）。
 * - 模型名由用户决定：原样保存、原样发送（只去首尾空白）；代码不写死任何模型名。
 * - Key 不在本结构里：只存 secretRef（"secret:<账号 id>"），值在本机安全存储（web/src/local/secure.ts）。
 * - 迁移 v2（0.6–0.8 的 {providers[], defaultProvider}）→ v3 可前滚可回滚（ModelsMigrator）。
 */
import { Migrator } from '../core/migrate.js';
import { ROLE_IDS, isRoleId, type RoleId } from './roles.js';
import type { CapabilityDecl } from './decl.js';

export type ModelStatus = 'untested' | 'ok' | 'not_found' | 'not_enabled' | 'not_in_list' | 'deprecated' | 'failed';
export interface ProbeResult { ok: boolean; at: string; ms?: number; reason?: string; kind?: string; requestedModel?: string; respondedModel?: string; paid?: boolean; detail?: string }
export interface ModelEntry {
  id: string; accountId: string; model: string; label?: string; roles: RoleId[];
  decl?: Partial<CapabilityDecl>; declSource?: 'user' | 'provider' | 'builtin';
  source: 'manual' | 'fetched' | 'migrated'; status: ModelStatus;
  lastProbe?: ProbeResult; probes?: Partial<Record<RoleId, ProbeResult>>;
  addedAt: number; updatedAt: number;
  /** ComfyUI / Replicate：工作流 JSON 与字段对照（见 5.10.7） */
  workflow?: { json: string; map: Record<string, string> };
}
export interface ProviderAccount {
  id: string; vendor: string; label: string; baseURL: string; nativeBaseURL?: string; workspaceId?: string;
  secretRef?: string; keyTail?: string; hasKey?: boolean;
  region: 'cn' | 'global' | 'local' | 'test';
  extra?: Record<string, string>; headers?: Record<string, string>;
  models: ModelEntry[]; listSupport?: 'yes' | 'no' | 'unknown'; listFetchedAt?: number;
  preset?: string;
}
export interface RoleTarget { accountId: string; modelEntryId: string; model: string; options?: Record<string, unknown>; overrideBaseURL?: string; overrideSecretRef?: string }
export interface RoleBinding { role: RoleId; primary?: RoleTarget; fallback?: RoleTarget; tasks?: Record<string, RoleTarget>; enabled: boolean; check?: ProbeResult }
export interface Price { unit: 'token' | 'image' | 'second' | 'char' | 'minute' | 'call'; input?: number; output?: number; cachedInput?: number; per?: number }
export interface BudgetPolicy { perCallConfirmYuan: number; perDayConfirmYuan: number; videoAlwaysConfirm: true; unknownPriceMediaConfirm: true }
export interface KeyPolicy { scope: 'account' | 'per-role' }
export interface ModelsStateV3 {
  schemaVersion: 3; accounts: ProviderAccount[]; roles: Record<RoleId, RoleBinding>; prices: Record<string, Price>;
  budget: BudgetPolicy; keyPolicy: KeyPolicy; advanced: { thinking: 'off' | 'on'; temperature: number | null };
}
export const DEFAULT_BUDGET: BudgetPolicy = { perCallConfirmYuan: 1, perDayConfirmYuan: 10, videoAlwaysConfirm: true, unknownPriceMediaConfirm: true };

export function emptyRoles(): Record<RoleId, RoleBinding> {
  return Object.fromEntries(ROLE_IDS.map((r) => [r, { role: r, enabled: true }])) as Record<RoleId, RoleBinding>;
}
export function emptyModelsV3(): ModelsStateV3 {
  return { schemaVersion: 3, accounts: [], roles: emptyRoles(), prices: {}, budget: { ...DEFAULT_BUDGET }, keyPolicy: { scope: 'account' }, advanced: { thinking: 'off', temperature: null } };
}

/* ---------------- 模型名输入规则（5.10.2，7 条） ---------------- */
export type ModelNameError = 'empty' | 'too_long' | 'newline' | 'control' | 'duplicate';
export const MODEL_NAME_MESSAGES: Record<ModelNameError, string> = {
  empty: '模型名不能为空', too_long: '模型名最长 256 个字符', newline: '模型名里不能有换行', control: '模型名里不能有控制字符', duplicate: '这个模型名已经添加过',
};
/** 规则 1/2：只去首尾空白，其余原样（大小写、/ : . _ - 都保留）；不做白名单、不改写。 */
export function normalizeModelName(input: string): string { return input.replace(/^[\s\u3000]+|[\s\u3000]+$/g, ''); }
export function checkModelName(input: string): ModelNameError | null {
  const raw = input.replace(/^[ \t\u3000]+|[ \t\u3000]+$/g, '');
  if (/[\r\n]/.test(raw)) return 'newline';
  const v = normalizeModelName(input);
  if (!v) return 'empty';
  if ([...v].length > 256) return 'too_long';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(v)) return 'control';
  return null;
}
/** 规则 3：同账号内“模型名 + 能力”完全相同的重复项不允许。 */
export function isDuplicateEntry(acc: ProviderAccount, model: string, roles: RoleId[], exceptId?: string): boolean {
  const m = normalizeModelName(model);
  const key = [...roles].sort().join(',');
  return acc.models.some((e) => e.id !== exceptId && e.model === m && [...e.roles].sort().join(',') === key);
}

let seq = 0;
export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function addModelEntry(acc: ProviderAccount, input: { model: string; roles: RoleId[]; label?: string; source?: ModelEntry['source']; decl?: Partial<CapabilityDecl>; declSource?: ModelEntry['declSource'] }, now = Date.now()): { ok: true; entry: ModelEntry } | { ok: false; error: ModelNameError | 'no_roles' } {
  const err = checkModelName(input.model);
  if (err) return { ok: false, error: err };
  const roles = input.roles.filter(isRoleId);
  if (!roles.length) return { ok: false, error: 'no_roles' };
  if (isDuplicateEntry(acc, input.model, roles)) return { ok: false, error: 'duplicate' };
  const entry: ModelEntry = { id: newId('m'), accountId: acc.id, model: normalizeModelName(input.model), roles, source: input.source ?? 'manual', status: 'untested', addedAt: now, updatedAt: now };
  if (input.label?.trim()) entry.label = input.label.trim();
  if (input.decl) { entry.decl = input.decl; entry.declSource = input.declSource ?? 'user'; }
  acc.models.push(entry);
  return { ok: true, entry };
}

/** 删除模型名前：列出被哪些绑定引用（5.10.1）。 */
export function referencesOf(state: ModelsStateV3, modelEntryId: string): { role: RoleId; slot: string }[] {
  const out: { role: RoleId; slot: string }[] = [];
  for (const b of Object.values(state.roles)) {
    if (b.primary?.modelEntryId === modelEntryId) out.push({ role: b.role, slot: '默认' });
    if (b.fallback?.modelEntryId === modelEntryId) out.push({ role: b.role, slot: '备用' });
    for (const [task, t] of Object.entries(b.tasks ?? {})) if (t.modelEntryId === modelEntryId) out.push({ role: b.role, slot: `任务 ${task}` });
  }
  return out;
}
/** 确认删除后：被引用的位置变为“未配置”，不静默改用别的模型。 */
export function removeModelEntry(state: ModelsStateV3, modelEntryId: string): ModelsStateV3 {
  const s = structuredClone(state);
  for (const a of s.accounts) a.models = a.models.filter((m) => m.id !== modelEntryId);
  for (const b of Object.values(s.roles)) {
    if (b.primary?.modelEntryId === modelEntryId) delete b.primary;
    if (b.fallback?.modelEntryId === modelEntryId) delete b.fallback;
    if (b.tasks) for (const [k, t] of Object.entries(b.tasks)) if (t.modelEntryId === modelEntryId) delete b.tasks[k];
  }
  return s;
}
export function findEntry(state: ModelsStateV3, modelEntryId: string): { account: ProviderAccount; entry: ModelEntry } | null {
  for (const a of state.accounts) { const e = a.models.find((m) => m.id === modelEntryId); if (e) return { account: a, entry: e }; }
  return null;
}
/** 角色的候选：所有勾了该能力的模型名（“显示名（模型名）· 服务商”）。 */
export function candidatesFor(state: ModelsStateV3, role: RoleId): { account: ProviderAccount; entry: ModelEntry; text: string }[] {
  const out: { account: ProviderAccount; entry: ModelEntry; text: string }[] = [];
  for (const a of state.accounts) for (const e of a.models) if (e.roles.includes(role)) out.push({ account: a, entry: e, text: `${displayModel(e)} · ${a.label}` });
  return out;
}
/** 5.10.5：有显示名时“显示名（模型名）”，否则只显示模型名。 */
export function displayModel(e: Pick<ModelEntry, 'label' | 'model'>): string { return e.label ? `${e.label}（${e.model}）` : e.model; }
export function bindRole(state: ModelsStateV3, role: RoleId, slot: 'primary' | 'fallback', entry: ModelEntry): ModelsStateV3 {
  const s = structuredClone(state);
  s.roles[role] = { ...s.roles[role], [slot]: { accountId: entry.accountId, modelEntryId: entry.id, model: entry.model } };
  return s;
}
/** “已接 N / 11 类”：有默认绑定且绑定的条目存在、账号有 Key（或免 Key 的本地类）。 */
export function configuredRoles(state: ModelsStateV3, noKeyVendors: string[] = ['ollama', 'comfyui', 'mock']): RoleId[] {
  return ROLE_IDS.filter((r) => {
    const t = state.roles[r]?.primary;
    if (!t || state.roles[r]?.enabled === false) return false;
    const f = findEntry(state, t.modelEntryId);
    return !!f && (f.account.hasKey || noKeyVendors.includes(f.account.vendor) || !!t.overrideSecretRef);
  });
}

/* ---------------- 导出（5.10.9）：不含 Key / 请求头值 / 列表缓存 / 探测原始响应 ---------------- */
export function exportModels(state: ModelsStateV3): Record<string, unknown> {
  return {
    $schema: 'models.schema.json', version: 3, schemaVersion: 3,
    accounts: state.accounts.map((a) => ({
      id: a.id, vendor: a.vendor, label: a.label, baseURL: a.baseURL, ...(a.nativeBaseURL ? { nativeBaseURL: a.nativeBaseURL } : {}), ...(a.workspaceId ? { workspaceId: a.workspaceId } : {}),
      region: a.region, secretRef: `secret:${a.id}`, ...(a.headers ? { headers: Object.fromEntries(Object.keys(a.headers).map((k) => [k, '***'])) } : {}),
      models: a.models.map((m) => ({ id: m.id, model: m.model, ...(m.label ? { label: m.label } : {}), roles: m.roles, ...(m.decl ? { decl: m.decl } : {}), source: m.source, status: m.status })),
    })),
    roles: Object.fromEntries(Object.entries(state.roles).map(([k, b]) => [k, {
      enabled: b.enabled, ...(b.primary ? { primary: stripTarget(b.primary) } : {}), ...(b.fallback ? { fallback: stripTarget(b.fallback) } : {}),
      ...(b.tasks ? { tasks: Object.fromEntries(Object.entries(b.tasks).map(([t, v]) => [t, stripTarget(v)])) } : {}),
    }])),
    budget: state.budget, keyPolicy: state.keyPolicy,
  };
}
const stripTarget = (t: RoleTarget) => ({ accountId: t.accountId, modelEntryId: t.modelEntryId, model: t.model, ...(t.options ? { options: t.options } : {}), ...(t.overrideBaseURL ? { overrideBaseURL: t.overrideBaseURL } : {}) });

/** 导入：模型名与绑定原样恢复；缺 Key 的账号标 hasKey=false（“需要填 Key”）；冲突交给调用方逐条选择。 */
export function importModels(cur: ModelsStateV3, incoming: Record<string, any>, choose: (c: { accountId: string; model: string; roles: RoleId[] }) => 'local' | 'incoming' = () => 'local'): ModelsStateV3 {
  const s = structuredClone(cur);
  for (const ia of (incoming.accounts ?? []) as any[]) {
    let acc = s.accounts.find((a) => a.id === ia.id);
    if (!acc) { acc = { id: ia.id, vendor: ia.vendor, label: ia.label, baseURL: ia.baseURL, region: ia.region ?? 'cn', models: [], hasKey: false, secretRef: `secret:${ia.id}` }; s.accounts.push(acc); }
    for (const im of (ia.models ?? []) as any[]) {
      const roles = (im.roles ?? []).filter(isRoleId) as RoleId[];
      const dup = acc.models.find((e) => e.model === im.model && [...e.roles].sort().join() === [...roles].sort().join());
      if (dup) { if (choose({ accountId: acc.id, model: im.model, roles }) === 'incoming') Object.assign(dup, { label: im.label, decl: im.decl }); continue; }
      acc.models.push({ id: im.id ?? newId('m'), accountId: acc.id, model: String(im.model), label: im.label, roles, decl: im.decl, source: im.source ?? 'manual', status: 'untested', addedAt: Date.now(), updatedAt: Date.now() });
    }
  }
  for (const [role, b] of Object.entries(incoming.roles ?? {}) as [string, any][]) {
    if (!isRoleId(role)) continue;
    const cb = s.roles[role];
    if (!cb.primary && b.primary) cb.primary = b.primary;
    if (!cb.fallback && b.fallback) cb.fallback = b.fallback;
    if (b.tasks) cb.tasks = { ...b.tasks, ...(cb.tasks ?? {}) };
  }
  return s;
}

/* ---------------- 迁移 v2 ↔ v3 ---------------- */
export interface LegacyProvider { id: string; label: string; protocol: 'openai' | 'anthropic'; baseURL: string; apiKey?: string; model: string; custom?: boolean; toolMode?: 'native' | 'json'; check?: { ok: boolean; at: string; ms?: number; model?: string; reason?: string } }
export interface ModelsStateV2 { schemaVersion?: 2; providers: LegacyProvider[]; defaultProvider: string | null; advanced?: { thinking: 'off' | 'on'; temperature: number | null; fallbackProvider: string | null } }

const legacyVendor = (p: LegacyProvider) => (p.protocol === 'anthropic' ? 'anthropic' : p.id === 'mimo' ? 'mimo' : p.id === 'ollama' ? 'ollama' : p.id === 'zhipu' ? 'zhipu' : p.id === 'dashscope' ? 'dashscope' : p.id === 'ark' ? 'ark' : p.id === 'minimax' ? 'minimax' : p.id === 'gemini' ? 'gemini' : 'openai-compatible');

/** v2 → v3（纯函数、幂等）：每个旧 provider 生成一个账号 + 一条 migrated 模型名（名字原样）；defaultProvider → chat.primary；fallbackProvider → chat.fallback。 */
export function upV2toV3(v2: ModelsStateV2): ModelsStateV3 & { legacy: ModelsStateV2 } {
  const s = emptyModelsV3();
  for (const p of v2.providers ?? []) {
    const acc: ProviderAccount = { id: p.id, vendor: legacyVendor(p), label: p.label, baseURL: p.baseURL, region: p.id === 'ollama' ? 'local' : 'cn', models: [], secretRef: `secret:${p.id}`, hasKey: !!p.apiKey?.trim(), keyTail: p.apiKey ? p.apiKey.slice(-4) : undefined, preset: p.custom ? undefined : p.id, extra: { protocol: p.protocol, ...(p.toolMode ? { toolMode: p.toolMode } : {}) } };
    if (normalizeModelName(p.model ?? '')) {
      acc.models.push({ id: `m-${p.id}-chat`, accountId: p.id, model: normalizeModelName(p.model), roles: ['chat'], source: 'migrated', status: p.check?.ok ? 'ok' : 'untested', addedAt: 0, updatedAt: 0, ...(p.check ? { lastProbe: { ok: p.check.ok, at: p.check.at, ms: p.check.ms, reason: p.check.reason, requestedModel: p.model, respondedModel: p.check.model } } : {}) });
    }
    s.accounts.push(acc);
  }
  const target = (id: string | null | undefined): RoleTarget | undefined => {
    const a = s.accounts.find((x) => x.id === id);
    const e = a?.models[0];
    return a && e ? { accountId: a.id, modelEntryId: e.id, model: e.model } : undefined;
  };
  const pri = target(v2.defaultProvider) ?? target(s.accounts.find((a) => a.models.length)?.id);
  if (pri) s.roles.chat.primary = pri;
  const fb = target(v2.advanced?.fallbackProvider);
  if (fb && fb.modelEntryId !== pri?.modelEntryId) s.roles.chat.fallback = fb;
  if (v2.advanced) s.advanced = { thinking: v2.advanced.thinking, temperature: v2.advanced.temperature };
  return { ...s, legacy: { providers: (v2.providers ?? []).map((p) => ({ ...p, apiKey: undefined })), defaultProvider: v2.defaultProvider, advanced: v2.advanced } };
}
/** v3 → v2（回滚）：chat 角色绑定还原为 providers + defaultProvider；其他角色无法表达，保留在 v3 备份里（由调用方存 models_v3_backup）。 */
export function downV3toV2(v3: ModelsStateV3 & { legacy?: ModelsStateV2 }): ModelsStateV2 {
  const providers: LegacyProvider[] = v3.accounts.map((a) => {
    const old = v3.legacy?.providers.find((p) => p.id === a.id);
    const chatEntry = a.models.find((m) => m.roles.includes('chat')) ?? a.models[0];
    return { ...(old ?? {}), id: a.id, label: a.label, protocol: (a.extra?.protocol as 'openai' | 'anthropic') ?? (a.vendor === 'anthropic' ? 'anthropic' : 'openai'), baseURL: a.baseURL, model: chatEntry?.model ?? old?.model ?? '', ...(a.extra?.toolMode ? { toolMode: a.extra.toolMode as 'native' | 'json' } : {}) };
  });
  const chat = v3.roles.chat;
  return {
    providers, defaultProvider: chat?.primary?.accountId ?? v3.legacy?.defaultProvider ?? null,
    advanced: { thinking: v3.advanced?.thinking ?? 'off', temperature: v3.advanced?.temperature ?? null, fallbackProvider: chat?.fallback?.accountId ?? null },
  };
}
export const ModelsMigrator = new Migrator<ModelsStateV3>('模型配置', 3, 2)
  .add({ from: 2, to: 3, name: 'models v2→v3（按能力角色）', up: (d: ModelsStateV2) => upV2toV3(d), down: (d: ModelsStateV3) => downV3toV2(d) });

/** 是否命中下线记录（数据来自 config/model-deprecations.json）。 */
export interface Deprecation { model: string; vendorHint?: string; date: string; replacements: string[]; url?: string }
export function deprecationOf(model: string, list: Deprecation[]): Deprecation | undefined { return list.find((d) => d.model === model); }
/** 获取列表后：不在列表里的标 not_in_list；同前缀新名字最多 3 个“可能的替代”（只提示，不替换）。 */
export function markAgainstList(acc: ProviderAccount, listed: string[]): { entryId: string; model: string; suggestions: string[] }[] {
  const set = new Set(listed);
  const out: { entryId: string; model: string; suggestions: string[] }[] = [];
  for (const e of acc.models) {
    if (set.has(e.model)) { if (e.status === 'not_in_list') e.status = 'untested'; continue; }
    e.status = 'not_in_list';
    const prefix = e.model.split(/[-:./]/)[0] ?? '';
    out.push({ entryId: e.id, model: e.model, suggestions: prefix ? listed.filter((x) => x.startsWith(prefix)).slice(0, 3) : [] });
  }
  return out;
}
