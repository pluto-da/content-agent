#!/usr/bin/env node
/**
 * 1.1.0 单一真相源守护（PROMPT-v1.1 4.3）：每个概念一个设置入口、一个读取链。违反即退出码 1（CI 严格运行）。
 *  S1 “我的”入口 ≤ 12，且没有同义入口（同一同义组最多一个）；旧入口名不得再出现在 ME_GROUPS；
 *  S2 每个概念只有一个设置路由（在白名单文件里写入）：热点来源、花钱阈值、实验开关、Key 共用方式、画像、主模型 / 按任务指定；
 *  S3 模型选择只通过 resolveModel：web/src 非测试代码不得直接读 roles[*].primary / roles.*.tasks 来选模型（编辑器与迁移除外），不得出现助手级模型覆盖；
 *  S4 平台写法只从技能读取：web/src 不得 ?raw 导入 agent/skills/*.md，不得出现 data/assistants、assistantOf、kv:assistants（迁移文件除外）；
 *  S5 硬边界展示与 BOUNDARIES.md 同源：web/src 不得导入 HARD_BOUNDARIES。
 * 用法：node scripts/single-source-check.mjs [--json out/single-source.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'locales' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
const src = walk('web/src').filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
const results = [];
const check = (id, label, problems) => results.push({ id, label, pass: problems.length === 0, problems });

/* S1 */
{
  const nav = rd('web/src/nav.ts');
  const block = nav.slice(nav.indexOf('export const ME_GROUPS'), nav.indexOf('export const ME_ALIASES'));
  const items = [...block.matchAll(/\{ id: '([^']+)', label: '([^']+)'/g)].map((m) => ({ id: m[1], label: m[2] }));
  const p = [];
  if (items.length > 12) p.push(`“我的”入口 ${items.length} 个，超过 12`);
  const ids = items.map((x) => x.id); const dup = ids.filter((x, i) => ids.indexOf(x) !== i); if (dup.length) p.push(`重复入口：${dup.join('、')}`);
  const SYN = [['日志', '审计', '记录', '运行状态'], ['备份', '存储', '数据'], ['花钱', '预算', '成本'], ['写作助手', '平台写法'], ['数据源', '热点来源'], ['画像', 'USER'], ['成长', '收益', '进化']];
  for (const g of SYN) { const hit = items.filter((x) => g.some((w) => x.label.includes(w))); if (hit.length > 1) p.push(`同义入口：${hit.map((x) => x.label).join(' / ')}`); }
  const OLD = ['写作助手与规则', '审计日志', '运行状态', '备份与恢复', '存储', '日志', '数据源', '收益', '技能', '记忆', '花钱与实验功能', '重新开始引导', '成长记录', 'Agent 设定'];
  for (const x of items) if (OLD.includes(x.label)) p.push(`旧入口名仍在列表：${x.label}`);
  check('S1', `“我的”入口 ${items.length} 个，无同义入口`, p);
}

/* S2：概念 → 允许写入的文件 */
{
  const CONCEPTS = [
    { name: '热点来源', re: /setPrefs\(\{\s*hotSources/, allow: ['web/src/pages/me/sources.tsx'] },
    { name: '花钱阈值', re: /setPrefs\(\{\s*spend/, allow: ['web/src/pages/me/v9/ops.tsx', 'web/src/v9/spend.ts'] },
    { name: '实验开关', re: /setPrefs\(\{\s*flags/, allow: ['web/src/pages/me/v9/ops.tsx'] },
    { name: 'Key 共用方式', re: /setPrefs\(\{\s*keyPolicy/, allow: ['web/src/v11/ModelsHub.tsx'] },
    { name: '画像', re: /\bsaveProfile\(/, allow: ['web/src/agent/store.ts', 'web/src/pages/me/profile.tsx', 'web/src/agent/cards.tsx', 'web/src/agent/tools.ts', 'web/src/v9/engine.ts'] },
    { name: '主模型', re: /\.main\s*=\s*\{/, allow: ['web/src/v11/ModelsHub.tsx', 'web/src/local/store.ts'] },
    { name: '按任务指定', re: /setTaskRoute\(|bindRole\(/, allow: ['web/src/v11/ModelsHub.tsx', 'web/src/v10/RoutingPage.tsx'] },
  ];
  const p = [];
  for (const c of CONCEPTS) for (const f of src) { const rel = path.relative(ROOT, f).replace(/\\/g, '/'); if (c.re.test(fs.readFileSync(f, 'utf8')) && !c.allow.includes(rel)) p.push(`${c.name} 在 ${rel} 里也能改`); }
  check('S2', '每个概念只有一个设置入口', p);
}

/* S3 */
{
  const ALLOW = ['web/src/v11/ModelsHub.tsx', 'web/src/v10/RoutingPage.tsx', 'web/src/local/store.ts', 'web/src/v11/migrate.ts'];
  const p = [];
  for (const f of src) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/'); const s = fs.readFileSync(f, 'utf8');
    if (ALLOW.includes(rel)) continue;
    for (const m of s.matchAll(/roles(?:\[[^\]]+\]|\.\w+)\??\.(primary|tasks)\b/g)) p.push(`${rel}: 直接读取 ${m[0]}（应走 resolveModel）`);
    if (/AssistantOverride|providerId:\s*ov\?/.test(s)) p.push(`${rel}: 仍有助手级模型覆盖`);
  }
  const runner = rd('shared/src/models/runner.ts');
  if (!/return resolveModel\(state, o\.task, role, o\)/.test(runner)) p.push('runner.resolveTarget 没有委托给 resolveModel');
  check('S3', '模型选择只走 resolveModel', p);
}

/* S4 */
{
  const p = [];
  for (const f of src) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/'); const s = fs.readFileSync(f, 'utf8');
    if (/agent\/skills\/[^'"]+\.md\?raw/.test(s)) p.push(`${rel}: 直接打包平台技能原文（应从 Agent 文件系统的技能读取）`);
    if (/data\/assistants|assistantOf\(|ASSISTANTS\b/.test(s)) p.push(`${rel}: 仍引用旧写作助手`);
    if (rel !== 'web/src/v11/migrate.ts' && /['"]assistants['"]/.test(s) && /getKV|setKV/.test(s)) p.push(`${rel}: 仍读写 kv:assistants`);
  }
  if (fs.existsSync(path.join(ROOT, 'web/src/data/assistants.ts'))) p.push('web/src/data/assistants.ts 仍存在');
  check('S4', '平台写法只从技能读取', p);
}

/* S5 */
{
  const p = [];
  for (const f of src) { const s = fs.readFileSync(f, 'utf8'); if (/HARD_BOUNDARIES/.test(s)) p.push(`${path.relative(ROOT, f)}: 界面另有一份硬边界常量`); }
  check('S5', '硬边界展示与 BOUNDARIES.md 同源', p);
}

const pass = results.every((r) => r.pass);
for (const r of results) console.log(`${r.pass ? '✓' : '✗'} ${r.id} ${r.label}${r.pass ? '' : `\n    - ${r.problems.join('\n    - ')}`}`);
const ji = process.argv.indexOf('--json');
if (ji > 0) { const out = path.resolve(ROOT, process.argv[ji + 1]); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), pass, results }, null, 2)); }
console.log(pass ? 'single-source-check：通过' : 'single-source-check：失败');
process.exit(pass ? 0 : 1);
