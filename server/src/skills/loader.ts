import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { containsForbidden, filterTools } from '../boundaries.js';
import { isCapability, type Capability } from '../models/types.js';
import { extractSchema, parseFrontMatter } from '@content-agent/shared';

export interface Skill {
  name: string;
  description: string;
  platform?: string;
  tools: string[];
  models: Capability[];
  version: number;
  body: string;
  file: string;
  /** 输出 JSON Schema（在正文中用 ```json schema 代码块声明；声明后从 body 中移出，渲染进“平台规范”段） */
  schema?: Record<string, unknown>;
}

export { extractSchema } from '@content-agent/shared';

export interface SkillLoadError { file: string; error: string }

export { parseFrontMatter } from '@content-agent/shared';

export function parseSkill(src: string, file: string): Skill {
  const { meta, body } = parseFrontMatter(src);
  const name = typeof meta.name === 'string' ? meta.name : '';
  const description = typeof meta.description === 'string' ? meta.description : '';
  if (!name) throw new Error('缺少 name');
  if (!description) throw new Error('缺少 description');
  const forbidden = containsForbidden(src);
  if (forbidden.length) throw new Error(`包含被禁止的能力：${forbidden.join('、')}`);
  const tools = Array.isArray(meta.tools) ? meta.tools : [];
  const { allowed, rejected } = filterTools(tools);
  if (rejected.length) throw new Error(`声明了白名单之外的工具：${rejected.join('、')}`);
  const modelsRaw = Array.isArray(meta.models) ? meta.models : [];
  const badModels = modelsRaw.filter((m) => !isCapability(m));
  if (badModels.length) throw new Error(`声明了未知的模型能力：${badModels.join('、')}`);
  const ex = extractSchema(body);
  return {
    name, description,
    platform: typeof meta.platform === 'string' ? meta.platform : undefined,
    tools: allowed,
    models: modelsRaw as Capability[],
    version: Number(meta.version ?? 1) || 1,
    body: ex.body, file,
    ...(ex.schema ? { schema: ex.schema } : {}),
  };
}

export function loadSkills(dir: string): { skills: Skill[]; errors: SkillLoadError[] } {
  const skills: Skill[] = [];
  const errors: SkillLoadError[] = [];
  if (!existsSync(dir)) return { skills, errors };
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    try {
      const s = parseSkill(readFileSync(join(dir, f), 'utf8'), f);
      if (skills.some((x) => x.name === s.name)) throw new Error(`name 重复：${s.name}`);
      skills.push(s);
    } catch (e) {
      errors.push({ file: f, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { skills, errors };
}

/** 检查 skill 需要的模型能力是否都已配置。 */
export function missingCapabilities(skill: Skill, isConfigured: (c: Capability) => boolean): Capability[] {
  return skill.models.filter((c) => !isConfigured(c));
}
