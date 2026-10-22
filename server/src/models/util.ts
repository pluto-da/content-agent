import type { Segment } from './types.js';

export { extractJson, splitReasoning } from '@content-agent/shared';

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

/** 粗估 token 数：CJK 字符约 1 token/字，其余约 4 字符/token（只用于上下文上限预检，宁高勿低）。 */
export function estimateTokens(text: string): number {
  let cjk = 0, other = 0;
  for (const ch of text) {
    if (/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk * 1.1 + other / 3.5);
}

export const MAX_TOKENS_DEFAULT = { normal: 8192, thinking: 65536 } as const;
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/** 思考模式判定：路由显式指定优先，否则按模型名推断。 */
export function isThinkingModel(model: string, explicit?: boolean): boolean {
  if (explicit !== undefined) return explicit;
  return /reason|thinking|\br1\b|-r1|qwq/i.test(model);
}

/** 按思考模式给 max_tokens 默认值，并按“提示词 + max_tokens ≤ 上下文窗口”预检；提示词本身放不下则报错。 */
export function planMaxTokens(promptTokens: number, opts: { thinking: boolean; requested?: number; maxOutput?: number; contextWindow?: number }): number {
  const window = opts.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  let max = opts.requested ?? (opts.thinking ? MAX_TOKENS_DEFAULT.thinking : MAX_TOKENS_DEFAULT.normal);
  if (opts.maxOutput) max = Math.min(max, opts.maxOutput);
  const room = window - promptTokens;
  if (room < 1024) throw new Error(`提示词约 ${promptTokens} token，超出上下文上限 ${window}（至少需留 1024 token 输出），请缩短素材`);
  return Math.max(1024, Math.min(max, room));
}
