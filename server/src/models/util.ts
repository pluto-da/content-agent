import type { Segment } from './types.js';

/** 从模型输出中稳健地提取 JSON（容忍 ```json 包裹与前后说明文字）。 */
export function extractJson<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error('模型输出中没有 JSON');
  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  const end = candidate.lastIndexOf(close);
  if (end < start) throw new Error('模型输出 JSON 不完整');
  return JSON.parse(candidate.slice(start, end + 1)) as T;
}

function ts(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

/** 由转写分段生成 SRT 字幕。 */
export function toSrt(segments: Segment[]): string {
  return segments
    .filter((s) => s.text.trim())
    .map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${s.text.trim()}\n`)
    .join('\n');
}

/** 没有时间轴时，按标点切分文本并按语速估算时间轴（每秒约 4.5 个汉字）。 */
export function estimateSegments(text: string, charsPerSec = 4.5): Segment[] {
  const parts = text.split(/(?<=[。！？!?；;\n])/).map((s) => s.trim()).filter(Boolean);
  let t = 0;
  return parts.map((p) => {
    const d = Math.max(1, p.length / charsPerSec);
    const seg = { start: t, end: t + d, text: p };
    t += d;
    return seg;
  });
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
