/** 随包的最小探测素材（5.5）：32×32 红色 PNG（看图“这张图主要是什么颜色？”）、64×64 靛蓝 PNG（Mock 出图 / 改图探测）、短 WAV（Mock 配音）。 */
import { bytesToBase64 } from '../core/base64.js';
export const PROBE_PNG_RED_32 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR42mO4o6FBU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAIahsD0l4r5QAAAAAElFTkSuQmCC';
export const MOCK_PNG_64 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsEtqAOOayAi+hcEKLNXzWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELgsq/6F41iyefAAAAABJRU5ErkJggg==';
/** 生成 PCM 8-bit 单声道 WAV（silence + 轻微正弦），用于 Mock 配音与本地测试；真实 ASR 探测用户可上传自己的录音。 */
export function makeWav(seconds = 0.6, rate = 8000): string {
  const n = Math.floor(seconds * rate);
  const buf = new Uint8Array(44 + n);
  const dv = new DataView(buf.buffer);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); w(36, 'data'); dv.setUint32(40, n, true);
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(20 * Math.sin((i / rate) * 2 * Math.PI * 440));
  return bytesToBase64(buf);
}
/** WAV 时长（秒）：用于 TTS 探测“时长 > 0.2 秒”。 */
export function wavSeconds(b64: string, toBytes: (s: string) => Uint8Array): number {
  const u = toBytes(b64.slice(0, 80));
  if (u.length < 44 || String.fromCharCode(u[0]!, u[1]!, u[2]!, u[3]!) !== 'RIFF') return -1;
  const dv = new DataView(u.buffer);
  const byteRate = dv.getUint32(28, true);
  const total = Math.floor((b64.length * 3) / 4) - 44;
  return byteRate ? total / byteRate : -1;
}
