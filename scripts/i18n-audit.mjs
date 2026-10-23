#!/usr/bin/env node
/**
 * 1.0 多语言审计（ADR-007 重审）：
 *  A. web 文案表 zh / en 的 id 一一对应，英文缺失 = 0；
 *  B. 代码里静态的 t('…') / tr('…') 全部是已存在的 id（未知 id = 0，直接写中文 = 0）；
 *  C. TSX 里写死的中文文本节点与 aria-label / title / placeholder / alt = 0；
 *  D. shared 核心文案 en 缺失 = 0；
 *  E. 只报告不计入：模板字符串 / 拼接 / 数据表里的中文（Agent 运行时回复、平台名、示例等），供后续逐步收敛。
 * 用法：node scripts/i18n-audit.mjs [--strict] [--out out/i18n-audit.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
const oi = process.argv.indexOf('--out'); const OUT = path.resolve(ROOT, oi > 0 ? process.argv[oi + 1] : 'out/i18n-audit.json');
const CJK = /[\u4e00-\u9fff]/;
const parseCat = (f) => { const s = fs.readFileSync(path.join(ROOT, f), 'utf8'); const m = new Map(); for (const x of s.matchAll(/^\s*'((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)',$/gm)) m.set(x[1], x[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\')); return m; };
const zh = parseCat('web/src/locales/zh.ts'), en = parseCat('web/src/locales/en.ts');
const missingEn = [...zh.keys()].filter((k) => !(en.get(k) ?? '').trim() && zh.get(k) !== '个');
const orphanEn = [...en.keys()].filter((k) => !zh.has(k));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'locales' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
const files = walk(path.join(ROOT, 'web/src')).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) && !f.endsWith('i18n.ts'));
const unknown = [], cjkLiteral = [], hard = [], residual = {};
for (const f of files) {
  const rel = path.relative(ROOT, f); const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/\b(?:t|tr)\(\s*'((?:[^'\\]|\\.)*)'\s*[,)]/g)) { const k = m[1]; if (CJK.test(k)) cjkLiteral.push(`${rel}: ${k}`); else if (k.startsWith('ui.') && !zh.has(k)) unknown.push(`${rel}: ${k}`); }
  if (f.endsWith('.tsx')) {
    for (const m of s.matchAll(/>(\s*)([^<>{}\n`]*[\u4e00-\u9fff][^<>{}\n`]*?)(\s*)<(?=[/a-zA-Z{])/g)) hard.push(`${rel}: ${m[2].trim()}`);
    for (const m of s.matchAll(/\b(aria-label|title|placeholder|alt)=(["'])([^"'\n]*[\u4e00-\u9fff][^"'\n]*)\2/g)) hard.push(`${rel}: ${m[1]}=${m[3]}`);
  }
  const lines = s.split('\n').filter((l) => CJK.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)).length;
  if (lines) residual[rel] = lines;
}
let coreMissing = [];
try { const core = fs.readFileSync(path.join(ROOT, 'shared/src/core/i18n.ts'), 'utf8'); const block = (name) => { const i = core.indexOf(`const ${name}: Catalog = {`) >= 0 ? core.indexOf(`const ${name}: Catalog = {`) : core.indexOf(`export const ${name}: Catalog = {`); const j = core.indexOf('\n};', i); return new Set([...core.slice(i, j).matchAll(/'([a-z_.]+)':/g)].map((m) => m[1])); }; const z = block('ZH'), e = block('EN'); coreMissing = [...z].filter((k) => !e.has(k)); } catch (e) { coreMissing = [`读取失败：${e.message}`]; }
const report = {
  at: new Date().toISOString(),
  web: { ids: zh.size, missingEn: missingEn.length, orphanEn: orphanEn.length, unknownIds: unknown.length, cjkLiteralInT: cjkLiteral.length, hardcodedJsx: hard.length },
  core: { missingEn: coreMissing.length },
  residualCjkLinesByFile: residual, residualTotal: Object.values(residual).reduce((a, b) => a + b, 0),
  details: { missingEn: missingEn.slice(0, 50), unknown: unknown.slice(0, 50), cjkLiteral: cjkLiteral.slice(0, 50), hard: hard.slice(0, 80), coreMissing },
};
report.pass = !missingEn.length && !orphanEn.length && !unknown.length && !cjkLiteral.length && !hard.length && !coreMissing.length;
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`i18n：id ${zh.size}，英文缺失 ${missingEn.length}，未知 id ${unknown.length}，t() 里直接写中文 ${cjkLiteral.length}，TSX 写死中文 ${hard.length}，核心英文缺失 ${coreMissing.length}；（仅报告）其余含中文的代码行 ${report.residualTotal}`);
if (strict && !report.pass) process.exit(1);
