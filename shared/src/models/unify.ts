/**
 * 1.1.0 模型归一（PROMPT-v1.1 第五部分）：用户视角的主键是“我接了哪家、哪个模型”，能力是模型的属性。
 * - 角色（RoleId）只作内部实现（适配器、卡片、计费）；界面只显示 8 个能力：对话 / 思考 / 看图 / 生图 / 改图 / 配音 / 转写 / 视频（向量、重排在“高级 → 检索”）。
 * - resolveModel(state, task, need) 是唯一的选模型链：
 *     ① 用户在“高级 → 按任务指定”为该任务 / 该能力指定的模型 → ② 覆盖该能力的主模型 → ③ 同服务商同能力的模型
 *     → ④ 其他已接入且覆盖该能力的模型 → ⑤ 无（提示“补一个”）。
 *   深度思考（reason）是同一模型的档位：没有单独指定时用覆盖“对话”的模型并打开思考；省钱档（fast）没有便宜型号时用主模型。
 * - schemaVersion 3 → 4：出现次数最多的对话模型成为主模型；其余角色绑定原样保留为“按任务指定”；迁移前快照可回滚。
 */
import { adapterOf } from './adapters/index.js';
import { findEntry, type ModelEntry, type ModelsStateV3, type ProviderAccount, type RoleTarget } from './config.js';
import type { HealthTracker } from './health.js';
import type { RoleId } from './roles.js';

/** 面向用户的 8 个能力（顺序即能力覆盖一览的顺序）。 */
export type CapId = 'chat' | 'think' | 'vision' | 'image' | 'imageEdit' | 'tts' | 'asr' | 'video';
export interface CapDef { id: CapId; label: string; role: RoleId; icon: string }
export const CAPS: readonly CapDef[] = Object.freeze([
  { id: 'chat', label: '对话', role: 'chat', icon: 'bot' },
  { id: 'think', label: '思考', role: 'reason', icon: 'compass' },
  { id: 'vision', label: '看图', role: 'vision', icon: 'eye' },
  { id: 'image', label: '生图', role: 'image', icon: 'wand' },
  { id: 'imageEdit', label: '改图', role: 'imageEdit', icon: 'edit' },
  { id: 'tts', label: '配音', role: 'tts', icon: 'mic' },
  { id: 'asr', label: '转写', role: 'asr', icon: 'list' },
  { id: 'video', label: '视频', role: 'video', icon: 'creator' },
] as CapDef[]);
/** 高级 → 检索（默认隐藏，仅开启 search.vector 时出现）。 */
export const RETRIEVAL_CAPS: readonly { id: 'embed' | 'rerank'; label: string; role: RoleId }[] = Object.freeze([
  { id: 'embed', label: '向量', role: 'embed' }, { id: 'rerank', label: '重排', role: 'rerank' },
] as { id: 'embed' | 'rerank'; label: string; role: RoleId }[]);
export const capOfRole = (r: RoleId): CapId | null => CAPS.find((c) => c.role === r)?.id ?? null;
export const capLabel = (c: CapId): string => CAPS.find((x) => x.id === c)?.label ?? c;

/* ---------------- 能力自动识别：适配器声明 ∩ 模型名规则（只按文档常见命名，宁少勿多；用户可在服务商详情里手动更正） ---------------- */
const RULES: { re: RegExp; roles: RoleId[] }[] = [
  { re: /rerank/i, roles: ['rerank'] },
  { re: /embed|bge-|m3e/i, roles: ['embed'] },
  { re: /(^|[-_/])(tts|t2a)|speech-0|speech-2|cosyvoice|sambert|qwen-?tts|mimo-.*tts|glm-tts|seed-tts|text-to-speech/i, roles: ['tts'] },
  { re: /(^|[-_/])(asr|stt)|whisper|paraformer|sensevoice|transcri|fun-asr|glm-asr|seed-asr/i, roles: ['asr'] },
  { re: /video|t2v|i2v|kling|hailuo|seedance|cogvideo|vidu|veo-?\d|sora|wan\d?\.?\d*-(t2v|i2v)/i, roles: ['video'] },
  { re: /image-?edit|-edit\b|kontext|inpaint|seededit|qwen-image-edit|wanx.*edit/i, roles: ['imageEdit'] },
  { re: /mock-image|seedream|wanx|wan\d?\.?\d*-t2i|flux|stable-diffusion|sdxl|cogview|dall-?e|gpt-image|imagen|qwen-image|image-0\d|(^|[-_/])t2i/i, roles: ['image'] },
];
const VISION = /(^|[-_/])vl\b|-vl-|vision|omni|4o|gpt-4\.1|gpt-5|gemini|claude|glm-\d(\.\d+)?v|glm-4v|doubao-seed|seed-1\.[68]|mimo-v2\.5|mimo-v2\.6|kimi-k2\.5|qwen3\.[5-9]|qwen3-vl|qvq|step-1v|step-1o|mock-omni|mock-all/i;
const THINK = /think|reason|(^|[-_/])r1\b|qwq|qwen3|deepseek|glm-4\.[5-9]|glm-[5-9]|kimi-k2|mimo|doubao-seed|seed-1\.|(^|[-_/])o[134](-|$)|gpt-5|claude|gemini-2\.5|gemini-3|minimax-m|mock-omni|mock-all/i;
const CHEAP = /flash|mini\b|-mini|lite|turbo|air\b|-air|nano|haiku|small|(^|[-_])\d{1,2}b\b/i;

/** 按服务商与模型名推断它能做什么（RoleId 内部表示）。只用于预填，用户手动勾选优先。 */
export function inferRoles(vendor: string, model: string): RoleId[] {
  const supported = adapterOf(vendor)?.roles;
  const m = model.trim();
  let roles: RoleId[];
  if (/^mock-all$/i.test(m)) roles = ['chat', 'reason', 'fast', 'vision', 'image', 'imageEdit', 'tts', 'asr', 'video'];
  else {
    const hit = RULES.find((r) => r.re.test(m));
    if (hit) roles = [...hit.roles];
    else if (vendor === 'openai-compatible' || vendor === 'anthropic') roles = ['chat'];   // 自定义 / 兼容地址：只认名字里明示的生成型能力，其余由用户勾选
    else {
      roles = ['chat'];
      if (THINK.test(m)) roles.push('reason');
      if (VISION.test(m)) roles.push('vision');
      if (CHEAP.test(m)) roles.push('fast');
    }
  }
  const out = supported ? roles.filter((r) => supported.includes(r)) : roles;
  return out.length ? out : supported?.includes('chat') ? ['chat'] : (supported?.slice(0, 1) ?? ['chat']);
}

/** 条目是否覆盖某内部角色：reason 允许“对话模型开思考”，fast 允许任何对话模型。 */
export function entryCovers(e: Pick<ModelEntry, 'roles'>, need: RoleId, o: { soft?: boolean } = {}): boolean {
  if (e.roles.includes(need)) return true;
  if (o.soft && (need === 'reason' || need === 'fast')) return e.roles.includes('chat');
  return false;
}
/** 条目的能力标签（面向用户；fast 不显示）。 */
export function capsOfEntry(e: Pick<ModelEntry, 'roles'>): CapId[] { return CAPS.filter((c) => e.roles.includes(c.role)).map((c) => c.id); }

export function mainOf(state: ModelsStateV3): { account: ProviderAccount; entry: ModelEntry; target: RoleTarget } | null {
  const t = state.main; if (!t) return null;
  const f = findEntry(state, t.modelEntryId); return f ? { ...f, target: t } : null;
}
const usable = (a: ProviderAccount): boolean => a.hasKey !== false || ['ollama', 'comfyui', 'mock'].includes(a.vendor) || adapterOf(a.vendor)?.keyRequired === false;
const targetOf = (a: ProviderAccount, e: ModelEntry): RoleTarget => ({ accountId: a.id, modelEntryId: e.id, model: e.model });

/** 能力覆盖一览：每个能力由谁覆盖（resolveModel 同一条链，无任务指定时）。 */
export function coverage(state: ModelsStateV3): Record<CapId, { account: ProviderAccount; entry: ModelEntry; via: Via } | null> {
  const out = {} as Record<CapId, { account: ProviderAccount; entry: ModelEntry; via: Via } | null>;
  for (const c of CAPS) {
    const r = resolveModel(state, undefined, c.role, { strict: true });
    const f = r ? findEntry(state, r.target.modelEntryId) : null;
    out[c.id] = r && f ? { ...f, via: r.via } : null;
  }
  return out;
}
/** 支持某能力的服务商（“补一个”只列这些）。 */
export function vendorsFor(role: RoleId, vendors: { id: string; roles: RoleId[] }[]): string[] { return vendors.filter((v) => v.roles.includes(role) && v.id !== 'mock').map((v) => v.id); }

export type Via = 'override' | 'task' | 'primary' | 'fallback-first' | 'main' | 'same-vendor' | 'other' | 'role-fallback';
export interface Resolved { role: RoleId; target: RoleTarget; fallback?: RoleTarget; via: Via; thinking?: boolean }

/**
 * 唯一选模型链。need = 内部角色；task = 调用方的任务名（如 write:xiaohongshu、title、cover）。
 * strict：只看真正声明了该能力的模型（能力覆盖一览用）；否则 reason / fast 可落到对话模型（思考档 / 主模型）。
 */
export function resolveModel(state: ModelsStateV3, task: string | undefined, need: RoleId, o: { override?: RoleTarget | null; health?: HealthTracker; healthRouting?: boolean; strict?: boolean } = {}): Resolved | null {
  if (o.override) return { role: need, target: o.override, via: 'override' };
  const b = state.roles?.[need];
  const enabled = b?.enabled !== false;
  // ① 按任务指定（任务级 > 能力级）
  if (b && enabled) {
    const tt = task ? b.tasks?.[task] : undefined;
    if (tt && findEntry(state, tt.modelEntryId)) return { role: need, target: tt, fallback: b.fallback, via: 'task' };
    if (b.primary && findEntry(state, b.primary.modelEntryId)) {
      const fb = b.fallback && findEntry(state, b.fallback.modelEntryId) ? b.fallback : undefined;
      if (o.healthRouting !== false && fb && o.health && !o.health.healthy(`${b.primary.accountId}:${b.primary.model}`)) return { role: need, target: fb, fallback: b.primary, via: 'fallback-first' };
      return { role: need, target: b.primary, fallback: fb, via: 'primary' };
    }
  }
  if (!enabled) return null;
  const fb = b?.fallback && findEntry(state, b.fallback.modelEntryId) ? b.fallback : undefined;
  if (need === 'fast' && state.economy?.mode === 'off' && !o.strict) {
    const r = resolveModel(state, task, 'chat', { ...o, override: null });
    return r ? { ...r, role: need, via: r.via === 'main' ? 'main' : 'role-fallback' } : null;
  }
  // ② 覆盖该能力的主模型
  const main = mainOf(state);
  if (main && entryCovers(main.entry, need)) {
    if (o.healthRouting !== false && fb && o.health && !o.health.healthy(`${main.account.id}:${main.entry.model}`)) return { role: need, target: fb, fallback: main.target, via: 'fallback-first' };
    return { role: need, target: main.target, fallback: fb, via: 'main' };
  }
  // ③ 同服务商同能力 → ④ 其他已接入且覆盖该能力
  const accts = state.accounts.filter(usable);
  const same = main ? accts.filter((a) => a.id === main.account.id || a.vendor === main.account.vendor) : [];
  for (const a of same) for (const e of a.models) if (entryCovers(e, need)) return { role: need, target: targetOf(a, e), fallback: fb, via: 'same-vendor' };
  for (const a of accts) if (!same.includes(a)) for (const e of a.models) if (entryCovers(e, need)) return { role: need, target: targetOf(a, e), fallback: fb, via: 'other' };
  // 思考档 / 省钱档：落到对话模型
  if (!o.strict && (need === 'reason' || need === 'fast')) {
    const r = resolveModel(state, task, 'chat', { ...o, override: null });
    if (r) return { ...r, role: need, via: 'role-fallback', thinking: need === 'reason' };
  }
  return null;
}

/* ---------------- schemaVersion 3 → 4 ---------------- */
export interface EconomyPolicy { mode: 'auto' | 'off' }
/** 迁移：主模型 = 各角色默认绑定中出现次数最多的“对话”模型（并列取 chat 角色的那个）。 */
export function pickMain(state: ModelsStateV3): RoleTarget | undefined {
  const count = new Map<string, { t: RoleTarget; n: number; chat: boolean }>();
  for (const [r, b] of Object.entries(state.roles ?? {})) {
    for (const t of [b?.primary, ...Object.values(b?.tasks ?? {})]) {
      if (!t) continue;
      const f = findEntry(state, t.modelEntryId); if (!f || !f.entry.roles.includes('chat')) continue;
      const k = t.modelEntryId; const c = count.get(k) ?? { t: { accountId: t.accountId, modelEntryId: t.modelEntryId, model: t.model }, n: 0, chat: false };
      c.n += 1; if (r === 'chat' && t === b?.primary) c.chat = true; count.set(k, c);
    }
  }
  const best = [...count.values()].sort((a, b) => b.n - a.n || Number(b.chat) - Number(a.chat))[0];
  if (best) return best.t;
  for (const a of state.accounts) for (const e of a.models) if (e.roles.includes('chat')) return targetOf(a, e);
  return undefined;
}
/** v3 → v4（纯函数、幂等）：设主模型；与主模型相同且被主模型覆盖的默认绑定去掉（由主模型自动覆盖），其余保留为“按任务指定”；原角色绑定存快照供降级。 */
export function upV3toV4(v3: ModelsStateV3): ModelsStateV3 {
  if ((v3.schemaVersion as number) >= 4) return v3;
  const s = structuredClone(v3);
  const snapshot = structuredClone(v3.roles);
  s.main = s.main ?? pickMain(s);
  if (s.main) {
    const mainEntry = findEntry(s, s.main.modelEntryId)?.entry;
    for (const [r, b] of Object.entries(s.roles)) {
      if (b.primary && b.primary.modelEntryId === s.main.modelEntryId && mainEntry && entryCovers(mainEntry, r as RoleId) && !b.primary.overrideSecretRef && !b.primary.overrideBaseURL) delete b.primary;
    }
  }
  s.economy = s.economy ?? { mode: 'auto' };
  s.v3Roles = snapshot;
  (s as { schemaVersion: number }).schemaVersion = 4;
  return s;
}
/** v4 → v3（降级）：还原迁移前的角色绑定；迁移后新增的主模型补回 chat 默认。 */
export function downV4toV3(v4: ModelsStateV3): ModelsStateV3 {
  const s = structuredClone(v4);
  if (s.v3Roles) s.roles = structuredClone(s.v3Roles);
  if (s.main && !s.roles.chat?.primary) s.roles.chat = { ...(s.roles.chat ?? { role: 'chat', enabled: true }), primary: s.main };
  delete s.main; delete s.economy; delete s.v3Roles;
  (s as { schemaVersion: number }).schemaVersion = 3;
  return s;
}
