/**
 * 本机加密保存（0.8.0，数据源凭证用）：WebCrypto AES-GCM。
 * 加密密钥是 extractable=false 的 CryptoKey，存在 IndexedDB（结构化克隆保存的是不可导出的句柄，页面脚本也拿不到原始字节）。
 * 没有 WebCrypto 的环境（极少数）退回 base64 并标记 plain=true，界面如实提示“这台设备不支持加密”。
 * 界面只显示末四位；密钥永不写日志、trace、备份。
 */
import { db } from './db';

interface Sealed { iv: string; data: string; plain?: boolean; tail: string }
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null);

let keyP: Promise<CryptoKey | null> | null = null;
async function key(): Promise<CryptoKey | null> {
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
/** 测试用。 */
export function resetSecureKey(): void { keyP = null; }

export const tail4 = (v: string) => (v ? `••••${v.slice(-4)}` : '');

export async function seal(value: string): Promise<Sealed> {
  const k = await key();
  const tail = value.slice(-4);
  if (!k) return { iv: '', data: btoa(unescape(encodeURIComponent(value))), plain: true, tail };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await subtle()!.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(value));
  return { iv: b64(iv), data: b64(new Uint8Array(buf)), tail };
}

export async function unseal(s: Sealed | undefined | null): Promise<string> {
  if (!s?.data) return '';
  if (s.plain) return decodeURIComponent(escape(atob(s.data)));
  const k = await key();
  if (!k) return '';
  try {
    const buf = await subtle()!.decrypt({ name: 'AES-GCM', iv: unb64(s.iv) }, k, unb64(s.data));
    return new TextDecoder().decode(buf);
  } catch { return ''; }
}

/* ---------- 数据源凭证 ---------- */
export interface SourceCred { id: string; fields: Record<string, Sealed>; plainFields?: Record<string, string>; check?: { ok: boolean; at: string; reason?: string; ms?: number } }
type CredMap = Record<string, SourceCred>;

export async function listCreds(): Promise<CredMap> { return (await db.getKV<CredMap>('sources.creds')) ?? {}; }

/** 保存：secret 字段加密，非 secret（如接口路径）明文；空字符串表示“不改”。 */
export async function saveCred(id: string, values: Record<string, string>, secretKeys: string[]): Promise<SourceCred> {
  const all = await listCreds();
  const cur: SourceCred = all[id] ?? { id, fields: {} };
  for (const [k, v] of Object.entries(values)) {
    if (secretKeys.includes(k)) { if (v.trim()) cur.fields[k] = await seal(v.trim()); }
    else (cur.plainFields ??= {})[k] = v.trim();
  }
  delete cur.check;
  all[id] = cur;
  await db.setKV('sources.creds', all);
  return cur;
}
export async function setCredCheck(id: string, check: SourceCred['check']): Promise<void> {
  const all = await listCreds();
  if (!all[id]) return;
  all[id]!.check = check;
  await db.setKV('sources.creds', all);
}
export async function removeCred(id: string): Promise<void> {
  const all = await listCreds();
  delete all[id];
  await db.setKV('sources.creds', all);
}
/** 解密后的全部字段（只在发请求前调用）。 */
export async function readCred(id: string): Promise<Record<string, string> | null> {
  const c = (await listCreds())[id];
  if (!c) return null;
  const out: Record<string, string> = { ...(c.plainFields ?? {}) };
  for (const [k, s] of Object.entries(c.fields)) out[k] = await unseal(s);
  return out;
}
export function isConnected(c: SourceCred | undefined, secretKeys: string[]): boolean {
  return !!c && secretKeys.every((k) => !!c.fields[k]?.data);
}
