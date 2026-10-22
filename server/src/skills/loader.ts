import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { containsForbidden, filterTools } from '../boundaries.js';
import { isCapability, type Capability } from '../models/types.js';

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

export interface SkillLoadError { file: string; error: string }

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
