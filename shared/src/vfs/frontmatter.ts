/** front matter（8.3）：极简 YAML 子集解析与序列化（key: value、[a, b] 行内数组、- 列表、嵌套一层对象）；解析失败 → 当纯正文加载并标“格式有误”。 */
export type FM = Record<string, unknown>;
export interface ParsedDoc { fm: FM; body: string; hasFM: boolean; error?: string }

function scalar(v: string): unknown {
  const s = v.trim();
  if (s === '') return '';
  if (s === 'true') return true; if (s === 'false') return false; if (s === 'null' || s === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s.startsWith('[') && s.endsWith(']')) return s.slice(1, -1).split(',').map((x) => scalar(x)).filter((x) => x !== '');
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}
export function parseDoc(text: string): ParsedDoc {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return { fm: {}, body: text, hasFM: false };
  const end = text.indexOf('\n---', 4);
  if (end < 0) return { fm: {}, body: text, hasFM: false, error: 'front matter 没有结束标记' };
  const head = text.slice(4, end);
  const body = text.slice(text.indexOf('\n', end + 1) + 1);
  const fm: FM = {};
  let lastKey = '';
  try {
    for (const raw of head.split(/\r?\n/)) {
      if (!raw.trim() || raw.trim().startsWith('#')) continue;
      const li = /^\s+-\s+(.*)$/.exec(raw) ?? /^-\s+(.*)$/.exec(raw);
      if (li && lastKey) { const arr = Array.isArray(fm[lastKey]) ? (fm[lastKey] as unknown[]) : []; arr.push(scalar(li[1]!)); fm[lastKey] = arr; continue; }
      const nested = /^\s{2,}([\w.-]+):\s*(.*)$/.exec(raw);
      if (nested && lastKey) { const obj = (fm[lastKey] && typeof fm[lastKey] === 'object' && !Array.isArray(fm[lastKey]) ? fm[lastKey] : {}) as FM; obj[nested[1]!] = scalar(nested[2]!); fm[lastKey] = obj; continue; }
      const kv = /^([\w.-]+):\s*(.*)$/.exec(raw);
      if (!kv) throw new Error(`无法解析：${raw.slice(0, 40)}`);
      lastKey = kv[1]!;
      fm[lastKey] = kv[2]!.trim() === '' ? '' : scalar(kv[2]!);
    }
  } catch (e) { return { fm: {}, body: text, hasFM: false, error: (e as Error).message }; }
  return { fm, body, hasFM: true };
}
const ser = (v: unknown): string => (Array.isArray(v) ? `[${v.map((x) => String(x)).join(', ')}]` : v && typeof v === 'object' ? '' : String(v));
export function serializeDoc(fm: FM, body: string): string {
  if (!Object.keys(fm).length) return body;
  const lines = Object.entries(fm).map(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? `${k}:\n${Object.entries(v as FM).map(([a, b]) => `  ${a}: ${ser(b)}`).join('\n')}` : `${k}: ${ser(v)}`));
  return `---\n${lines.join('\n')}\n---\n${body}`;
}
/** 只改 front matter 的若干字段（保留正文原样）。 */
export function patchFM(text: string, patch: FM): string {
  const d = parseDoc(text);
  if (!d.hasFM) return text;
  const end = text.indexOf('\n---', 4);
  const bodyStart = text.indexOf('\n', end + 1) + 1;
  const head = text.slice(4, end).split('\n');
  for (const [k, v] of Object.entries(patch)) {
    const i = head.findIndex((l) => l.startsWith(`${k}:`));
    if (i >= 0) head[i] = `${k}: ${ser(v)}`; else head.push(`${k}: ${ser(v)}`);
  }
  return `---\n${head.join('\n')}\n---\n${text.slice(bodyStart)}`;
}
/** 取正文中的某一节（## 标题到下一个同级标题）。 */
export function section(body: string, title: string): string | null {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => /^#{1,4}\s/.test(l) && l.replace(/^#+\s*/, '').trim().startsWith(title));
  if (start < 0) return null;
  const level = /^(#+)/.exec(lines[start]!)![1]!.length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { const m = /^(#+)\s/.exec(lines[i]!); if (m && m[1]!.length <= level) { end = i; break; } }
  return lines.slice(start, end).join('\n');
}
