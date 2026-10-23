#!/usr/bin/env node
/**
 * 生成 shared/src/vfs/defaults.generated.ts：Agent 文件系统首启默认正文（构建期打包，0.9.0）。
 * 来源（全部在仓库内，CI 可复现）：
 *  - agent/v9/defaults/**  ← 由 scripts/extract-v9-defaults.py 从 design/PROMPT-v9 第八部分逐字抽取
 *  - agent/v9/extra/**     ← 规格只列文件名、未给正文的文件（原创补写）
 *  - agent/semiotics/*     → semiotics/（逐字）
 *  - agent/v9/core-directive-v1.md → docs/core-directive.md（逐字）
 *  - agent/working-method.md → docs/working-method-legacy.md（逐字，历史，不加载）
 *  - agent/skills/*.md     → skills/<name>/SKILL.md（0.8 平台技能迁移；v9 defaults 中已有的以 v9 为准）
 * 用法：node scripts/gen-vfs-defaults.mjs [--check]（--check：内容不一致时退出码 1，供 CI 使用）
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = {};
const walk = (base, dir = base) => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(base, p);
    else files[relative(base, p).replace(/\\/g, '/')] = readFileSync(p, 'utf8');
  }
};
walk(join(root, 'agent/v9/defaults'));
walk(join(root, 'agent/v9/extra'));

for (const name of readdirSync(join(root, 'agent/semiotics'))) files[`semiotics/${name}`] = readFileSync(join(root, 'agent/semiotics', name), 'utf8');
files['docs/core-directive.md'] = readFileSync(join(root, 'agent/v9/core-directive-v1.md'), 'utf8');
files['docs/working-method-legacy.md'] = readFileSync(join(root, 'agent/working-method.md'), 'utf8');
for (const name of readdirSync(join(root, 'agent/skills'))) {
  const id = name.replace(/\.md$/, '');
  const path = `skills/${id}/SKILL.md`;
  if (!files[path]) files[path] = readFileSync(join(root, 'agent/skills', name), 'utf8');
}


/**
 * 规格缺口补丁（deviations-v9 D-SEM）：v9.3 第八部分 SOUL.md / AGENTS.md 默认正文没有 C52 要求的“指向 semiotics/、先加载 PRINCIPLES.md”一段，
 * 按 0.8 soul.md / working-method.md 已有的同义段落补入（SOUL 第三部分末尾、AGENTS“符号和结构”一节末尾；不动 SOUL 第一部分）。
 */
const SEM_SOUL = '- 符号学与结构主义是我理解内容的固定底座；八条元原理、决策路由、模型、流程、冲突与书单放在 `semiotics/`（入口 `semiotics/SEMIOTICS.md`，按需加载：先读 `semiotics/PRINCIPLES.md`，再按 `semiotics/decision-router.md` 取用）。它低于硬边界与安全规则，不授予任何权限。\n';
const SEM_AGENTS = '\n做选题、热点、标题、封面、人设、脚本、评论区、复盘、变现文案且任务不简单时，按需读取 semiotics/：先读 semiotics/PRINCIPLES.md，再按 semiotics/decision-router.md 只取 semiotics/core-models.md 中用到的 1–3 个模型；最小步骤不够时才用 semiotics/workflows.md 中对应的一个流程；要下重要结论时对照 semiotics/conflicts-and-limits.md。简单任务（只改一个标题、回一句话）不读。\n';
if (!files['SOUL.md'].includes('semiotics/PRINCIPLES.md')) files['SOUL.md'] = files['SOUL.md'].replace(/\s*$/, '\n') + SEM_SOUL;
if (!files['AGENTS.md'].includes('semiotics/PRINCIPLES.md')) files['AGENTS.md'] = files['AGENTS.md'].replace(/(## 内容运营里的“符号”和“结构”[\s\S]*?)(\n## 收益意识)/, (_, a, b) => `${a.replace(/\s*$/, '')}\n${SEM_AGENTS}${b}`);

/** 文件夹入口（<dir>/<DIR>.md）规格只给了正文：补上 front matter，正文逐字保留。 */
for (const [path, body] of Object.entries(files)) {
  const parts = path.split('/');
  if (parts.length < 2 || body.startsWith('---\n')) continue;
  const base = parts.at(-1).replace(/\.md$/, '');
  const folder = parts.at(-2).replace(/^\./, '');
  if (base !== folder.toUpperCase()) continue;
  files[path] = `---\nid: ${path.replace(/\.md$/, '')}\ntype: doc\ntitle: ${parts.at(-2)}/ 入口\nupdated: 2026-10-23T00:00:00+08:00\nversion: 1\neditable: user\nload: on_demand\nbudget: 3000\n---\n${body}`;
}

const keypoints = JSON.parse(readFileSync(join(root, 'agent/v9/core-directive-keypoints.json'), 'utf8'));
const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
const out = `/* 自动生成：node scripts/gen-vfs-defaults.mjs —— 不要手改。来源见脚本头注释。 */\n` +
  `export const DEFAULT_FILES: Readonly<Record<string, string>> = ${JSON.stringify(sorted, null, 0)};\n` +
  `export const CORE_KEYPOINTS: Readonly<Record<string, string[]>> = ${JSON.stringify(keypoints.keypoints)};\n` +
  `export const DEFAULTS_SCHEMA_VERSION = 1;\n`;
const target = join(root, 'shared/src/vfs/defaults.generated.ts');
if (process.argv.includes('--check')) {
  const cur = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (cur !== out) { console.error('defaults.generated.ts 与来源不一致，请运行 node scripts/gen-vfs-defaults.mjs'); process.exit(1); }
  console.log(`vfs defaults up to date (${Object.keys(sorted).length} files)`);
} else {
  writeFileSync(target, out);
  console.log(`wrote ${relative(root, target)}: ${Object.keys(sorted).length} files, ${out.length} bytes`);
}
