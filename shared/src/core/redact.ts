/**
 * 密钥识别与打码（日志、审计、导出、trace、回复都经过这里）。与 scripts/scan-secrets.mjs 同一组规则。
 */
export const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'openai-like', re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { name: 'token-plan', re: /\btp-[A-Za-z0-9_-]{16,}/g },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi },
  { name: 'aws', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'github', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: 'google', re: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'kv-secret', re: /\b(?:api[_-]?key|secret|access[_-]?token|password)["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}/gi },
];
/** 40 位以上看起来随机的串（字母数字混合、无空格），常见于 Key；只在 strict 模式里判定。 */
const RANDOM_LONG = /\b(?=[A-Za-z0-9_-]{40,}\b)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{40,}\b/g;

export interface SecretHit { name: string; index: number; preview: string }
export function findSecrets(text: string, opts: { strict?: boolean } = {}): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const p of SECRET_PATTERNS) for (const m of text.matchAll(p.re)) hits.push({ name: p.name, index: m.index ?? 0, preview: `${m[0].slice(0, 4)}…` });
  if (opts.strict) for (const m of text.matchAll(RANDOM_LONG)) if (!/^[0-9a-f]{40,64}$/.test(m[0])) hits.push({ name: 'random-long', index: m.index ?? 0, preview: `${m[0].slice(0, 4)}…` });
  return hits;
}
export function redact(text: string, extra: string[] = []): string {
  let out = text;
  for (const k of extra) if (k && k.length >= 6) out = out.split(k).join('***');
  for (const p of SECRET_PATTERNS) out = out.replace(p.re, (m) => (p.name === 'bearer' ? 'Bearer ***' : p.name === 'kv-secret' ? m.replace(/[A-Za-z0-9._-]{16,}$/, '***') : '***'));
  return out;
}
/** 对象深度打码：键名像密钥的字段整体替换；字符串值走 redact。 */
export function redactDeep<T>(v: T, extra: string[] = []): T {
  const keyLike = /^(api_?key|apikey|key|secret|token|password|authorization|overrideKey)$/i;
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') return redact(x, extra);
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, val]) => [k, keyLike.test(k) && typeof val === 'string' && val ? '***' : walk(val)]));
    return x;
  };
  return walk(v) as T;
}
export const tail4 = (v: string): string => (v ? `••••${v.slice(-4)}` : '');
