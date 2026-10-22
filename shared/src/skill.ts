const SCHEMA_BLOCK = /```json\s+schema[^\n]*\n([\s\S]*?)```/;

/** 取出 skill 正文中的 ```json schema 代码块。 */
export function extractSchema(body: string): { schema?: Record<string, unknown>; body: string } {
  const m = SCHEMA_BLOCK.exec(body);
  if (!m) return { body };
  let schema: unknown;
  try { schema = JSON.parse(m[1]!); } catch (e) { throw new Error(`输出 Schema 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`, { cause: e }); }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('输出 Schema 必须是 JSON 对象');
  return { schema: schema as Record<string, unknown>, body: body.replace(m[0], '').replace(/\n{3,}/g, '\n\n').trim() };
}

/** 解析简单 YAML 头信息（key: value 与 key: [a, b]）。 */
export function parseFrontMatter(src: string): { meta: Record<string, string | string[]>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) throw new Error('缺少 --- 头信息');
  const meta: Record<string, string | string[]> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (!k) continue;
    if (v.startsWith('[') && v.endsWith(']')) meta[k] = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
    else meta[k] = v.replace(/^["']|["']$/g, '');
  }
  return { meta, body: m[2]!.trim() };
}

/** 轻量 skill 解析（本机模式用；服务端 loader 在此基础上再做工具白名单与能力校验）。 */
export function parseSkillText(src: string): { name: string; description: string; platform?: string; body: string; schema?: Record<string, unknown> } {
  const { meta, body } = parseFrontMatter(src);
  const ex = extractSchema(body);
  return { name: String(meta.name ?? ''), description: String(meta.description ?? ''), platform: typeof meta.platform === 'string' ? meta.platform : undefined, body: ex.body, ...(ex.schema ? { schema: ex.schema } : {}) };
}
