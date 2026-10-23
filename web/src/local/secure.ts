/**
 * 本机加密保存（0.8.0 起；0.10.0 改为可插拔后端，见 secretBackend.ts / ADR-011）：
 * 安卓 App 用 AndroidKeyStore 硬件密钥（插件 SecureKeys），桌面 App 用系统钥匙串，网页版与兜底用 WebCrypto AES-GCM（不可导出 CryptoKey）。
 * 没有任何加密能力的环境（极少数）退回 base64 并标记 plain=true，界面如实提示“这台设备不支持加密”。
 * 界面只显示末四位；密钥永不写日志、trace、备份。
 */
import { db } from './db';
import { sealWith, unsealWith, resetSecretBackend, type Sealed } from './secretBackend';

/** 测试用。 */
export function resetSecureKey(): void { resetSecretBackend(); }

export const tail4 = (v: string) => (v ? `••••${v.slice(-4)}` : '');

export async function seal(value: string): Promise<Sealed> { return sealWith(value); }
export async function unseal(s: Sealed | undefined | null, ref?: string): Promise<string> { return unsealWith(s, ref); }

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
