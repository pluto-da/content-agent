/**
 * 可插拔的 Key 加密后端（0.10.0，ADR-011）。所有 Key（模型服务商 Key、数据源凭证）都经这里加密后才写进 IndexedDB。
 * - webcrypto：WebCrypto AES-GCM，加密密钥是不可导出的 CryptoKey（0.8–0.9 的实现，网页版与兜底）；
 * - android-keystore：原生插件 SecureKeys，主密钥生成在 AndroidKeyStore（StrongBox 可用时优先）里，WebView 只拿到加解密结果；
 * - electron-safeStorage：桌面 App 用系统钥匙串（Windows DPAPI / macOS Keychain / Linux libsecret）；Linux 只有 basic_text 时视为不可用。
 * 每条密文记下自己的后端（Sealed.b），解密按条分派，所以迁移中途失败也不会丢 Key。
 * 迁移：首次在 App 里用到 Key 时，把旧 WebCrypto 密文一次性解开 → 用新后端加密 → 逐条回读校验 → 一次写回 → 删除旧 WebCrypto 密钥。
 * 任何一步失败：什么都不写，继续用 WebCrypto，并在“诊断”与“账号与 Key”里明确提示原因（可重试）。
 * 明文只在内存里短暂存在，永不写日志、审计、trace、备份。
 */
import { registerPlugin } from '@capacitor/core';
import { db } from './db';
import { runtime, electronBridge } from '../runtime';

export type BackendId = 'webcrypto' | 'android-keystore' | 'electron-safeStorage';
export interface Sealed { iv: string; data: string; plain?: boolean; tail: string; b?: BackendId }
export interface HardwareInfo { hasKey?: boolean; isInsideSecureHardware?: boolean; securityLevel?: string; strongBox?: boolean; strongBoxFeature?: boolean; userAuthRequired?: boolean; sdk?: number; error?: string; storageBackend?: string }
export interface SecretBackend {
  id: BackendId;
  available(): Promise<boolean>;
  encrypt(plain: string): Promise<{ iv: string; data: string }>;
  decrypt(s: { iv: string; data: string }): Promise<string>;
  info(create?: boolean): Promise<HardwareInfo>;
}
export interface MigrationState { status: 'none' | 'done' | 'failed' | 'not_needed'; from?: BackendId; to?: BackendId; count?: number; at?: string; reason?: string; requireAuth?: boolean }
export class SecretError extends Error { constructor(message: string, public code: string) { super(message); this.name = 'SecretError'; } }

const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null);

/* ---------------- webcrypto ---------------- */
let keyP: Promise<CryptoKey | null> | null = null;
async function wcKey(): Promise<CryptoKey | null> {
  const s = subtle();
  if (!s) return null;
  return (keyP ??= (async () => {
    const saved = await db.getKV<CryptoKey>('secure.key').catch(() => undefined);
    if (saved && typeof saved === 'object' && 'algorithm' in saved) return saved;
    const k = await s.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    try { await db.setKV('secure.key', k); } catch { /* 内存库：本次会话有效 */ }
    return k;
  })());
}
export const webcryptoBackend: SecretBackend = {
  id: 'webcrypto',
  async available() { return !!subtle(); },
  async encrypt(plain) {
    const k = await wcKey();
    if (!k) throw new SecretError('这台设备不支持加密', 'NO_WEBCRYPTO');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const buf = await subtle()!.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(plain));
    return { iv: b64(iv), data: b64(new Uint8Array(buf)) };
  },
  async decrypt(s) {
    const k = await wcKey();
    if (!k) throw new SecretError('这台设备不支持加密', 'NO_WEBCRYPTO');
    try { return new TextDecoder().decode(await subtle()!.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) }, k, unb64(s.data))); }
    catch { throw new SecretError('密文与本机密钥不匹配', 'BAD_TAG'); }
  },
  async info() { return { isInsideSecureHardware: false, securityLevel: 'software' }; },
};

/* ---------------- android-keystore（原生插件 SecureKeys） ---------------- */
interface SecureKeysPlugin {
  info(o: { create?: boolean; requireAuth?: boolean }): Promise<HardwareInfo & { available?: boolean }>;
  encrypt(o: { plaintext: string; requireAuth?: boolean }): Promise<{ iv: string; data: string }>;
  decrypt(o: { iv: string; data: string }): Promise<{ plaintext: string }>;
  reset(): Promise<{ ok: boolean }>;
}
export type { SecureKeysPlugin };
let SecureKeys: SecureKeysPlugin = registerPlugin<SecureKeysPlugin>('SecureKeys');
/** 测试用：注入假的原生插件。 */
export function setSecureKeysForTest(p: SecureKeysPlugin | null): void { SecureKeys = p ?? registerPlugin<SecureKeysPlugin>('SecureKeys'); }
let requireAuthPref = false;
const nativeErr = (e: unknown): SecretError => { const x = e as { code?: string; message?: string }; return new SecretError(x?.message ?? String(e), x?.code ?? 'NATIVE_ERROR'); };
export const androidKeystoreBackend: SecretBackend = {
  id: 'android-keystore',
  async available() {
    const cap = (globalThis as unknown as { Capacitor?: { getPlatform?: () => string; isPluginAvailable?: (n: string) => boolean } }).Capacitor;
    if (runtime() !== 'capacitor' || cap?.getPlatform?.() !== 'android') return false;
    if (cap.isPluginAvailable && !cap.isPluginAvailable('SecureKeys')) return false;
    try { return (await SecureKeys.info({})).available === true; } catch { return false; }
  },
  async encrypt(plain) { try { return await SecureKeys.encrypt({ plaintext: plain, requireAuth: requireAuthPref }); } catch (e) { throw nativeErr(e); } },
  async decrypt(s) { try { return (await SecureKeys.decrypt({ iv: s.iv, data: s.data })).plaintext; } catch (e) { throw nativeErr(e); } },
  async info(create) { try { return await SecureKeys.info({ create: !!create, requireAuth: requireAuthPref }); } catch (e) { return { error: String((e as Error)?.message ?? e) }; } },
};

/* ---------------- electron-safeStorage ---------------- */
interface SafeBridge { available(): Promise<{ ok: boolean; backend?: string }>; encrypt(s: string): Promise<string>; decrypt(b: string): Promise<string> }
const safe = (): SafeBridge | undefined => (typeof window === 'undefined' ? undefined : (electronBridge() as unknown as { safeStorage?: SafeBridge } | undefined)?.safeStorage);
export const electronSafeStorageBackend: SecretBackend = {
  id: 'electron-safeStorage',
  async available() { const s = safe(); if (!s) return false; try { return (await s.available()).ok; } catch { return false; } },
  async encrypt(plain) { const s = safe(); if (!s) throw new SecretError('桌面钥匙串不可用', 'NO_SAFE_STORAGE'); return { iv: '', data: await s.encrypt(plain) }; },
  async decrypt(x) { const s = safe(); if (!s) throw new SecretError('桌面钥匙串不可用', 'NO_SAFE_STORAGE'); try { return await s.decrypt(x.data); } catch (e) { throw new SecretError(String((e as Error)?.message ?? e), 'DECRYPT_FAILED'); } },
  async info() { const s = safe(); const a = s ? await s.available().catch(() => ({ ok: false, backend: undefined })) : { ok: false, backend: undefined }; return { isInsideSecureHardware: undefined, securityLevel: 'os_keychain', storageBackend: a.backend }; },
};

const BACKENDS: Record<BackendId, SecretBackend> = { webcrypto: webcryptoBackend, 'android-keystore': androidKeystoreBackend, 'electron-safeStorage': electronSafeStorageBackend };
export const backendById = (id: BackendId | undefined): SecretBackend => BACKENDS[id ?? 'webcrypto'] ?? webcryptoBackend;

/** 本运行环境首选的后端（不检查可用性）。 */
export function preferredBackend(): BackendId {
  const r = typeof window === 'undefined' ? 'web' : runtime();
  if (r === 'capacitor') {
    const p = (globalThis as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
    return p === 'android' ? 'android-keystore' : 'webcrypto';
  }
  if (r === 'electron') return 'electron-safeStorage';
  return 'webcrypto';
}

/* ---------------- 选择 + 一次性迁移 ---------------- */
const STATE_KV = 'secrets.backend';
let activeP: Promise<SecretBackend> | null = null;
let fallbackReason: string | null = null;

export async function migrationState(): Promise<MigrationState> { return (await db.getKV<MigrationState>(STATE_KV)) ?? { status: 'none' }; }

type CredMap = Record<string, { fields: Record<string, Sealed> } & Record<string, unknown>>;
/** 把所有不是 `to` 后端的密文迁到 `to`；全部成功才写回。返回迁移条数。 */
export async function migrateAll(to: SecretBackend): Promise<number> {
  const secrets = { ...((await db.getKV<Record<string, Sealed>>('secrets')) ?? {}) };
  const creds = structuredClone((await db.getKV<CredMap>('sources.creds')) ?? {}) as CredMap;
  const items: { get: () => Sealed; set: (s: Sealed) => void }[] = [];
  for (const k of Object.keys(secrets)) items.push({ get: () => secrets[k]!, set: (s) => { secrets[k] = s; } });
  for (const c of Object.values(creds)) for (const f of Object.keys(c.fields ?? {})) items.push({ get: () => c.fields[f]!, set: (s) => { c.fields[f] = s; } });
  let n = 0;
  for (const it of items) {
    const s = it.get();
    if (!s?.data || (s.b ?? 'webcrypto') === to.id && !s.plain) continue;
    const plain = await unsealWith(s);
    if (!plain) throw new SecretError('有一条旧 Key 在本机解不开，已停止迁移（原 Key 保持不变）', 'OLD_UNREADABLE');
    const enc = await to.encrypt(plain);
    const next: Sealed = { ...enc, tail: s.tail, b: to.id };
    if ((await to.decrypt(next)) !== plain) throw new SecretError('新密钥库回读校验不一致，已停止迁移', 'VERIFY_MISMATCH');
    it.set(next); n++;
  }
  if (!n) return 0;
  await db.setKV('sources.creds', creds);
  await db.setKV('secrets', secrets);
  return n;
}

async function choose(): Promise<SecretBackend> {
  fallbackReason = null;
  const want = backendById(preferredBackend());
  if (want.id === 'webcrypto') return webcryptoBackend;
  if (!(await want.available())) {
    fallbackReason = want.id === 'android-keystore' ? '这台手机上没有找到硬件密钥插件（SecureKeys），继续用 WebCrypto 加密' : '系统钥匙串不可用，继续用 WebCrypto 加密';
    return webcryptoBackend;
  }
  const st = await migrationState();
  requireAuthPref = !!st.requireAuth;
  if (st.status === 'done' && st.to === want.id) return want;
  try {
    await want.info(true);
    const n = await migrateAll(want);
    await db.setKV('secure.key', null);   // 迁完删除旧 WebCrypto 密钥（之后 webcrypto 密文已不存在）
    keyP = null;
    await db.setKV(STATE_KV, { status: 'done', from: 'webcrypto', to: want.id, count: n, at: new Date().toISOString(), requireAuth: requireAuthPref } satisfies MigrationState);
    return want;
  } catch (e) {
    const reason = (e as Error)?.message ?? String(e);
    fallbackReason = `迁移到${want.id === 'android-keystore' ? '硬件密钥库' : '系统钥匙串'}没有成功：${reason}。已继续用 WebCrypto 加密，Key 不受影响，可在“诊断”里重试`;
    await db.setKV(STATE_KV, { status: 'failed', from: 'webcrypto', to: want.id, at: new Date().toISOString(), reason } satisfies MigrationState);
    return webcryptoBackend;
  }
}
export function activeBackend(): Promise<SecretBackend> { return (activeP ??= choose()); }
export function backendFallbackReason(): string | null { return fallbackReason; }
/** 诊断页“重试迁移”与测试用。 */
export async function retryMigration(): Promise<SecretBackend> { await db.setKV(STATE_KV, { status: 'none' }); activeP = null; return activeBackend(); }
export function resetSecretBackend(): void { activeP = null; keyP = null; fallbackReason = null; }

/** 解密：按条分派到它自己的后端。失败返回 ''，并记下 ref 供界面提示“请重新填写”。 */
export const undecryptable = new Set<string>();
export async function unsealWith(s: Sealed | undefined | null, ref?: string): Promise<string> {
  if (!s?.data) return '';
  if (s.plain) return decodeURIComponent(escape(atob(s.data)));
  try { const v = await backendById(s.b).decrypt(s); if (ref) undecryptable.delete(ref); return v; }
  catch { if (ref) undecryptable.add(ref); return ''; }
}
export async function sealWith(value: string): Promise<Sealed> {
  const tail = value.slice(-4);
  const be = await activeBackend();
  try { return { ...(await be.encrypt(value)), tail, ...(be.id !== 'webcrypto' ? { b: be.id } : {}) }; }
  catch (e) {
    if (be.id !== 'webcrypto' && await webcryptoBackend.available()) { fallbackReason = `这次保存没能用${be.id === 'android-keystore' ? '硬件密钥库' : '系统钥匙串'}（${(e as Error).message}），已改用 WebCrypto 加密`; return { ...(await webcryptoBackend.encrypt(value)), tail }; }
    if (!(await webcryptoBackend.available())) return { iv: '', data: btoa(unescape(encodeURIComponent(value))), plain: true, tail };
    throw e;
  }
}

/** 安卓：切换“需要解锁手机后才能使用 Key”。先全部解密，删除旧密钥，按新参数生成并全部重新加密。 */
export async function setRequireAuth(on: boolean): Promise<{ ok: boolean; reason?: string }> {
  const be = await activeBackend();
  if (be.id !== 'android-keystore') return { ok: false, reason: '只有安卓 App 的硬件密钥库支持这个选项' };
  const prev = requireAuthPref;
  try {
    const secrets = { ...((await db.getKV<Record<string, Sealed>>('secrets')) ?? {}) };
    const plain: Record<string, string> = {};
    for (const [k, s] of Object.entries(secrets)) if (s.b === 'android-keystore') { const v = await unsealWith(s); if (!v) return { ok: false, reason: '有 Key 解不开，先重新填写后再切换' }; plain[k] = v; }
    await SecureKeys.reset();
    requireAuthPref = on;
    for (const [k, v] of Object.entries(plain)) secrets[k] = { ...(await androidKeystoreBackend.encrypt(v)), tail: secrets[k]!.tail, b: 'android-keystore' };
    await androidKeystoreBackend.info(true);
    await db.setKV('secrets', secrets);
    await db.setKV(STATE_KV, { ...(await migrationState()), requireAuth: on });
    return { ok: true };
  } catch (e) { requireAuthPref = prev; return { ok: false, reason: (e as Error).message }; }
}
export async function loadRequireAuthPref(): Promise<void> { requireAuthPref = !!(await migrationState()).requireAuth; }

export interface KeyStorageDiag { preferred: BackendId; active: BackendId; label: string; hardware: HardwareInfo; migration: MigrationState; fallbackReason: string | null; undecryptable: string[] }
const LABEL: Record<BackendId, string> = { webcrypto: 'WebCrypto（AES-GCM，加密密钥不可导出）', 'android-keystore': 'Android 硬件密钥库（AndroidKeyStore，AES-256-GCM）', 'electron-safeStorage': '系统钥匙串（Electron safeStorage）' };
export async function keyStorageDiag(): Promise<KeyStorageDiag> {
  const be = await activeBackend();
  return { preferred: preferredBackend(), active: be.id, label: LABEL[be.id], hardware: await be.info(be.id === 'android-keystore'), migration: await migrationState(), fallbackReason, undecryptable: [...undecryptable] };
}
