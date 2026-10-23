/**
 * AI 生成内容标识（合规，C38）：
 * - 隐式：PNG 写入 tEXt 元数据（AIGC 标识、生成方式、模型、时间），纯 JS 实现；JPEG / 音频 / 视频本版不改写二进制（如实记 implicit=false，见偏离 D-AIGC）；
 * - 显式：图片右下角叠加“AI 生成”角标（需要 Canvas；不可用时 explicit=false 并在发布检查里提醒在平台勾选声明）。
 */
import { crc32, base64ToBytes, bytesToBase64, utf8 } from '@content-agent/shared';

export function pngInsertText(bytes: Uint8Array, key: string, value: string): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) return bytes;
  const ihdrEnd = 8 + 8 + 13 + 4; // 签名 + IHDR（长度+类型+13 字节数据+CRC）
  const data = utf8(`${key}\0${value}`);
  const chunk = new Uint8Array(12 + data.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk.set(utf8('tEXt'), 4); chunk.set(data, 8);
  dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, ihdrEnd)); out.set(chunk, ihdrEnd); out.set(bytes.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}
export function pngReadText(bytes: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8;
  const dec = new TextDecoder();
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p); const type = dec.decode(bytes.subarray(p + 4, p + 8));
    if (type === 'tEXt') { const s = dec.decode(bytes.subarray(p + 8, p + 8 + len)); const i = s.indexOf('\0'); out[s.slice(0, i)] = s.slice(i + 1); }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return out;
}
export function labelImplicit(base64: string, mime: string, meta: { model: string; at: string }): { base64: string; implicit: boolean } {
  if (mime !== 'image/png') return { base64, implicit: false };
  const b = pngInsertText(base64ToBytes(base64), 'AIGC', JSON.stringify({ Label: 'AI 生成', ContentProducer: 'content-agent', ProduceID: meta.at, Model: meta.model }));
  return { base64: bytesToBase64(b), implicit: true };
}
/** 显式角标：浏览器 / App 内用 Canvas 叠加；失败返回原图与 explicit=false。 */
export async function labelExplicit(dataUrl: string): Promise<{ dataUrl: string; explicit: boolean }> {
  try {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return { dataUrl, explicit: false };
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('load')); img.src = dataUrl; setTimeout(() => rej(new Error('timeout')), 3000); });
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); if (!g) return { dataUrl, explicit: false };
    g.drawImage(img, 0, 0);
    const fs = Math.max(12, Math.round(c.width / 28));
    g.font = `${fs}px sans-serif`; g.fillStyle = 'rgba(0,0,0,.45)';
    const w = g.measureText('AI 生成').width + fs; g.fillRect(c.width - w - 8, c.height - fs * 1.8 - 8, w, fs * 1.8);
    g.fillStyle = '#fff'; g.fillText('AI 生成', c.width - w - 8 + fs / 2, c.height - 8 - fs * 0.55);
    return { dataUrl: c.toDataURL('image/png'), explicit: true };
  } catch { return { dataUrl, explicit: false }; }
}
