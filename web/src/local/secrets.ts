/**
 * Key 安全存储（0.9.0 ADR-004；0.10.0 ADR-011 可插拔后端）：所有服务商 Key 只存这里，密文存 IndexedDB。
 * - 安卓 App：AndroidKeyStore 硬件主密钥（插件 SecureKeys，StrongBox 优先），WebView 只拿到加解密结果；旧 WebCrypto 密文首次使用时一次性迁移；
 * - 桌面 App：系统钥匙串（Electron safeStorage）；
 * - 网页版：同样加密保存，但浏览器扩展或同源脚本理论上可在页面内调用解密——界面如实提示风险；
 * - Key 永不进入：模型配置 kv、日志、审计、trace、导出、备份、VFS（写入前扫描拦截）。界面只显示末 4 位。
 */
import { db } from './db';
import { seal, unseal } from './secure';
import { activeBackend, backendFallbackReason, undecryptable } from './secretBackend';
import { runtime } from '../runtime';

type Sealed = Awaited<ReturnType<typeof seal>>;
const KV = 'secrets';
async function all(): Promise<Record<string, Sealed>> { return (await db.getKV<Record<string, Sealed>>(KV)) ?? {}; }
export async function setSecret(ref: string, value: string): Promise<{ tail: string; encrypted: boolean }> {
  const m = await all();
  const s = await seal(value.trim());
  m[ref] = s;
  await db.setKV(KV, m);
  return { tail: s.tail, encrypted: !s.plain };
}
export async function getSecret(ref: string | undefined): Promise<string> { if (!ref) return ''; return unseal((await all())[ref], ref); }
/** 逐条试解密（不返回明文），列出本机解不开的 Key（卸载重装 / 换机 / 恢复了别的设备的数据后属预期），界面提示重新填写。 */
export async function undecryptableSecrets(): Promise<string[]> {
  const m = await all();
  for (const [k, v] of Object.entries(m)) await unseal(v, k);
  return Object.keys(m).filter((k) => undecryptable.has(k));
}
export async function deleteSecret(ref: string): Promise<void> { const m = await all(); delete m[ref]; await db.setKV(KV, m); }
export async function secretTails(): Promise<Record<string, { tail: string; encrypted: boolean }>> {
  return Object.fromEntries(Object.entries(await all()).map(([k, v]) => [k, { tail: v.tail, encrypted: !v.plain }]));
}
export async function secretStorageInfoAsync(): Promise<{ where: string; risk?: string; warn?: string }> {
  const be = await activeBackend();
  const base = secretStorageInfo();
  const where = be.id === 'android-keystore' ? '安卓硬件密钥库（AndroidKeyStore，密钥不出安全芯片）' : be.id === 'ios-keychain' ? 'iOS 钥匙串（Keychain，仅本机、不随 iCloud 同步）' : be.id === 'electron-safeStorage' ? '系统钥匙串（Electron safeStorage）' : base.where;
  return { ...base, where, warn: backendFallbackReason() ?? undefined };
}
export function secretStorageInfo(): { where: string; risk?: string } {
  const r = runtime();
  if (r === 'capacitor') return { where: '本机加密存储（安卓上优先用硬件密钥库）' };
  if (r === 'electron') return { where: '本机加密存储（优先用系统钥匙串）' };
  return { where: '浏览器本地加密存储（AES-GCM）', risk: '网页版的 Key 虽加密保存，但浏览器扩展或被篡改的页面理论上能在页面内使用它；长期使用建议用 App。' };
}
