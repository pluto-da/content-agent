import type { JsonSchema } from '../models/schema.js';

/**
 * 各平台改写输出的默认 JSON Schema（skill 可用 ```json schema 代码块覆盖）。
 * 只写有把握的硬限制：小红书标题 20 / 正文 1000、X 每段 280（中文按 2 计）、公众号标题 64、闲鱼标题 30；其余平台只约束结构。
 */
const str = (extra: JsonSchema = {}): JsonSchema => ({ type: 'string', ...extra });
const tags = (max = 10): JsonSchema => ({ type: 'array', items: { type: 'string' }, maxItems: max });

function rewriteSchema(o: { title?: JsonSchema; titleRequired?: boolean; body?: JsonSchema; tagsMax?: number; images?: number; voiceover?: boolean } = {}): JsonSchema {
  const properties: Record<string, JsonSchema> = {
    title: str({ minLength: o.titleRequired === false ? 0 : 1, ...(o.title ?? {}) }),
    body: str({ minLength: 1, ...(o.body ?? {}) }),
    tags: tags(o.tagsMax),
  };
  if (o.images) properties.image_prompts = { type: 'array', items: { type: 'string' }, maxItems: o.images };
  if (o.voiceover) properties.voiceover = str();
  return { type: 'object', required: o.titleRequired === false ? ['body'] : ['title', 'body'], properties };
}

export const PLATFORM_SCHEMAS: Record<string, JsonSchema> = {
  xiaohongshu: rewriteSchema({ title: { maxLength: 20 }, body: { maxLength: 1000 }, tagsMax: 10, images: 3 }),
  x_post: rewriteSchema({ titleRequired: false, title: { maxLength: 60 }, body: { 'x-weightedMax': 280, 'x-segmentSep': '---' }, tagsMax: 4 }),
  wechat_article: rewriteSchema({ title: { maxLength: 64 }, images: 1 }),
  xianyu: rewriteSchema({ title: { maxLength: 30 } }),
  douyin_script: rewriteSchema({ voiceover: true, images: 6 }),
  channels: rewriteSchema({ voiceover: true, images: 6 }),
  zhihu_answer: rewriteSchema({ titleRequired: false }),
  zhihu_article: rewriteSchema(),
};

export const GENERIC_REWRITE_SCHEMA: JsonSchema = rewriteSchema({ titleRequired: false });

/** 人能读的平台规范摘要（写进提示词“平台规范”段，固定文本）。 */
export function describeLimits(schema: JsonSchema): string[] {
  const props = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
  const out: string[] = [];
  const name: Record<string, string> = { title: '标题', body: '正文', tags: '标签', image_prompts: '配图提示词', voiceover: '口播稿' };
  for (const [k, p] of Object.entries(props)) {
    const n = name[k] ?? k;
    if (typeof p.maxLength === 'number') out.push(`${n}不超过 ${p.maxLength} 字`);
    if (typeof p['x-weightedMax'] === 'number') out.push(`${n}${p['x-segmentSep'] ? `每段（用“${String(p['x-segmentSep'])}”分隔）` : ''}不超过 ${p['x-weightedMax']} 字符（中文按 2 计）`);
    if (typeof p.maxItems === 'number') out.push(`${n}不超过 ${p.maxItems} 个`);
  }
  const req = (schema.required as string[] | undefined) ?? [];
  if (req.length) out.push(`必填字段：${req.join('、')}`);
  return out;
}
