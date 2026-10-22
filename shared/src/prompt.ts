import { stableStringify, type JsonSchema } from './schema.js';
import { describeLimits, GENERIC_REWRITE_SCHEMA, PLATFORM_SCHEMAS } from './platforms.js';

export const OUTPUT_RULES = '请严格按要求的 JSON 格式输出；不得编造数据或来源；信息不足时写明“待核实”。';

/** skill 声明的 Schema 优先，其次平台默认 Schema。 */
export function schemaForPlatform(platform?: string, skillSchema?: JsonSchema | null): JsonSchema {
  if (skillSchema) return skillSchema;
  return (platform && PLATFORM_SCHEMAS[platform]) || GENERIC_REWRITE_SCHEMA;
}

export interface PromptParts {
  /** 硬边界前缀（由调用方传入 boundaries.ts 的 boundaryPreamble()，共用模块不复制硬边界文本） */
  boundary: string;
  soul?: string;
  workingMethod?: string;
  user?: string;
  skill?: { name: string; body: string };
  schema?: JsonSchema;
}

/**
 * 稳定前缀：硬边界（永远最前）→ soul → 规则（工作方式、用户画像、输出规则）→ skill → 平台规范（Schema 键排序序列化）。
 * 逐字节稳定，以命中服务商上下文缓存；素材、时间、用户输入一律放在 user 消息。服务端与本机模式共用。
 */
export function buildSystemPrompt(p: PromptParts): string {
  const parts = [
    p.boundary,
    p.soul !== undefined ? '【soul.md】\n' + p.soul : '',
    p.workingMethod !== undefined ? '【规则·working-method.md】\n' + p.workingMethod : '',
    p.user !== undefined ? '【规则·USER.md】\n' + p.user : '',
    '【规则·输出】\n' + OUTPUT_RULES,
    p.skill ? `【skill：${p.skill.name}】\n${p.skill.body}` : '',
    p.schema ? `【平台规范】\n${describeLimits(p.schema).map((x) => `- ${x}`).join('\n')}\n输出 JSON Schema：${stableStringify(p.schema)}` : '',
  ];
  return parts.filter(Boolean).join('\n\n---\n\n');
}

export interface TopicLike { title: string; angle?: string | null }

/** 改写任务的 user 消息（服务端选题改写与本机“一句话想法”生成共用）。 */
export function rewriteUserMessage(platform: string, topic: TopicLike, research: unknown, items: { title: string; url?: string | null }[], extra = ''): string {
  return [
    `[TASK:rewrite] [PLATFORM:${platform}]`,
    `选题标题：${String(topic.title)}`,
    `角度：${String(topic.angle ?? '')}`,
    research ? `调研：${JSON.stringify(research)}` : '',
    items.length ? `素材：\n${items.map((i) => `- ${i.title} ${i.url ?? ''}`).join('\n')}` : '',
    extra,
    '请输出 JSON：{"title","body","tags","image_prompts"(可选),"voiceover"(可选)}',
  ].filter(Boolean).join('\n');
}

/** 局部改写（只发选中段 + 有界前后文）。 */
export function partialRewriteMessage(platform: string, before: string, sel: string, after: string, instruction?: string): string {
  return [
    `[TASK:partial_rewrite] [PLATFORM:${platform}]`,
    '只改写“选中”部分，与前后文衔接、语气一致；不要输出前后文。',
    `修改要求：${instruction?.trim() || '润色，使表达更清晰'}`,
    `<<<前文>>>\n${before}\n<<</前文>>>`,
    `<<<选中>>>\n${sel}\n<<</选中>>>`,
    `<<<后文>>>\n${after}\n<<</后文>>>`,
    '请输出 JSON：{"text":"改写后的选中段"}',
  ].join('\n');
}
