/**
 * Key 安全存储（0.9.0，ADR-004）：所有服务商 Key 只存这里——WebCrypto AES-GCM，加密密钥是不可导出的 CryptoKey（存 IndexedDB 句柄）。
 * - 安卓 App：同一实现运行在 WebView 内（加密密钥不可导出、不出本机）；硬件 Keystore 原生绑定列入 ROADMAP 0.10（需要真机验证，见 deviations-v9 D-KEYSTORE）；
 * - 网页版：同样加密保存，但浏览器扩展或同源脚本理论上可在页面内调用解密——界面如实提示风险；
 * - Key 永不进入：模型配置 kv、日志、审计、trace、导出、备份、VFS（写入前扫描拦截）。界面只显示末 4 位。
 */
import { db } from './db';
import { seal, unseal } from './secure';
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
export async function getSecret(ref: string | undefined): Promise<string> { if (!ref) return ''; return unseal((await all())[ref]); }
export async function deleteSecret(ref: string): Promise<void> { const m = await all(); delete m[ref]; await db.setKV(KV, m); }
export async function secretTails(): Promise<Record<string, { tail: string; encrypted: boolean }>> {
  return Object.fromEntries(Object.entries(await all()).map(([k, v]) => [k, { tail: v.tail, encrypted: !v.plain }]));
}
export function secretStorageInfo(): { where: string; risk?: string } {
  const r = runtime();
  if (r === 'capacitor') return { where: '本机加密存储（AES-GCM，加密密钥不可导出）' };
  if (r === 'electron') return { where: '本机加密存储（AES-GCM，加密密钥不可导出）' };
  return { where: '浏览器本地加密存储（AES-GCM）', risk: '网页版的 Key 虽加密保存，但浏览器扩展或被篡改的页面理论上能在页面内使用它；长期使用建议用 App。' };
}
