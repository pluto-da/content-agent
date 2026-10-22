/**
 * 极简 JSON Schema 校验（无依赖）：type / properties / required / items / minLength / maxLength / minItems / maxItems / enum。
 * 长度按字符（码点）计。扩展关键字：
 *  - x-weightedMax：加权长度上限（CJK/全角算 2，其余算 1；用于 X 的 280 限制）
 *  - x-segmentSep：配合 x-weightedMax，按分隔符拆段后逐段检查（如 X 串帖用 "---"）
 * 扩展关键字在传给服务商前会被剥离（stripExtensions）。
 */
export type JsonSchema = Record<string, unknown>;

export interface SchemaError { path: string; message: string; kind: 'type' | 'required' | 'length' | 'items' | 'enum' }

export function charLen(s: string): number { return [...s].length; }
export function weightedLen(s: string): number {
  let n = 0;
  for (const ch of s) n += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  return n;
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

export function validate(schema: JsonSchema, value: unknown, path = '$'): SchemaError[] {
  const errs: SchemaError[] = [];
  const t = schema.type as string | string[] | undefined;
  if (t) {
    const types = Array.isArray(t) ? t : [t];
    const actual = typeOf(value);
    const ok = types.some((x) => x === actual || (x === 'number' && actual === 'integer'));
    if (!ok) { errs.push({ path, kind: 'type', message: `${path} 类型应为 ${types.join('/')}，实际为 ${actual}` }); return errs; }
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) errs.push({ path, kind: 'enum', message: `${path} 取值不在允许范围内` });
  if (typeof value === 'string') {
    const n = charLen(value);
    if (typeof schema.minLength === 'number' && n < schema.minLength) errs.push({ path, kind: 'length', message: `${path} 长度 ${n} 低于下限 ${schema.minLength}` });
    if (typeof schema.maxLength === 'number' && n > schema.maxLength) errs.push({ path, kind: 'length', message: `${path} 长度 ${n} 超过上限 ${schema.maxLength}` });
    const wmax = schema['x-weightedMax'];
    if (typeof wmax === 'number') {
      const sep = typeof schema['x-segmentSep'] === 'string' ? (schema['x-segmentSep'] as string) : '';
      const segs = sep ? value.split(sep).map((x) => x.trim()).filter(Boolean) : [value];
      segs.forEach((seg, i) => {
        const w = weightedLen(seg);
        if (w > wmax) errs.push({ path: sep ? `${path}[段${i + 1}]` : path, kind: 'length', message: `${sep ? `${path} 第 ${i + 1} 段` : path} 加权长度 ${w} 超过上限 ${wmax}（中文按 2 计）` });
      });
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errs.push({ path, kind: 'items', message: `${path} 至少 ${schema.minItems} 项，实际 ${value.length}` });
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errs.push({ path, kind: 'items', message: `${path} 至多 ${schema.maxItems} 项，实际 ${value.length}` });
    if (schema.items && typeof schema.items === 'object') value.forEach((v, i) => errs.push(...validate(schema.items as JsonSchema, v, `${path}[${i}]`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const k of (schema.required as string[] | undefined) ?? []) if (obj[k] === undefined || obj[k] === null) errs.push({ path: `${path}.${k}`, kind: 'required', message: `缺少必填字段 ${k}` });
    const props = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
    for (const [k, sub] of Object.entries(props)) if (obj[k] !== undefined && obj[k] !== null) errs.push(...validate(sub, obj[k], `${path}.${k}`));
  }
  return errs;
}

/** 剥离 x- 扩展关键字（服务商只认标准 Schema）。 */
export function stripExtensions(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripExtensions);
  if (schema && typeof schema === 'object') {
    return Object.fromEntries(Object.entries(schema as Record<string, unknown>).filter(([k]) => !k.startsWith('x-')).map(([k, v]) => [k, stripExtensions(v)]));
  }
  return schema;
}

/** 键排序后的稳定序列化：保证同一 Schema 渲染进提示词时逐字节一致。 */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
