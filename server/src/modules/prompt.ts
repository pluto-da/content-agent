import { boundaryPreamble } from '../boundaries.js';
import { stableStringify, type JsonSchema } from '../models/schema.js';
import type { Skill } from '../skills/loader.js';
import type { AgentFiles } from './agentfiles.js';
import { describeLimits, GENERIC_REWRITE_SCHEMA, PLATFORM_SCHEMAS } from './schemas.js';

export const OUTPUT_RULES = '请严格按要求的 JSON 格式输出；不得编造数据或来源；信息不足时写明“待核实”。';

/** skill 声明的 Schema 优先，其次平台默认 Schema。 */
export function schemaFor(skill: Skill | undefined, platform?: string): JsonSchema {
  if (skill?.schema) return skill.schema;
  const p = platform ?? skill?.platform;
  return (p && PLATFORM_SCHEMAS[p]) || GENERIC_REWRITE_SCHEMA;
}

/**
 * 稳定前缀：固定顺序、逐字节稳定，只含不随单次请求变化的内容，以命中服务商上下文缓存。
 *   硬边界（代码常量，永远最前）→ soul → 规则（工作方式、用户画像、输出规则）→ skill → 平台规范（Schema，键排序序列化）
 * 素材、时间、用户输入等变量一律放在 user 消息里（在前缀之后）。同一素材改写多个平台时，skill 之前的部分完全共享。
 */
export function systemPrompt(agent: AgentFiles, skill?: Skill, schema?: JsonSchema): string {
  const parts = [
    boundaryPreamble(),
    '【soul.md】\n' + agent.read('soul.md'),
    '【规则·working-method.md】\n' + agent.read('working-method.md'),
    '【规则·USER.md】\n' + agent.read('USER.md'),
    '【规则·输出】\n' + OUTPUT_RULES,
    skill ? `【skill：${skill.name}】\n${skill.body}` : '',
    schema ? `【平台规范】\n${describeLimits(schema).map((x) => `- ${x}`).join('\n')}\n输出 JSON Schema：${stableStringify(schema)}` : '',
  ];
  return parts.filter(Boolean).join('\n\n---\n\n');
}
