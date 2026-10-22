import { boundaryPreamble } from '../boundaries.js';
import { buildSystemPrompt, OUTPUT_RULES, schemaForPlatform, type JsonSchema } from '@content-agent/shared';
import type { Skill } from '../skills/loader.js';
import type { AgentFiles } from './agentfiles.js';

export { OUTPUT_RULES };

/** skill 声明的 Schema 优先，其次平台默认 Schema。 */
export function schemaFor(skill: Skill | undefined, platform?: string): JsonSchema {
  return schemaForPlatform(platform ?? skill?.platform, skill?.schema);
}

/**
 * 稳定前缀（实现位于 @content-agent/shared 的 buildSystemPrompt，本机模式同用）：
 *   硬边界（代码常量，永远最前）→ soul → 规则（工作方式、用户画像、输出规则）→ skill → 平台规范
 */
export function systemPrompt(agent: AgentFiles, skill?: Skill, schema?: JsonSchema): string {
  return buildSystemPrompt({
    boundary: boundaryPreamble(),
    soul: agent.read('soul.md'), workingMethod: agent.read('working-method.md'), user: agent.read('USER.md'),
    skill: skill ? { name: skill.name, body: skill.body } : undefined, schema,
  });
}
