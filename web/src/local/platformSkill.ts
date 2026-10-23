/**
 * 1.1.0 写作归一：平台写法只有一个真相源 —— Agent 文件系统里的技能 skills/<id>/SKILL.md（用户可在“我的 → 记忆与技能 → 技能”查看、修改、回滚，按 1.0 分级进化规则）。
 * 0.7 时代的“平台写作助手”数据表与本机覆盖已删除，覆盖已迁移为技能的用户修订版本（v11/migrate.ts）。
 */
import { DEFAULT_FILES, parseSkillText } from '@content-agent/shared';
import { writePlatform } from '../data/platforms';
import { getVfs } from '../v9/vfsBackend';

export interface PlatformSkill { platform: string; skillId: string; path: string; name: string; description: string; body: string; schema?: Record<string, unknown>; userEdited: boolean }
export const skillPathOf = (platform: string): string => `skills/${writePlatform(platform).skill}/SKILL.md`;

export async function platformSkill(platform: string): Promise<PlatformSkill | null> {
  const path = skillPathOf(platform);
  let text: string | undefined;
  try { text = await (await getVfs()).text(path); } catch { text = undefined; }
  const def = DEFAULT_FILES[path];
  const src = text ?? def;
  if (!src) return null;
  const p = parseSkillText(src);
  return { platform, skillId: writePlatform(platform).skill, path, name: p.name, description: p.description, body: p.body, ...(p.schema ? { schema: p.schema } : {}), userEdited: !!text && !!def && text.trim() !== def.trim() };
}

/** 同步读取技能默认版本的输出 Schema（编辑器实时字数提示用；用户修订版本在生成时由 platformSkill 读取）。 */
export function defaultSkillSchema(platform: string): Record<string, unknown> | null {
  const src = DEFAULT_FILES[skillPathOf(platform)];
  return src ? parseSkillText(src).schema ?? null : null;
}
