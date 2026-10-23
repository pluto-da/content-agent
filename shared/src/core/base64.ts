/** 纯 JS Base64（shared 不依赖 DOM / Node 全局）。 */
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function bytesToBase64(u: Uint8Array): string {
  let out = '';
  for (let i = 0; i < u.length; i += 3) {
    const n = (u[i]! << 16) | ((u[i + 1] ?? 0) << 8) | (u[i + 2] ?? 0);
    out += A[(n >> 18) & 63]! + A[(n >> 12) & 63]! + (i + 1 < u.length ? A[(n >> 6) & 63]! : '=') + (i + 2 < u.length ? A[n & 63]! : '=');
  }
  return out;
}
export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (A.indexOf(clean[i]!) << 18) | (A.indexOf(clean[i + 1] ?? 'A') << 12) | ((clean[i + 2] ? A.indexOf(clean[i + 2]!) : 0) << 6) | (clean[i + 3] ? A.indexOf(clean[i + 3]!) : 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (clean[i + 2] && o < out.length) out[o++] = (n >> 8) & 255;
    if (clean[i + 3] && o < out.length) out[o++] = n & 255;
  }
  return out.slice(0, o);
}
export function hexToBase64(hex: string): string { const u = new Uint8Array(hex.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16); return bytesToBase64(u); }
